import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoUserById } from "@/lib/sample";
import type { SessionUser } from "@/lib/domain";
import { classifyByRules, classifyReasons } from "@/server/ai/classify";
import { audit, cleanAuditDetail } from "@/server/audit";
import { getRepository } from "@/server/repo";
import { resetMemoryStore } from "@/server/repo/memory";

const ADMIN = demoUserById("demo-admin") as SessionUser;
const CLERK = demoUserById("demo-clerk-marion") as SessionUser;

describe("classifyReasons (rules)", () => {
  const rows = [
    { id: "1", reason: "no signature on page 2" },
    { id: "2", reason: "called filer - will bring in tomorrow" },
    { id: "3", reason: "" },
    { id: "4", reason: "filing fee not paid" },
  ];

  it("returns one result per row, in order, with the caller's ids", async () => {
    const results = await classifyReasons(rows, { useAi: false });
    expect(results).toEqual([
      { id: "1", tags: ["Missing signature", "Pages missing or unreadable"], confidence: "medium", source: "rules" },
      { id: "2", tags: ["Needs review"], confidence: "low", source: "rules" },
      { id: "3", tags: ["Needs review"], confidence: "low", source: "rules" },
      { id: "4", tags: ["Missing fee or fee waiver"], confidence: "medium", source: "rules" },
    ]);
  });

  it("answers with the rules when AI is asked for but not enabled", async () => {
    expect(await classifyReasons(rows, { useAi: true })).toEqual(await classifyReasons(rows, { useAi: false }));
  });

  it("handles no rows", async () => {
    expect(await classifyReasons([], { useAi: false })).toEqual([]);
  });

  it("classifyByRules never returns an empty tag list", () => {
    for (const reason of ["", "   ", "???", "something nobody anticipated"]) {
      expect(classifyByRules({ id: "x", reason }).tags).toEqual(["Needs review"]);
    }
  });
});

describe("audit", () => {
  beforeEach(() => {
    resetMemoryStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes an entry the admin can read, stamped with the user, role and time", async () => {
    await audit(CLERK, "flag.create", "flag", "flag-1", { county: "Marion", problems: 2, hasNote: true });
    const entries = await (await getRepository(ADMIN)).listAudit(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: "demo-clerk-marion",
      role: "clerk",
      action: "flag.create",
      entity: "flag",
      entityId: "flag-1",
      detail: { county: "Marion", problems: 2, hasNote: true },
    });
    expect(entries[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(entries[0].at))).toBe(false);
  });

  it("never stores note or reason text, and shortens long values", async () => {
    const detail = cleanAuditDetail({ note: "page 2 was unsigned", Reason: "raw reason text", csv: "a,b", text: "free text", rows: 3, name: "x".repeat(300), ok: null });
    expect(detail).toEqual({ rows: 3, name: `${"x".repeat(117)}...`, ok: null });
    await audit(CLERK, "flag.create", "flag", "flag-2", { note: "page 2 was unsigned", problems: 1 });
    const entries = await (await getRepository(ADMIN)).listAudit(10);
    expect(JSON.stringify(entries)).not.toContain("unsigned");
    expect(entries[0].detail).toEqual({ problems: 1 });
  });

  it("logs a failed audit write and does not throw", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    // Make the repository unavailable for this one call.
    const repoModule = await import("@/server/repo");
    vi.spyOn(repoModule, "getRepository").mockRejectedValueOnce(new Error("store unavailable"));
    await expect(audit(CLERK, "flag.delete", "flag", "flag-3")).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorLog.mock.calls[0][0]))).toMatchObject({
      event: "audit_write_failed",
      userId: "demo-clerk-marion",
      action: "flag.delete",
      entityId: "flag-3",
      error: "store unavailable",
    });
  });
});

describe("getRepository", () => {
  it("gives the memory repository in demo mode, scoped to the session", async () => {
    resetMemoryStore();
    expect(await (await getRepository(CLERK)).listFlags()).toHaveLength(284);
    expect(await (await getRepository(ADMIN)).listFlags()).toHaveLength(900);
  });
});
