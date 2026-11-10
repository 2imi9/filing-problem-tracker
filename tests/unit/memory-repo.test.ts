import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry, County, SessionUser } from "@/lib/domain";
import { demoUserById } from "@/lib/sample";
import type { ImportRow, NewFlagInput } from "@/lib/schemas";
import { HttpError } from "@/server/http";
import { createMemoryRepository, createMemoryStore, resetMemoryStore } from "@/server/repo/memory";
import type { MemoryStore } from "@/server/repo/memory";
import type { Repository } from "@/server/repo/types";

function user(id: string): SessionUser {
  const found = demoUserById(id);
  if (!found) throw new Error(`no demo user ${id}`);
  return found;
}

const MARION = user("demo-clerk-marion");
const LAKE = user("demo-clerk-lake");
const LEADER = user("demo-leader");
const ADMIN = user("demo-admin");
/** A second clerk in Marion, to tell "own entries" from "own county". */
const MARION_2: SessionUser = { id: "clerk-marion-2", email: "clerk2.marion@demo.invalid", role: "clerk", county: "Marion" };

const MINUTE = 60_000;

let store: MemoryStore;
let clock: number;

function repo(session: SessionUser): Repository {
  return createMemoryRepository(session, { store, now: () => new Date(clock) });
}

function newFlag(county: County, overrides: Partial<NewFlagInput> = {}): NewFlagInput {
  return {
    date: "2026-10-29",
    county,
    caseType: "Small claims",
    form: "Small claims notice of claim",
    tags: ["Missing signature"],
    outcome: "Rejected",
    ...overrides,
  };
}

function importRow(county: County, overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    date: "2026-09-02",
    county,
    caseType: "Small claims",
    form: "Small claims notice of claim",
    reason: "called filer - will bring in tomorrow",
    tags: ["Needs review"],
    ...overrides,
  };
}

async function status(promise: Promise<unknown>): Promise<number | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof HttpError) return error.status;
    throw error;
  }
}

beforeEach(() => {
  store = createMemoryStore();
  clock = Date.parse("2026-10-30T15:00:00.000Z");
});

describe("read flags: a clerk sees their own county, leaders and admins see all", () => {
  it("clerk: own county only", async () => {
    const marion = await repo(MARION).listFlags();
    const lake = await repo(LAKE).listFlags();
    expect(marion).toHaveLength(284);
    expect(new Set(marion.map((f) => f.county))).toEqual(new Set(["Marion"]));
    expect(new Set(lake.map((f) => f.county))).toEqual(new Set(["Lake"]));
    expect(lake.length).toBeGreaterThan(0);
  });

  it("leader and admin: every county", async () => {
    expect(await repo(LEADER).listFlags()).toHaveLength(900);
    expect(await repo(ADMIN).listFlags()).toHaveLength(900);
  });

  it("listFlags never carries a note or a raw reason, for anyone", async () => {
    await repo(MARION).createFlag(newFlag("Marion", { note: "second page was blank" }));
    await repo(ADMIN).createFlags([importRow("Lake")], "batch");
    for (const session of [MARION, LAKE, LEADER, ADMIN]) {
      for (const flag of await repo(session).listFlags()) {
        expect(flag).not.toHaveProperty("note");
        expect(flag).not.toHaveProperty("reason");
      }
    }
    expect(JSON.stringify(await repo(LEADER).listFlags())).not.toContain("second page was blank");
    expect(JSON.stringify(await repo(LEADER).listFlags())).not.toContain("will bring in tomorrow");
  });

  it("a clerk with no county assigned can read nothing", async () => {
    const lost: SessionUser = { id: "clerk-none", email: "clerk.none@demo.invalid", role: "clerk", county: null };
    expect(await status(repo(lost).listFlags())).toBe(403);
    expect(await status(repo(lost).createFlag(newFlag("Marion")))).toBe(403);
  });
});

describe("read notes and raw reasons", () => {
  it("clerk: own entries, with their notes, newest first", async () => {
    const first = await repo(MARION).createFlag(newFlag("Marion", { note: "first note" }));
    clock += MINUTE;
    const second = await repo(MARION).createFlag(newFlag("Marion", { note: "second note" }));
    const recent = await repo(MARION).listMyRecent(10);
    expect(recent.map((f) => f.id)).toEqual([second.id, first.id]);
    expect(recent.map((f) => f.note)).toEqual(["second note", "first note"]);
    expect(await repo(MARION).listMyRecent(1)).toHaveLength(1);
    expect(await repo(MARION).listMyRecent(0)).toEqual([]);
  });

  it("clerk: entries saved in the same instant still come back newest first", async () => {
    const a = await repo(MARION).createFlag(newFlag("Marion"));
    const b = await repo(MARION).createFlag(newFlag("Marion"));
    const c = await repo(MARION).createFlag(newFlag("Marion"));
    expect((await repo(MARION).listMyRecent(10)).map((f) => f.id)).toEqual([c.id, b.id, a.id]);
  });

  it("clerk: never the notes of others, not even in their own county", async () => {
    await repo(MARION).createFlag(newFlag("Marion", { note: "note by the first Marion clerk" }));
    await repo(LAKE).createFlag(newFlag("Lake", { note: "note by the Lake clerk" }));
    await repo(ADMIN).createFlag(newFlag("Marion", { note: "note by the admin" }));

    const seenBySecondMarionClerk = JSON.stringify([
      await repo(MARION_2).listFlags(),
      await repo(MARION_2).listMyRecent(50),
      await repo(MARION_2).listNeedsReview(),
    ]);
    expect(seenBySecondMarionClerk).not.toContain("note by");
    expect(await repo(MARION_2).listMyRecent(50)).toEqual([]);

    const seenByLakeClerk = JSON.stringify([await repo(LAKE).listFlags(), await repo(LAKE).listMyRecent(50), await repo(LAKE).listNeedsReview()]);
    expect(seenByLakeClerk).toContain("note by the Lake clerk");
    expect(seenByLakeClerk).not.toContain("Marion clerk");
    expect(seenByLakeClerk).not.toContain("note by the admin");
  });

  it("clerk: the raw reasons of their own county's needs-review rows, whoever imported them", async () => {
    await repo(MARION).createFlags([importRow("Marion", { reason: "marion reason to review" })], "a");
    await repo(ADMIN).createFlags(
      [
        importRow("Marion", { reason: "second marion reason" }),
        importRow("Lake", { reason: "lake reason to review" }),
        importRow("Marion", { reason: "unsigned", tags: ["Missing signature"] }),
      ],
      "b",
    );
    const marion = await repo(MARION_2).listNeedsReview();
    expect(marion.map((f) => f.reason).sort()).toEqual(["marion reason to review", "second marion reason"]);
    expect(marion.every((f) => f.county === "Marion" && f.source === "import")).toBe(true);
    const lake = await repo(LAKE).listNeedsReview();
    expect(lake.map((f) => f.reason)).toEqual(["lake reason to review"]);
  });

  it("leader: no notes and no raw reasons by any route", async () => {
    await repo(ADMIN).createFlags([importRow("Lake", { reason: "lake reason to review" })], "b");
    expect(await status(repo(LEADER).listNeedsReview())).toBe(403);
    expect(await repo(LEADER).listMyRecent(50)).toEqual([]);
  });

  it("admin: every county's needs-review rows", async () => {
    await repo(MARION).createFlags([importRow("Marion")], "a");
    await repo(LAKE).createFlags([importRow("Lake")], "b");
    const all = await repo(ADMIN).listNeedsReview();
    expect(all.map((f) => f.county).sort()).toEqual(["Lake", "Marion"]);
    expect(all.every((f) => f.reason === "called filer - will bring in tomorrow")).toBe(true);
  });
});

describe("create a flag", () => {
  it("clerk: own county, recorded as theirs", async () => {
    const flag = await repo(MARION).createFlag(newFlag("Marion", { note: "page 2 unsigned" }));
    expect(flag).toMatchObject({
      county: "Marion",
      source: "clerk",
      createdBy: "demo-clerk-marion",
      createdAt: "2026-10-30T15:00:00.000Z",
      note: "page 2 unsigned",
      reason: null,
      batchId: null,
    });
    expect(await repo(MARION).listFlags()).toHaveLength(285);
    expect(await repo(LEADER).listFlags()).toHaveLength(901);
    expect(await repo(LAKE).listFlags()).not.toContainEqual(expect.objectContaining({ id: flag.id }));
  });

  it("clerk: another county is refused with 403, not rewritten to their own", async () => {
    const before = store.flags.length;
    const attempt = repo(MARION).createFlag(newFlag("Lake"));
    await expect(attempt).rejects.toMatchObject({ status: 403, message: "You can add filings for Marion County only. This request names Lake County." });
    expect(store.flags).toHaveLength(before);
  });

  it("leader: refused", async () => {
    expect(await status(repo(LEADER).createFlag(newFlag("Marion")))).toBe(403);
    expect(store.flags).toHaveLength(900);
  });

  it("admin: any county", async () => {
    expect((await repo(ADMIN).createFlag(newFlag("Tippecanoe"))).county).toBe("Tippecanoe");
    expect((await repo(ADMIN).createFlag(newFlag("Lake"))).createdBy).toBe("demo-admin");
  });

  it("validates again at the repository: bad values, future dates and personal data are refused", async () => {
    await expect(repo(MARION).createFlag({ ...newFlag("Marion"), tags: [] })).rejects.toThrow();
    await expect(repo(MARION).createFlag(newFlag("Marion", { date: "2026-10-31" }))).rejects.toThrow("future");
    const withName = repo(MARION).createFlag(newFlag("Marion", { note: "John Smith forgot to sign" }));
    await expect(withName).rejects.toMatchObject({ status: 422, code: "personal_data" });
    expect(store.flags).toHaveLength(900);
  });
});

describe("import", () => {
  it("clerk: own county, saved as one batch of rejected filings with the raw reason", async () => {
    const result = await repo(MARION).createFlags(
      [importRow("Marion"), importRow("Marion", { reason: "unsigned", tags: ["Missing signature"] })],
      "September export",
    );
    expect(result.inserted).toBe(2);
    const added = store.flags.filter((f) => f.batchId === result.batchId);
    expect(added).toHaveLength(2);
    expect(added.every((f) => f.source === "import" && f.outcome === "Rejected" && f.createdBy === "demo-clerk-marion")).toBe(true);
    expect(added.map((f) => f.reason)).toEqual(["called filer - will bring in tomorrow", "unsigned"]);
    expect(store.batches).toEqual([
      { id: result.batchId, name: "September export", createdBy: "demo-clerk-marion", createdAt: "2026-10-30T15:00:00.000Z", rows: 2 },
    ]);
  });

  it("clerk: one row for another county refuses the whole batch with 403", async () => {
    const attempt = repo(MARION).createFlags([importRow("Marion"), importRow("Lake")], "mixed");
    await expect(attempt).rejects.toMatchObject({ status: 403 });
    expect(store.flags).toHaveLength(900);
    expect(store.batches).toEqual([]);
  });

  it("leader: refused", async () => {
    expect(await status(repo(LEADER).createFlags([importRow("Marion")], "x"))).toBe(403);
    expect(store.flags).toHaveLength(900);
  });

  it("admin: any mix of counties", async () => {
    const result = await repo(ADMIN).createFlags([importRow("Marion"), importRow("Lake"), importRow("Monroe")], "all");
    expect(result.inserted).toBe(3);
    expect(await repo(LEADER).listFlags()).toHaveLength(903);
  });

  it("refuses an empty batch, an invalid row and a reason with personal data, saving nothing", async () => {
    expect(await status(repo(ADMIN).createFlags([], "x"))).toBe(400);
    await expect(repo(ADMIN).createFlags([importRow("Marion"), { ...importRow("Marion"), tags: [] }], "x")).rejects.toThrow();
    const withPhone = repo(ADMIN).createFlags([importRow("Marion"), importRow("Marion", { reason: "call 317-555-0142" })], "x");
    await expect(withPhone).rejects.toMatchObject({ status: 422, code: "personal_data" });
    expect(store.flags).toHaveLength(900);
    expect(store.batches).toEqual([]);
  });

  it("stores an empty reason as no reason", async () => {
    const result = await repo(ADMIN).createFlags([importRow("Marion", { reason: "" })], "x");
    expect(store.flags.find((f) => f.batchId === result.batchId)?.reason).toBeNull();
  });
});

describe("the demo store has a ceiling", () => {
  /** Fills the store to `count` flags by repeating a sample row, which is all a size check looks at. */
  function fillTo(count: number): void {
    const [template] = store.flags;
    while (store.flags.length < count) store.flags.push({ ...template, id: `filler-${store.flags.length}` });
  }

  it("refuses a new entry, and an import that would not fit, with 409 once it is full", async () => {
    fillTo(50_000 - 2);
    expect(await status(repo(MARION).createFlags([importRow("Marion"), importRow("Marion"), importRow("Marion")], "too many"))).toBe(409);
    expect(store.flags).toHaveLength(50_000 - 2);
    expect(store.batches).toHaveLength(0);
    expect(await status(repo(MARION).createFlags([importRow("Marion")], "fits"))).toBe("ok");
    expect(await status(repo(MARION).createFlag(newFlag("Marion")))).toBe("ok");
    expect(store.flags).toHaveLength(50_000);
    await expect(repo(MARION).createFlag(newFlag("Marion"))).rejects.toMatchObject({ status: 409, message: "The demo is full. Reset the demo data to add more." });
    expect(await status(repo(ADMIN).createFlags([importRow("Lake")], "one more"))).toBe(409);
    expect(store.flags).toHaveLength(50_000);
  });

  it("refuses more import batches than it keeps", async () => {
    for (let i = 0; i < 500; i++) store.batches.push({ id: `b${i}`, name: "x", createdBy: ADMIN.id, createdAt: "2026-10-30T15:00:00.000Z", rows: 1 });
    expect(await status(repo(ADMIN).createFlags([importRow("Lake")], "one more"))).toBe(409);
    expect(store.batches).toHaveLength(500);
  });
});

describe("the import batch name", () => {
  it("is refused when it looks like it holds personal data, and nothing is saved", async () => {
    await expect(repo(ADMIN).createFlags([importRow("Marion")], "John Smith 49D01-2401-SC-000123")).rejects.toMatchObject({ status: 422, code: "personal_data" });
    expect(store.batches).toHaveLength(0);
    expect(store.flags).toHaveLength(900);
  });
});

describe("delete and restore", () => {
  it("clerk: own entry within 5 minutes, then it is gone from every list", async () => {
    const flag = await repo(MARION).createFlag(newFlag("Marion"));
    clock += 4 * MINUTE;
    await repo(MARION).softDeleteFlag(flag.id);
    expect(await repo(MARION).listFlags()).toHaveLength(284);
    expect(await repo(LEADER).listFlags()).toHaveLength(900);
    expect(await repo(MARION).listMyRecent(10)).toEqual([]);
    // Soft delete: the row is kept, marked deleted.
    expect(store.flags.find((f) => f.id === flag.id)?.deletedAt).toBe("2026-10-30T15:04:00.000Z");
  });

  it("clerk: exactly 5 minutes is still allowed; a moment later is refused", async () => {
    const a = await repo(MARION).createFlag(newFlag("Marion"));
    const b = await repo(MARION).createFlag(newFlag("Marion"));
    clock += 5 * MINUTE;
    expect(await status(repo(MARION).softDeleteFlag(a.id))).toBe("ok");
    clock += 1;
    expect(await status(repo(MARION).softDeleteFlag(b.id))).toBe(403);
    expect(await repo(MARION).listFlags()).toHaveLength(285);
  });

  it("a Marion clerk is refused a Lake flag with 403", async () => {
    const lakeFlag = await repo(LAKE).createFlag(newFlag("Lake"));
    expect(await status(repo(MARION).softDeleteFlag(lakeFlag.id))).toBe(403);
    expect(await status(repo(MARION).restoreFlag(lakeFlag.id))).toBe(403);
    expect(store.flags.find((f) => f.id === lakeFlag.id)?.deletedAt).toBeNull();
    // The same for a Lake sample row nobody owns.
    const lakeSample = store.flags.find((f) => f.county === "Lake" && f.source === "sample");
    expect(await status(repo(MARION).softDeleteFlag(lakeSample?.id ?? ""))).toBe(403);
  });

  it("clerk: cannot delete another clerk's entry in their own county, or a sample row", async () => {
    const flag = await repo(MARION).createFlag(newFlag("Marion"));
    expect(await status(repo(MARION_2).softDeleteFlag(flag.id))).toBe(403);
    expect(await status(repo(MARION).softDeleteFlag("s0"))).toBe(403);
  });

  it("leader: cannot delete or restore anything", async () => {
    const flag = await repo(MARION).createFlag(newFlag("Marion"));
    expect(await status(repo(LEADER).softDeleteFlag(flag.id))).toBe(403);
    expect(await status(repo(LEADER).softDeleteFlag("s0"))).toBe(403);
    await repo(MARION).softDeleteFlag(flag.id);
    expect(await status(repo(LEADER).restoreFlag(flag.id))).toBe(403);
  });

  it("admin: any entry at any time, including sample rows", async () => {
    const flag = await repo(LAKE).createFlag(newFlag("Lake"));
    clock += 3 * 24 * 60 * MINUTE;
    expect(await status(repo(ADMIN).softDeleteFlag(flag.id))).toBe("ok");
    expect(await status(repo(ADMIN).softDeleteFlag("s0"))).toBe("ok");
    expect(await repo(ADMIN).listFlags()).toHaveLength(899);
    clock += 3 * 24 * 60 * MINUTE;
    expect(await status(repo(ADMIN).restoreFlag("s0"))).toBe("ok");
    expect(await repo(ADMIN).listFlags()).toHaveLength(900);
  });

  it("clerk: undo within 5 minutes of deleting brings the entry back; later it is refused", async () => {
    const flag = await repo(MARION).createFlag(newFlag("Marion", { note: "kept" }));
    await repo(MARION).softDeleteFlag(flag.id);
    clock += 5 * MINUTE;
    await repo(MARION).restoreFlag(flag.id);
    expect((await repo(MARION).listMyRecent(10)).map((f) => [f.id, f.note])).toEqual([[flag.id, "kept"]]);

    await repo(MARION).softDeleteFlag(flag.id);
    clock += 5 * MINUTE + 1;
    expect(await status(repo(MARION).restoreFlag(flag.id))).toBe(403);
    expect(await status(repo(ADMIN).restoreFlag(flag.id))).toBe("ok");
  });

  it("clerk: cannot restore their own entry after an administrator removed it", async () => {
    const flag = await repo(MARION).createFlag(newFlag("Marion", { note: "second page not signed" }));
    clock += MINUTE;
    await repo(ADMIN).softDeleteFlag(flag.id);
    clock += MINUTE;
    await expect(repo(MARION).restoreFlag(flag.id)).rejects.toMatchObject({ status: 403, message: "This entry was removed by someone else. Ask an administrator to restore it." });
    expect(store.flags.find((f) => f.id === flag.id)?.deletedAt).not.toBeNull();
    expect((await repo(LEADER).listFlags()).some((f) => f.id === flag.id)).toBe(false);
    // "Removing" it again does not make the removal the clerk's own.
    expect(await status(repo(MARION).softDeleteFlag(flag.id))).toBe("ok");
    expect(await status(repo(MARION).restoreFlag(flag.id))).toBe(403);

    // The administrator can put it back. After that the clerk's own remove and undo work as before.
    expect(await status(repo(ADMIN).restoreFlag(flag.id))).toBe("ok");
    expect(store.flags.find((f) => f.id === flag.id)).toMatchObject({ deletedAt: null, deletedBy: null });
    await repo(MARION).softDeleteFlag(flag.id);
    expect(store.flags.find((f) => f.id === flag.id)?.deletedBy).toBe(MARION.id);
    expect(await status(repo(MARION).restoreFlag(flag.id))).toBe("ok");
  });

  it("deleting twice and restoring a live entry are harmless; an unknown id is 404", async () => {
    const flag = await repo(MARION).createFlag(newFlag("Marion"));
    expect(await status(repo(MARION).restoreFlag(flag.id))).toBe("ok");
    await repo(MARION).softDeleteFlag(flag.id);
    expect(await status(repo(MARION).softDeleteFlag(flag.id))).toBe("ok");
    expect(await status(repo(MARION).softDeleteFlag("no-such-id"))).toBe(404);
    expect(await status(repo(ADMIN).restoreFlag("no-such-id"))).toBe(404);
  });
});

describe("change events: everyone reads, only an admin writes", () => {
  const input = { name: "New guide", date: "2026-09-01", county: "Monroe", caseType: "Eviction", tag: "Wrong form", description: "A one-page guide." } as const;

  it("clerk, leader and admin all read the same three sample changes", async () => {
    for (const session of [MARION, LAKE, LEADER, ADMIN]) {
      expect((await repo(session).listEvents()).map((e) => e.id)).toEqual(["sc-form", "po-guide", "fam-kiosk"]);
    }
  });

  it("clerk and leader cannot add, replace or delete", async () => {
    for (const session of [MARION, LEADER]) {
      expect(await status(repo(session).upsertEvent(input))).toBe(403);
      expect(await status(repo(session).upsertEvent({ ...input, id: "sc-form" }))).toBe(403);
      expect(await status(repo(session).deleteEvent("sc-form"))).toBe(403);
    }
    expect(store.events).toHaveLength(3);
    expect(store.events[0].name).toBe("Revised small claims form (Marion, Jun 1)");
  });

  it("admin adds, replaces and deletes", async () => {
    const added = await repo(ADMIN).upsertEvent(input);
    expect(added).toMatchObject(input);
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
    const replaced = await repo(ADMIN).upsertEvent({ ...input, id: added.id, name: "Renamed guide" });
    expect(replaced).toEqual({ ...input, id: added.id, name: "Renamed guide" });
    expect(await repo(LEADER).listEvents()).toHaveLength(4);
    await repo(ADMIN).deleteEvent(added.id);
    expect((await repo(MARION).listEvents()).map((e) => e.id)).toEqual(["sc-form", "po-guide", "fam-kiosk"]);
  });

  it("admin: unknown ids are 404, invalid input and future dates are refused", async () => {
    expect(await status(repo(ADMIN).upsertEvent({ ...input, id: "nope" }))).toBe(404);
    expect(await status(repo(ADMIN).deleteEvent("nope"))).toBe(404);
    await expect(repo(ADMIN).upsertEvent({ ...input, date: "2026-12-01" })).rejects.toThrow("future");
    await expect(repo(ADMIN).upsertEvent({ ...input, name: "" })).rejects.toThrow();
  });

  it("callers get copies, so changing a returned event does not change the store", async () => {
    const events = await repo(MARION).listEvents();
    events[0].name = "tampered";
    expect((await repo(LEADER).listEvents())[0].name).toBe("Revised small claims form (Marion, Jun 1)");
  });
});

describe("folders: each user has their own", () => {
  const panel = { id: "p1", title: "Key numbers", size: "w", type: "kpi", params: {} } as const;

  it("every user starts with the example folders that fit them", async () => {
    expect((await repo(LEADER).listFolders()).map((f) => f.name)).toEqual(["Marion small claims", "Lake protective orders", "County comparison"]);
    expect((await repo(ADMIN).listFolders()).map((f) => f.name)).toHaveLength(3);
    expect((await repo(MARION).listFolders()).map((f) => f.name)).toEqual(["Marion small claims"]);
    expect((await repo(LAKE).listFolders()).map((f) => f.name)).toEqual(["Lake protective orders"]);
  });

  it("clerk, leader and admin each save, replace and delete their own", async () => {
    for (const session of [MARION, LEADER, ADMIN]) {
      const startCount = (await repo(session).listFolders()).length;
      const saved = await repo(session).saveFolder({ name: "Mine", panels: [panel] });
      expect(saved).toMatchObject({ name: "Mine", panels: [panel] });
      const replaced = await repo(session).saveFolder({ id: saved.id, name: "Mine, renamed", panels: [] });
      expect(replaced).toEqual({ id: saved.id, name: "Mine, renamed", panels: [] });
      expect(await repo(session).listFolders()).toHaveLength(startCount + 1);
      await repo(session).deleteFolder(saved.id);
      expect(await repo(session).listFolders()).toHaveLength(startCount);
    }
  });

  it("keeps one folder for the open panels however often it is saved without an id", async () => {
    const before = (await repo(LEADER).listFolders()).length;
    // Two browser tabs that both loaded before the folder existed each save it without an id.
    const first = await repo(LEADER).saveFolder({ name: "__current", panels: [panel] });
    const second = await repo(LEADER).saveFolder({ name: "__current", panels: [] });
    expect(second.id).toBe(first.id);
    const folders = await repo(LEADER).listFolders();
    expect(folders).toHaveLength(before + 1);
    expect(folders.filter((f) => f.name === "__current")).toEqual([{ id: first.id, name: "__current", panels: [] }]);
    // Another folder cannot take the reserved name, and each person has their own.
    const other = folders.find((f) => f.name !== "__current");
    expect(await status(repo(LEADER).saveFolder({ id: other?.id, name: "__current", panels: [] }))).toBe(409);
    expect((await repo(ADMIN).saveFolder({ name: "__current", panels: [] })).id).not.toBe(first.id);
    // Once deleted, the next save makes a new one.
    await repo(LEADER).deleteFolder(first.id);
    expect((await repo(LEADER).saveFolder({ name: "__current", panels: [] })).id).not.toBe(first.id);
  });

  it("nobody sees, replaces or deletes another user's folder, not even an admin", async () => {
    const mine = await repo(MARION).saveFolder({ name: "Marion clerk's folder", panels: [panel] });
    for (const other of [MARION_2, LAKE, LEADER, ADMIN]) {
      expect((await repo(other).listFolders()).map((f) => f.id)).not.toContain(mine.id);
      expect(await status(repo(other).saveFolder({ id: mine.id, name: "taken over", panels: [] }))).toBe(404);
      expect(await status(repo(other).deleteFolder(mine.id))).toBe(404);
    }
    expect((await repo(MARION).listFolders()).find((f) => f.id === mine.id)?.name).toBe("Marion clerk's folder");
  });

  it("deleting an example folder only affects the user who deleted it", async () => {
    await repo(LEADER).deleteFolder("example-county-comparison");
    expect(await repo(LEADER).listFolders()).toHaveLength(2);
    expect(await repo(ADMIN).listFolders()).toHaveLength(3);
  });

  it("refuses invalid folders, unknown ids and more than 50 folders", async () => {
    await expect(repo(MARION).saveFolder({ name: "", panels: [] })).rejects.toThrow();
    expect(await status(repo(MARION).deleteFolder("nope"))).toBe(404);
    const existing = (await repo(MARION).listFolders()).length;
    for (let i = existing; i < 50; i++) await repo(MARION).saveFolder({ name: `Folder ${i}`, panels: [] });
    expect(await status(repo(MARION).saveFolder({ name: "One too many", panels: [] }))).toBe(409);
  });

  it("callers get copies", async () => {
    const folders = await repo(LEADER).listFolders();
    folders[0].name = "tampered";
    folders[0].panels.length = 0;
    const again = await repo(LEADER).listFolders();
    expect(again[0].name).toBe("Marion small claims");
    expect(again[0].panels.length).toBeGreaterThan(0);
  });
});

describe("audit log: only an admin reads it", () => {
  const entry = (session: SessionUser, n: number): AuditEntry => ({
    id: `a${n}`,
    at: new Date(clock + n).toISOString(),
    userId: session.id,
    role: session.role,
    action: "flag.create",
    entity: "flag",
    entityId: `flag-${n}`,
    detail: { county: "Marion", problems: 1 },
  });

  it("anyone can append their own entries; clerk and leader cannot read", async () => {
    await repo(MARION).appendAudit(entry(MARION, 1));
    await repo(LEADER).appendAudit(entry(LEADER, 2));
    expect(await status(repo(MARION).listAudit(10))).toBe(403);
    expect(await status(repo(LAKE).listAudit(10))).toBe(403);
    expect(await status(repo(LEADER).listAudit(10))).toBe(403);
  });

  it("admin reads everyone's entries, newest first, up to the limit", async () => {
    await repo(MARION).appendAudit(entry(MARION, 1));
    await repo(LAKE).appendAudit(entry(LAKE, 2));
    await repo(ADMIN).appendAudit(entry(ADMIN, 3));
    expect((await repo(ADMIN).listAudit(10)).map((e) => e.id)).toEqual(["a3", "a2", "a1"]);
    expect((await repo(ADMIN).listAudit(2)).map((e) => e.id)).toEqual(["a3", "a2"]);
    expect(await repo(ADMIN).listAudit(0)).toEqual([]);
  });

  it("an entry cannot be written in someone else's name or role", async () => {
    expect(await status(repo(MARION).appendAudit(entry(ADMIN, 1)))).toBe(403);
    expect(await status(repo(MARION).appendAudit({ ...entry(MARION, 1), role: "admin" }))).toBe(403);
    expect(store.audit).toEqual([]);
  });
});

describe("the process-wide store", () => {
  it("is shared by repositories made without a store, and resetMemoryStore puts the sample data back", async () => {
    resetMemoryStore();
    const flag = await createMemoryRepository(ADMIN).createFlag(newFlag("Marion"));
    await createMemoryRepository(ADMIN).upsertEvent({ name: "Extra", date: "2026-09-01", county: "Lake", caseType: "Family", tag: "Wrong form", description: "" });
    await createMemoryRepository(LEADER).saveFolder({ name: "Mine", panels: [] });
    expect(await createMemoryRepository(LEADER).listFlags()).toContainEqual(expect.objectContaining({ id: flag.id }));

    resetMemoryStore();
    expect(await createMemoryRepository(LEADER).listFlags()).toHaveLength(900);
    expect(await createMemoryRepository(LEADER).listEvents()).toHaveLength(3);
    expect(await createMemoryRepository(LEADER).listFolders()).toHaveLength(3);
    expect(await createMemoryRepository(ADMIN).listAudit(10)).toEqual([]);
  });
});
