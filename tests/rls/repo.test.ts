// The Supabase repository's own logic, run against the real migrations. The repository talks to a
// gateway; here the gateway is the test database acting as each person (see pgliteGateway.ts), so every
// call goes through the real policies, column privileges, constraints and functions.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { County, Role, SessionUser } from "@/lib/domain";
import { exampleFoldersFor } from "@/lib/panels";
import type { ImportRow, NewFlagInput } from "@/lib/schemas";
import { todayIso } from "@/lib/time";
import { LIMITS } from "@/server/config";
import { loadSessionUser } from "@/server/auth/supabase";
import { HttpError } from "@/server/http";
import { createMcpReader, tokenUserFromRows } from "@/server/mcp/supabase-tokens";
import { createGatewayRepository, createTokenRepository, toHttpError } from "@/server/repo/supabase";
import type { Repository } from "@/server/repo/types";
import { DbError } from "@/server/supabase/gateway";
import { CLERK_TOKEN_HASH, IDS, LAKE_CURRENT, MARION_CURRENT, REVOKED_TOKEN_HASH, SERVICE, TOKEN_HASH, loadFixtures } from "./fixtures";
import { createTestDatabase } from "./harness";
import type { TestDatabase } from "./harness";
import { createPgliteGateway } from "./pgliteGateway";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await loadFixtures(db);
});

afterAll(async () => {
  await db.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const user = (id: string, role: Role, county: County | null): SessionUser => ({ id, email: `${role}@example.invalid`, role, county });

const CLERK_A = user(IDS.clerkA, "clerk", "Marion");
const CLERK_B = user(IDS.clerkB, "clerk", "Lake");
const LEADER = user(IDS.leader, "leader", null);
const ADMIN = user(IDS.admin, "admin", null);

const today = () => todayIso("supabase", new Date());

function repoFor(session: SessionUser, options: { maxRows?: number; now?: () => Date } = {}): Repository {
  const gateway = createPgliteGateway(db, { role: "authenticated", userId: session.id }, { maxRows: options.maxRows });
  return createGatewayRepository(session, gateway, { today, now: options.now });
}

const flagInput = (county: County, note?: string): NewFlagInput => ({
  date: "2024-05-01",
  county,
  caseType: "Small claims",
  form: "Small claims notice of claim",
  tags: ["Missing signature", "Wrong form"],
  outcome: "Returned to fix",
  note,
});

const importRows = (county: County): ImportRow[] => [
  { date: "2024-05-02", county, caseType: "Eviction", form: "Tenant answer or request for hearing", reason: "page 3 missing", tags: ["Pages missing or unreadable"] },
  { date: "2024-05-03", county, caseType: "Name change", form: "Petition for change of name", reason: "called filer, will bring it in", tags: ["Needs review"] },
];

const refused = (status: number) => expect.objectContaining({ status });

describe("listFlags", () => {
  it("returns the person's scope as lean flags, with no note or reason", async () => {
    const flags = await repoFor(CLERK_A).listFlags();
    expect(flags.map((f) => f.id).sort()).toEqual(MARION_CURRENT);
    const fresh = flags.find((f) => f.id === "a-fresh");
    expect(fresh).toEqual({
      id: "a-fresh",
      date: "2024-03-05",
      county: "Marion",
      caseType: "Small claims",
      form: "Small claims notice of claim",
      tags: ["Missing signature"],
      outcome: "Returned to fix",
      source: "clerk",
      batchId: null,
      createdBy: IDS.clerkA,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    for (const flag of flags) {
      expect(flag).not.toHaveProperty("note");
      expect(flag).not.toHaveProperty("reason");
    }
  });

  it("gives the leader and the admin every county, and clerk B only Lake", async () => {
    const everything = [...MARION_CURRENT, ...LAKE_CURRENT].sort();
    expect((await repoFor(LEADER).listFlags()).map((f) => f.id).sort()).toEqual(everything);
    expect((await repoFor(ADMIN).listFlags()).map((f) => f.id).sort()).toEqual(everything);
    expect((await repoFor(CLERK_B).listFlags()).map((f) => f.id).sort()).toEqual(LAKE_CURRENT);
  });

  it("reads every row when the server returns only a few per request", async () => {
    const flags = await repoFor(LEADER, { maxRows: 3 }).listFlags();
    expect(flags.map((f) => f.id).sort()).toEqual([...MARION_CURRENT, ...LAKE_CURRENT].sort());
    expect(new Set(flags.map((f) => f.id)).size).toBe(flags.length);
  });

  it("the database decides, not the session object: a person whose profile is gone reads nothing", async () => {
    const noProfile = user(IDS.stranger, "admin", null);
    expect(await repoFor(noProfile).listFlags()).toEqual([]);
    await expect(repoFor(noProfile).createFlag(flagInput("Marion"))).rejects.toEqual(refused(403));
    await expect(repoFor(noProfile).listNeedsReview()).rejects.toEqual(refused(403));
    await expect(repoFor(noProfile).listAudit(10)).resolves.toEqual([]);
  });
});

describe("createFlag and listMyRecent", () => {
  it("a clerk adds a flag for their county and reads it back, with its note, in their recent entries", async () => {
    const repo = repoFor(CLERK_A);
    const created = await repo.createFlag(flagInput("Marion", "  form was   the 2019 version "));
    expect(created).toMatchObject({ county: "Marion", source: "clerk", createdBy: IDS.clerkA, note: "form was the 2019 version", reason: null, batchId: null });
    const recent = await repo.listMyRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]).toEqual(created);
    expect((await repo.listFlags()).some((f) => f.id === created.id)).toBe(true);
    expect((await repoFor(CLERK_B).listFlags()).some((f) => f.id === created.id)).toBe(false);
    await repo.softDeleteFlag(created.id);
  });

  it("recent entries are the caller's own only", async () => {
    const mine = await repoFor(CLERK_B).listMyRecent(50);
    expect(mine.map((f) => f.id).sort()).toEqual(["b-fresh", "b-review"]);
    expect(mine.find((f) => f.id === "b-fresh")?.note).toBe("note on b-fresh");
    expect(await repoFor(LEADER).listMyRecent(50)).toEqual([]);
    expect(await repoFor(CLERK_B).listMyRecent(0)).toEqual([]);
  });

  it("a clerk naming another county is refused with 403, and nothing is saved", async () => {
    const before = (await repoFor(ADMIN).listFlags()).length;
    await expect(repoFor(CLERK_A).createFlag(flagInput("Lake"))).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Marion County only") });
    expect((await repoFor(ADMIN).listFlags()).length).toBe(before);
  });

  it("the database refuses the other county even when the session object is wrong about the clerk's county", async () => {
    const wrongCounty = user(IDS.clerkA, "clerk", "Lake");
    await expect(repoFor(wrongCounty).createFlag(flagInput("Lake"))).rejects.toMatchObject({ status: 403, message: "You do not have access to do this." });
  });

  it("a leader cannot add a flag; an admin can, for any county", async () => {
    await expect(repoFor(LEADER).createFlag(flagInput("Marion"))).rejects.toEqual(refused(403));
    const created = await repoFor(ADMIN).createFlag(flagInput("Tippecanoe"));
    expect(created).toMatchObject({ county: "Tippecanoe", createdBy: IDS.admin, note: null });
    await repoFor(ADMIN).softDeleteFlag(created.id);
  });

  it("a note that looks like personal data is refused with 422", async () => {
    await expect(repoFor(CLERK_A).createFlag(flagInput("Marion", "call 317-555-0142 about it"))).rejects.toMatchObject({ status: 422, code: "personal_data" });
  });

  it("input the schema refuses never reaches the database", async () => {
    await expect(repoFor(CLERK_A).createFlag({ ...flagInput("Marion"), date: "2999-01-01" })).rejects.toBeInstanceOf(ZodError);
    await expect(repoFor(CLERK_A).createFlag({ ...flagInput("Marion"), form: "Petition for change of name" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("softDeleteFlag and restoreFlag", () => {
  it("a clerk removes and restores an entry they just added", async () => {
    const repo = repoFor(CLERK_A);
    const created = await repo.createFlag(flagInput("Marion"));
    await repo.softDeleteFlag(created.id);
    expect((await repo.listFlags()).some((f) => f.id === created.id)).toBe(false);
    expect((await repo.listMyRecent(50)).some((f) => f.id === created.id)).toBe(false);
    // Removing twice is fine.
    await repo.softDeleteFlag(created.id);
    await repo.restoreFlag(created.id);
    expect((await repo.listFlags()).some((f) => f.id === created.id)).toBe(true);
    await repo.restoreFlag(created.id);
    await repo.softDeleteFlag(created.id);
  });

  it("a clerk cannot remove their entry after 5 minutes", async () => {
    await expect(repoFor(CLERK_A).softDeleteFlag("a-old")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("5 minutes") });
  });

  it("the database enforces the window even when the app's clock says there is time left", async () => {
    const slowClock = () => new Date(Date.now() - 60 * 60_000);
    await expect(repoFor(CLERK_A, { now: slowClock }).softDeleteFlag("a-old")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("5 minutes") });
    await expect(repoFor(CLERK_A, { now: slowClock }).restoreFlag("a-gone-old")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("5 minutes") });
    const [row] = await db.admin("select deleted_at is null as current from public.filing_flags where id = 'a-old'");
    expect(row.current).toBe(true);
  });

  it("a clerk cannot remove someone else's entry, a sample row, or an entry in another county", async () => {
    await expect(repoFor(CLERK_A).softDeleteFlag("a-by-admin")).rejects.toEqual(refused(403));
    await expect(repoFor(CLERK_A).softDeleteFlag("a-sample")).rejects.toEqual(refused(403));
    // Another county's entry is invisible to the clerk, so it reads as not found.
    await expect(repoFor(CLERK_A).softDeleteFlag("b-fresh")).rejects.toEqual(refused(404));
    await expect(repoFor(CLERK_A).softDeleteFlag("no-such-entry")).rejects.toEqual(refused(404));
  });

  it("a clerk cannot restore their entry after an administrator removed it", async () => {
    const clerk = repoFor(CLERK_A);
    const created = await clerk.createFlag(flagInput("Marion", "second page not signed"));
    await repoFor(ADMIN).softDeleteFlag(created.id);
    await expect(clerk.restoreFlag(created.id)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Ask an administrator") });
    expect((await repoFor(LEADER).listFlags()).some((f) => f.id === created.id)).toBe(false);
    // The administrator can, and after that the clerk's own remove and undo work as before.
    await repoFor(ADMIN).restoreFlag(created.id);
    await clerk.softDeleteFlag(created.id);
    await clerk.restoreFlag(created.id);
    expect((await repoFor(LEADER).listFlags()).some((f) => f.id === created.id)).toBe(true);
    await repoFor(ADMIN).softDeleteFlag(created.id);
  });

  it("a leader cannot remove or restore anything", async () => {
    await expect(repoFor(LEADER).softDeleteFlag("a-fresh")).rejects.toEqual(refused(403));
    await expect(repoFor(LEADER).restoreFlag("a-gone-fresh")).rejects.toEqual(refused(404));
  });

  it("an admin removes and restores any entry at any time", async () => {
    const repo = repoFor(ADMIN);
    await repo.softDeleteFlag("a-sample");
    expect((await repoFor(LEADER).listFlags()).some((f) => f.id === "a-sample")).toBe(false);
    await repo.restoreFlag("a-sample");
    expect((await repoFor(LEADER).listFlags()).some((f) => f.id === "a-sample")).toBe(true);
  });
});

describe("createFlags: the batch name", () => {
  it("is refused when it looks like it holds personal data, and nothing is saved", async () => {
    const before = (await db.admin("select count(*)::int as n from public.import_batches"))[0].n;
    await expect(repoFor(CLERK_A).createFlags(importRows("Marion"), "John Smith 49D01-2401-SC-000123")).rejects.toMatchObject({ status: 422, code: "personal_data" });
    expect((await db.admin("select count(*)::int as n from public.import_batches"))[0].n).toBe(before);
  });
});

describe("createFlags and listNeedsReview", () => {
  it("a clerk imports rows for their county as one batch, and the unsorted one shows up for review with its reason", async () => {
    const repo = repoFor(CLERK_A);
    const result = await repo.createFlags(importRows("Marion"), "May export");
    expect(result.inserted).toBe(2);
    const saved = (await repo.listFlags()).filter((f) => f.batchId === result.batchId);
    expect(saved).toHaveLength(2);
    for (const flag of saved) expect(flag).toMatchObject({ source: "import", outcome: "Rejected", createdBy: IDS.clerkA, county: "Marion" });
    const review = await repo.listNeedsReview();
    expect(review.map((f) => f.reason)).toContain("called filer, will bring it in");
    expect(review.every((f) => f.county === "Marion" && f.tags.includes("Needs review"))).toBe(true);
  });

  it("one row for another county refuses the whole batch", async () => {
    const before = (await repoFor(ADMIN).listFlags()).length;
    const mixed = [...importRows("Marion"), ...importRows("Lake")];
    await expect(repoFor(CLERK_A).createFlags(mixed, "Mixed")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Lake County") });
    // And when only the database is left to notice:
    await expect(repoFor(user(IDS.clerkA, "admin", null)).createFlags(mixed, "Mixed")).rejects.toMatchObject({ status: 403 });
    expect((await repoFor(ADMIN).listFlags()).length).toBe(before);
    const [batches] = await db.admin("select count(*)::int as n from public.import_batches where name = 'Mixed'");
    expect(batches.n).toBe(0);
  });

  it("refuses an empty import, a reason with personal data, and a leader", async () => {
    await expect(repoFor(CLERK_A).createFlags([], "Empty")).rejects.toEqual(refused(400));
    const withPhone = importRows("Marion").map((row) => ({ ...row, reason: "filer phone 317-555-0142" }));
    await expect(repoFor(CLERK_A).createFlags(withPhone, "Phones")).rejects.toMatchObject({ status: 422, code: "personal_data" });
    await expect(repoFor(LEADER).createFlags(importRows("Marion"), "Leader")).rejects.toEqual(refused(403));
  });

  it("a value the database refuses comes back as 400, without the database's own wording", async () => {
    const attempt = repoFor(CLERK_A).createFlags(importRows("Marion"), "n".repeat(81));
    await expect(attempt).rejects.toMatchObject({ status: 400 });
    await expect(attempt).rejects.not.toMatchObject({ message: expect.stringContaining("import_batches") });
  });

  it("needs-review rows: a clerk their county's, an admin every county's, a leader none", async () => {
    const lake = await repoFor(CLERK_B).listNeedsReview();
    expect(lake.map((f) => f.id)).toEqual(["b-review"]);
    expect(lake[0].reason).toBe("reason on b-review");
    const all = await repoFor(ADMIN, { maxRows: 1 }).listNeedsReview();
    expect(all.map((f) => f.id)).toEqual(expect.arrayContaining(["a-review", "b-review"]));
    expect(all.every((f) => f.tags.includes("Needs review"))).toBe(true);
    await expect(repoFor(LEADER).listNeedsReview()).rejects.toMatchObject({ status: 403, message: expect.stringContaining("raw rejection reasons") });
  });
});

describe("change events", () => {
  const input = { name: "Kiosk in the lobby", date: "2024-06-01", county: "Allen", caseType: "Family", tag: "Wrong form", description: "A made-up change." } as const;

  it("everyone with a profile reads them", async () => {
    for (const session of [CLERK_A, CLERK_B, LEADER, ADMIN]) {
      expect((await repoFor(session).listEvents())[0]).toEqual({
        id: "event-1",
        name: "Revised form",
        date: "2024-02-01",
        county: "Marion",
        caseType: "Small claims",
        tag: "Missing signature",
        description: "A made-up change.",
      });
    }
  });

  it("an admin adds, replaces and deletes one", async () => {
    const repo = repoFor(ADMIN);
    const added = await repo.upsertEvent(input);
    expect(added).toEqual({ ...input, id: expect.any(String) });
    const replaced = await repo.upsertEvent({ ...input, id: added.id, name: "Kiosk moved" });
    expect(replaced).toEqual({ ...input, id: added.id, name: "Kiosk moved" });
    expect((await repoFor(LEADER).listEvents()).map((e) => e.name)).toEqual(["Revised form", "Kiosk moved"]);
    await repo.deleteEvent(added.id);
    expect((await repo.listEvents()).map((e) => e.id)).toEqual(["event-1"]);
    await expect(repo.deleteEvent(added.id)).rejects.toEqual(refused(404));
    await expect(repo.upsertEvent({ ...input, id: "no-such-change" })).rejects.toEqual(refused(404));
  });

  it("nobody else can write them, whatever the session object claims", async () => {
    for (const session of [CLERK_A, LEADER]) {
      await expect(repoFor(session).upsertEvent(input)).rejects.toEqual(refused(403));
      await expect(repoFor(session).deleteEvent("event-1")).rejects.toEqual(refused(403));
    }
    const claimsAdmin = user(IDS.clerkA, "admin", null);
    await expect(repoFor(claimsAdmin).upsertEvent(input)).rejects.toEqual(refused(403));
    await expect(repoFor(claimsAdmin).deleteEvent("event-1")).rejects.toEqual(refused(404));
    expect((await repoFor(ADMIN).listEvents()).map((e) => e.id)).toEqual(["event-1"]);
  });
});

describe("folders", () => {
  it("a person's first look gives them the example folders, once", async () => {
    const repo = repoFor(CLERK_B);
    const expected = exampleFoldersFor(CLERK_B);
    expect(expected.length).toBeGreaterThan(0);
    const first = await repo.listFolders();
    expect(first).toEqual(expected);
    for (const folder of first) await repo.deleteFolder(folder.id);
    expect(await repo.listFolders()).toEqual([]);
    expect(await repo.listFolders()).toEqual([]);
  });

  it("a person who already has folders keeps them and gets no examples", async () => {
    expect((await repoFor(LEADER).listFolders()).map((f) => f.id)).toEqual(["folder-l"]);
  });

  it("saves a new folder, replaces it, and deletes it", async () => {
    const repo = repoFor(LEADER);
    const [panel] = exampleFoldersFor(LEADER)[0].panels;
    const saved = await repo.saveFolder({ name: "Monday review", panels: [panel] });
    expect(saved).toEqual({ id: expect.any(String), name: "Monday review", panels: [panel] });
    const replaced = await repo.saveFolder({ id: saved.id, name: "Tuesday review", panels: [] });
    expect(replaced).toEqual({ id: saved.id, name: "Tuesday review", panels: [] });
    expect((await repo.listFolders()).map((f) => f.name)).toEqual(["Leader folder", "Tuesday review"]);
    await repo.deleteFolder(saved.id);
    await expect(repo.deleteFolder(saved.id)).rejects.toEqual(refused(404));
    await expect(repo.saveFolder({ id: saved.id, name: "Gone", panels: [] })).rejects.toEqual(refused(404));
  });

  it("keeps one folder for the open panels however often it is saved without an id", async () => {
    const repo = repoFor(LEADER);
    const [panel] = exampleFoldersFor(LEADER)[0].panels;
    const before = (await repo.listFolders()).length;
    // Two browser tabs that both loaded before the folder existed each save it without an id.
    const first = await repo.saveFolder({ name: "__current", panels: [panel] });
    const second = await repo.saveFolder({ name: "__current", panels: [] });
    expect(second.id).toBe(first.id);
    const current = (await repo.listFolders()).filter((f) => f.name === "__current");
    expect(current).toEqual([{ id: first.id, name: "__current", panels: [] }]);
    expect(await repo.listFolders()).toHaveLength(before + 1);
    // With its id it is replaced as any folder is, and another folder cannot take the name.
    expect((await repo.saveFolder({ id: first.id, name: "__current", panels: [panel] })).panels).toEqual([panel]);
    await expect(repo.saveFolder({ id: "folder-l", name: "__current", panels: [] })).rejects.toEqual(refused(409));
    await repo.deleteFolder(first.id);
  });

  it("two saves of the open panels at the same moment still leave one folder", async () => {
    // The second tab's check ("is there one yet?") runs before the first tab's insert lands: here the
    // check is made to miss, so the insert meets the unique index and the repository replaces instead.
    const session = ADMIN;
    const real = createPgliteGateway(db, { role: "authenticated", userId: session.id });
    let missed = false;
    const racing: typeof real = {
      ...real,
      update: async (table, changes, eq, returning) => {
        if (table === "workspace_folders" && "name" in eq && !missed) {
          missed = true;
          return [];
        }
        return real.update(table, changes, eq, returning);
      },
    };
    const first = await createGatewayRepository(session, real, { today }).saveFolder({ name: "__current", panels: [] });
    const [panel] = exampleFoldersFor(session)[0].panels;
    const second = await createGatewayRepository(session, racing, { today }).saveFolder({ name: "__current", panels: [panel] });
    expect(missed).toBe(true);
    expect(second).toEqual({ id: first.id, name: "__current", panels: [panel] });
    const rows = await db.admin("select id from public.workspace_folders where owner = $1 and name = '__current'", [session.id]);
    expect(rows).toEqual([{ id: first.id }]);
    await db.admin("delete from public.workspace_folders where owner = $1 and name = '__current'", [session.id]);
  });

  it("folders are private: nobody reads, replaces or deletes another person's, the admin included", async () => {
    for (const session of [CLERK_A, ADMIN]) {
      const repo = repoFor(session);
      expect((await repo.listFolders()).some((f) => f.id === "folder-l")).toBe(false);
      await expect(repo.saveFolder({ id: "folder-l", name: "Taken", panels: [] })).rejects.toEqual(refused(404));
      await expect(repo.deleteFolder("folder-l")).rejects.toEqual(refused(404));
    }
    expect((await repoFor(LEADER).listFolders()).map((f) => f.name)).toEqual(["Leader folder"]);
  });

  it("a stored panel that no longer fits the panel contract is dropped, and the rest of the folder is kept", async () => {
    const [panel] = exampleFoldersFor(LEADER)[0].panels;
    await db.admin("update public.workspace_folders set panels = $1::jsonb where id = 'folder-l'", [JSON.stringify([{ id: "old", type: "pie" }, panel])]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const [folder] = await repoFor(LEADER).listFolders();
      expect(folder.panels).toEqual([panel]);
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      await db.admin("update public.workspace_folders set panels = '[]' where id = 'folder-l'");
    }
  });

  it("refuses one folder more than the limit with 409", async () => {
    await db.admin("insert into public.workspace_folders (owner, id, name) select $1, 'bulk-' || n, 'Bulk ' || n from generate_series(1, $2::int) as n", [
      IDS.admin,
      LIMITS.foldersPerUser - 1,
    ]);
    try {
      await expect(repoFor(ADMIN).saveFolder({ name: "One too many", panels: [] })).rejects.toEqual(refused(409));
    } finally {
      await db.admin("delete from public.workspace_folders where owner = $1 and id like 'bulk-%'", [IDS.admin]);
    }
  });
});

describe("audit", () => {
  const entry = (session: SessionUser, id: string) =>
    ({ id, at: "2001-01-01T00:00:00.000Z", userId: session.id, role: session.role, action: "flag.create", entity: "flag", entityId: "a-fresh", detail: { tags: 2, county: "Marion" } }) as const;

  it("anyone with a profile adds entries about themselves; the admin reads them newest first, stamped by the database", async () => {
    await repoFor(CLERK_A).appendAudit(entry(CLERK_A, "10000000-0000-4000-8000-000000000001"));
    await repoFor(LEADER).appendAudit({ ...entry(LEADER, "10000000-0000-4000-8000-000000000002"), action: "folder.save", entity: "folder" });
    const log = await repoFor(ADMIN).listAudit(2);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ id: "10000000-0000-4000-8000-000000000002", userId: IDS.leader, role: "leader", action: "folder.save", entity: "folder" });
    expect(log[1]).toMatchObject({ id: "10000000-0000-4000-8000-000000000001", userId: IDS.clerkA, role: "clerk", detail: { tags: 2, county: "Marion" } });
    // The time is the database's, not the one the caller sent.
    expect(Math.abs(new Date(log[0].at).getTime() - Date.now())).toBeLessThan(60_000);
    expect((await repoFor(ADMIN, { maxRows: 1 }).listAudit(3)).map((e) => e.id).slice(0, 2)).toEqual(log.map((e) => e.id));
    expect(await repoFor(ADMIN).listAudit(0)).toEqual([]);
  });

  it("nobody but the admin reads the log", async () => {
    for (const session of [CLERK_A, CLERK_B, LEADER]) await expect(repoFor(session).listAudit(10)).rejects.toEqual(refused(403));
  });

  it("an entry can only be written for the signed-in person, in the app and in the database", async () => {
    await expect(repoFor(CLERK_A).appendAudit(entry(ADMIN, "10000000-0000-4000-8000-000000000003"))).rejects.toEqual(refused(403));
    const claimsAdmin = user(IDS.clerkA, "admin", null);
    await expect(repoFor(claimsAdmin).appendAudit(entry(claimsAdmin, "10000000-0000-4000-8000-000000000004"))).rejects.toEqual(refused(403));
  });
});

describe("signing in: the profile decides", () => {
  const gatewayAs = (userId: string) => createPgliteGateway(db, { role: "authenticated", userId });

  it("a person with a profile gets their role and county from it", async () => {
    expect(await loadSessionUser(gatewayAs(IDS.clerkA), { id: IDS.clerkA, email: "a@example.invalid" })).toEqual({
      id: IDS.clerkA,
      email: "a@example.invalid",
      role: "clerk",
      county: "Marion",
    });
    expect(await loadSessionUser(gatewayAs(IDS.leader), { id: IDS.leader, email: "l@example.invalid" })).toMatchObject({ role: "leader", county: null });
    expect(await loadSessionUser(gatewayAs(IDS.admin), { id: IDS.admin, email: "d@example.invalid" })).toMatchObject({ role: "admin", county: null });
  });

  it("a signed-in person with no profile is not a session", async () => {
    expect(await loadSessionUser(gatewayAs(IDS.stranger), { id: IDS.stranger, email: "s@example.invalid" })).toBeNull();
  });

  it("nobody can load someone else's profile as their own session", async () => {
    // The gateway acts as the stranger; the admin's profile row is invisible to them.
    expect(await loadSessionUser(gatewayAs(IDS.stranger), { id: IDS.admin, email: "s@example.invalid" })).toBeNull();
    expect(await loadSessionUser(gatewayAs(IDS.clerkA), { id: IDS.admin, email: "a@example.invalid" })).toBeNull();
  });
});

describe("MCP tokens", () => {
  const service = () => createPgliteGateway(db, SERVICE, { maxRows: 4 });
  const lookup = async (hash: string) => tokenUserFromRows((await service().call("mcp_token_user", { p_token_hash: hash })).rows, hash);

  it("a live token resolves to its holder; a revoked or unknown one to nobody", async () => {
    expect(await lookup(TOKEN_HASH)).toEqual({ id: IDS.leader, email: "leader@example.invalid", role: "leader", county: null });
    expect(await lookup(CLERK_TOKEN_HASH)).toEqual({ id: IDS.clerkA, email: "clerk-a@example.invalid", role: "clerk", county: "Marion" });
    expect(await lookup(REVOKED_TOKEN_HASH)).toBeNull();
    expect(await lookup("d".repeat(64))).toBeNull();
  });

  it("a row for a different hash is never accepted", async () => {
    const { rows } = await service().call("mcp_token_user", { p_token_hash: TOKEN_HASH });
    expect(tokenUserFromRows(rows, CLERK_TOKEN_HASH)).toBeNull();
    expect(tokenUserFromRows(rows, "short")).toBeNull();
    expect(tokenUserFromRows([], TOKEN_HASH)).toBeNull();
  });

  it("a token reads exactly what its holder reads in the app, and no free text", async () => {
    const byId = (flags: { id: string }[]) => [...flags].sort((a, b) => a.id.localeCompare(b.id));
    const leaderToken = createTokenRepository(createMcpReader(service(), TOKEN_HASH));
    expect(byId(await leaderToken.listFlags())).toEqual(byId(await repoFor(LEADER).listFlags()));
    expect(await leaderToken.listEvents()).toEqual(await repoFor(LEADER).listEvents());
    const clerkToken = createTokenRepository(createMcpReader(service(), CLERK_TOKEN_HASH));
    const flags = await clerkToken.listFlags();
    expect(byId(flags)).toEqual(byId(await repoFor(CLERK_A).listFlags()));
    expect(flags.every((flag) => flag.county === "Marion")).toBe(true);
    for (const flag of flags) {
      expect(flag).not.toHaveProperty("note");
      expect(flag).not.toHaveProperty("reason");
    }
  });

  it("a revoked token reads nothing", async () => {
    const revoked = createTokenRepository(createMcpReader(service(), REVOKED_TOKEN_HASH));
    expect(await revoked.listFlags()).toEqual([]);
    expect(await revoked.listEvents()).toEqual([]);
  });

  it("a token can do nothing but read statistics", async () => {
    const repo = createTokenRepository(createMcpReader(service(), TOKEN_HASH));
    const attempts = [
      repo.listMyRecent(10),
      repo.listNeedsReview(),
      repo.createFlag(flagInput("Marion")),
      repo.createFlags(importRows("Marion"), "Token"),
      repo.softDeleteFlag("a-fresh"),
      repo.restoreFlag("a-gone-fresh"),
      repo.deleteEvent("event-1"),
      repo.listFolders(),
      repo.deleteFolder("folder-l"),
      repo.listAudit(10),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toEqual(refused(403));
  });
});

describe("toHttpError", () => {
  it("maps what the database says to what the caller should see", () => {
    const status = (code: string) => {
      const error = toHttpError(new DbError(code, 'new row violates row-level security policy for table "filing_flags"'));
      return error instanceof HttpError ? error.status : 500;
    };
    expect(status("42501")).toBe(403);
    expect(status("23514")).toBe(400);
    expect(status("23502")).toBe(400);
    expect(status("23503")).toBe(400);
    expect(status("22007")).toBe(400);
    expect(status("22P02")).toBe(400);
    expect(status("23505")).toBe(409);
    expect(status("PGRST301")).toBe(401);
    expect(status("53300")).toBe(500);
    expect(status("")).toBe(500);
  });

  it("never passes the database's wording on in a refusal", () => {
    for (const code of ["42501", "23514", "23505", "PGRST301"]) {
      expect(toHttpError(new DbError(code, 'violates check constraint "filing_flags_note_length"')).message).not.toContain("filing_flags");
    }
  });
});
