import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, DemoLoginResponse, HealthResponse, ImportCommitResponse, ImportPreviewResponse, MeResponse } from "@/lib/api";
import type { AuditEntry, ChangeEvent, FlagRecord, LeanFlag } from "@/lib/domain";
import type { Folder } from "@/lib/panels";
import { SAMPLE_CSV, sampleCsv } from "@/lib/sample";
import type { DemoUserId } from "@/lib/sample";
import { DEMO_COOKIE } from "@/server/auth/demoCookie";
import type { RouteHandler } from "@/server/http";
import { resetRateLimits } from "@/server/ratelimit";
import { resetMemoryStore } from "@/server/repo/memory";
import { clearCookies, cookieJar } from "./cookies";

import * as auditRoute from "@/app/api/audit/route";
import * as loginRoute from "@/app/api/demo/login/route";
import * as logoutRoute from "@/app/api/demo/logout/route";
import * as resetRoute from "@/app/api/demo/reset/route";
import * as eventRoute from "@/app/api/events/[id]/route";
import * as eventsRoute from "@/app/api/events/route";
import * as restoreRoute from "@/app/api/flags/[id]/restore/route";
import * as flagRoute from "@/app/api/flags/[id]/route";
import * as needsReviewRoute from "@/app/api/flags/needs-review/route";
import * as recentRoute from "@/app/api/flags/recent/route";
import * as flagsRoute from "@/app/api/flags/route";
import * as folderRoute from "@/app/api/folders/[id]/route";
import * as foldersRoute from "@/app/api/folders/route";
import * as healthRoute from "@/app/api/health/route";
import * as commitRoute from "@/app/api/import/commit/route";
import * as previewRoute from "@/app/api/import/preview/route";
import * as meRoute from "@/app/api/me/route";

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const BASE = "http://localhost:3000";

interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}

async function call<T = unknown>(handler: RouteHandler<never>, method: string, path: string, options: CallOptions = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = { host: "localhost:3000", ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    headers["content-type"] ??= "application/json";
  }
  const request = new Request(`${BASE}${path}`, { method, headers, body });
  const response = await handler(request, { params: Promise.resolve((options.params ?? {}) as never) });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T, headers: response.headers };
}

const h = <P>(handler: RouteHandler<P>) => handler as RouteHandler<never>;

async function signIn(userId: DemoUserId): Promise<void> {
  const result = await call(h(loginRoute.POST), "POST", "/api/demo/login", { body: { userId } });
  expect(result.status).toBe(200);
}

const errorOf = (result: { body: unknown }) => (result.body as ApiErrorBody).error;

const newFlag = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-10-30",
  county: "Marion",
  caseType: "Small claims",
  form: "Small claims notice of claim",
  tags: ["Missing signature", "Wrong county or court"],
  outcome: "Returned to fix",
  ...overrides,
});

beforeEach(async () => {
  clearCookies();
  resetMemoryStore();
  await resetRateLimits();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers without a session", async () => {
    const result = await call<HealthResponse>(h(healthRoute.GET), "GET", "/api/health");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, mode: "demo", ai: false });
    expect(Number.isNaN(Date.parse(result.body.time))).toBe(false);
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
});

describe("demo sign-in", () => {
  it("POST /api/demo/login sets the session cookie and returns the user", async () => {
    const result = await call<DemoLoginResponse>(h(loginRoute.POST), "POST", "/api/demo/login", { body: { userId: "demo-clerk-lake" } });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ user: { id: "demo-clerk-lake", email: "clerk.lake@demo.invalid", role: "clerk", county: "Lake" } });
    expect(cookieJar.get(DEMO_COOKIE)?.value).toMatch(/^v1\.demo-clerk-lake\.\d+\./);
  });

  it("refuses an unknown account, extra fields and a cross-site request", async () => {
    expect((await call(h(loginRoute.POST), "POST", "/api/demo/login", { body: { userId: "root" } })).status).toBe(400);
    expect((await call(h(loginRoute.POST), "POST", "/api/demo/login", { body: { userId: "demo-admin", role: "admin" } })).status).toBe(400);
    const crossSite = await call(h(loginRoute.POST), "POST", "/api/demo/login", { body: { userId: "demo-admin" }, headers: { origin: "https://evil.example" } });
    expect(crossSite.status).toBe(403);
    expect(errorOf(crossSite).code).toBe("bad_origin");
    expect(cookieJar.get(DEMO_COOKIE)).toBeUndefined();
  });

  it("limits sign-in attempts, and a caller cannot get a fresh allowance by sending another X-Forwarded-For", async () => {
    // No proxy is trusted by default, so the header is the caller's own text and every caller is counted together.
    const attempt = (address: string) => call(h(loginRoute.POST), "POST", "/api/demo/login", { body: { userId: "demo-leader" }, headers: { "x-forwarded-for": address } });
    for (let i = 0; i < 120; i++) expect((await attempt(`203.0.113.${i % 250}`)).status).toBe(200);
    const refused = await attempt("198.51.100.7");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("1");
    expect((await call(h(loginRoute.POST), "POST", "/api/demo/login", { body: { userId: "demo-leader" } })).status).toBe(429);
  });

  it("GET /api/me needs a session, then describes it", async () => {
    const anonymous = await call(h(meRoute.GET), "GET", "/api/me");
    expect(anonymous.status).toBe(401);
    expect(errorOf(anonymous)).toMatchObject({ code: "unauthorized", message: "Sign in to continue." });
    expect(errorOf(anonymous).requestId).toBe(anonymous.headers.get("x-request-id"));

    await signIn("demo-clerk-marion");
    const me = await call<MeResponse>(h(meRoute.GET), "GET", "/api/me");
    expect(me.body).toEqual({
      user: { id: "demo-clerk-marion", email: "clerk.marion@demo.invalid", role: "clerk", county: "Marion" },
      mode: "demo",
      ai: false,
      today: "2026-10-30",
    });
  });

  it("POST /api/demo/logout clears the session and is safe to repeat", async () => {
    await signIn("demo-admin");
    expect((await call(h(logoutRoute.POST), "POST", "/api/demo/logout")).body).toEqual({ ok: true });
    expect((await call(h(meRoute.GET), "GET", "/api/me")).status).toBe(401);
    expect((await call(h(logoutRoute.POST), "POST", "/api/demo/logout")).status).toBe(200);
  });
});

describe("every protected route answers 401 without a session", () => {
  it.each([
    ["GET /api/flags", h(flagsRoute.GET), "GET", "/api/flags", {}],
    ["POST /api/flags", h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() }],
    ["DELETE /api/flags/[id]", h(flagRoute.DELETE), "DELETE", "/api/flags/s0", { params: { id: "s0" } }],
    ["POST /api/flags/[id]/restore", h(restoreRoute.POST), "POST", "/api/flags/s0/restore", { params: { id: "s0" } }],
    ["GET /api/flags/recent", h(recentRoute.GET), "GET", "/api/flags/recent", {}],
    ["GET /api/flags/needs-review", h(needsReviewRoute.GET), "GET", "/api/flags/needs-review", {}],
    ["POST /api/import/preview", h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv: SAMPLE_CSV } }],
    ["POST /api/import/commit", h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [{}] } }],
    ["GET /api/events", h(eventsRoute.GET), "GET", "/api/events", {}],
    ["POST /api/events", h(eventsRoute.POST), "POST", "/api/events", { body: {} }],
    ["DELETE /api/events/[id]", h(eventRoute.DELETE), "DELETE", "/api/events/sc-form", { params: { id: "sc-form" } }],
    ["GET /api/folders", h(foldersRoute.GET), "GET", "/api/folders", {}],
    ["POST /api/folders", h(foldersRoute.POST), "POST", "/api/folders", { body: {} }],
    ["DELETE /api/folders/[id]", h(folderRoute.DELETE), "DELETE", "/api/folders/x", { params: { id: "x" } }],
    ["GET /api/audit", h(auditRoute.GET), "GET", "/api/audit", {}],
    ["POST /api/demo/reset", h(resetRoute.POST), "POST", "/api/demo/reset", {}],
  ] as [string, RouteHandler<never>, string, string, CallOptions][])("%s", async (_name, handler, method, path, options) => {
    const result = await call(handler, method, path, options);
    expect(result.status).toBe(401);
    expect(errorOf(result).code).toBe("unauthorized");
  });
});

describe("flags", () => {
  it("GET /api/flags returns lean flags for the caller's scope", async () => {
    await signIn("demo-clerk-marion");
    const marion = await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags");
    expect(marion.body).toHaveLength(284);
    expect(Object.keys(marion.body[0]).sort()).toEqual(["batchId", "caseType", "county", "createdAt", "createdBy", "date", "form", "id", "outcome", "source", "tags"]);
    await signIn("demo-leader");
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(900);
  });

  it("a clerk tags a filing, sees it in recent entries, and the leader's total goes up by one", async () => {
    await signIn("demo-clerk-marion");
    const created = await call<FlagRecord>(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ note: "second page unsigned" }) });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ county: "Marion", source: "clerk", createdBy: "demo-clerk-marion", note: "second page unsigned", tags: ["Missing signature", "Wrong county or court"] });

    const recent = await call<FlagRecord[]>(h(recentRoute.GET), "GET", "/api/flags/recent");
    expect(recent.body.map((f) => f.id)).toEqual([created.body.id]);
    expect(recent.body[0].note).toBe("second page unsigned");

    await signIn("demo-leader");
    const all = await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags");
    expect(all.body).toHaveLength(901);
    expect(JSON.stringify(all.body)).not.toContain("second page unsigned");
    expect((await call<FlagRecord[]>(h(recentRoute.GET), "GET", "/api/flags/recent")).body).toEqual([]);
  });

  it("a clerk naming another county gets 403, and nothing is saved", async () => {
    await signIn("demo-clerk-marion");
    const result = await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ county: "Lake" }) });
    expect(result.status).toBe(403);
    expect(errorOf(result).message).toBe("You can add filings for Marion County only. This request names Lake County.");
    await signIn("demo-admin");
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(900);
  });

  it("a leader cannot tag a filing", async () => {
    await signIn("demo-leader");
    expect((await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() })).status).toBe(403);
  });

  it("a note with personal data is refused with 422 and the findings", async () => {
    await signIn("demo-clerk-marion");
    const result = await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ note: "call John Smith at 317-555-0142" }) });
    expect(result.status).toBe(422);
    expect(errorOf(result)).toMatchObject({
      code: "personal_data",
      message: "This looks like it contains a phone number and a person's name. The tracker does not store anything that identifies a person.",
      findings: [
        { kind: "name", match: "John Smith", index: 5 },
        { kind: "phone", match: "317-555-0142", index: 19 },
      ],
    });
    expect((await call<FlagRecord[]>(h(recentRoute.GET), "GET", "/api/flags/recent")).body).toEqual([]);
  });

  it("invalid input is refused with 400 and the fields at fault", async () => {
    await signIn("demo-clerk-marion");
    const result = await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ tags: [], date: "2026-11-05", outcome: "Lost" }) });
    expect(result.status).toBe(400);
    expect(errorOf(result).code).toBe("invalid_input");
    expect(errorOf(result).issues?.map((i) => i.path).sort()).toEqual(["outcome", "tags"]);
    const future = await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ date: "2026-11-05" }) });
    expect(errorOf(future).issues).toEqual([{ path: "date", message: "The date cannot be in the future." }]);
    expect((await call(h(flagsRoute.POST), "POST", "/api/flags", { body: "{oops" })).status).toBe(400);
    expect((await call(h(flagsRoute.POST), "POST", "/api/flags", { body: "a,b", headers: { "content-type": "text/csv" } })).status).toBe(415);
  });

  it("undo: delete then restore the caller's own entry", async () => {
    await signIn("demo-clerk-marion");
    const created = await call<FlagRecord>(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() });
    const id = created.body.id;
    expect((await call(h(flagRoute.DELETE), "DELETE", `/api/flags/${id}`, { params: { id } })).body).toEqual({ ok: true });
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(284);
    expect((await call(h(restoreRoute.POST), "POST", `/api/flags/${id}/restore`, { params: { id } })).body).toEqual({ ok: true });
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(285);
  });

  it("a Marion clerk cannot delete a Lake clerk's entry (403), a sample row (403) or a missing one (404)", async () => {
    await signIn("demo-clerk-lake");
    const lake = await call<FlagRecord>(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ county: "Lake" }) });
    await signIn("demo-clerk-marion");
    const id = lake.body.id;
    expect((await call(h(flagRoute.DELETE), "DELETE", `/api/flags/${id}`, { params: { id } })).status).toBe(403);
    expect((await call(h(restoreRoute.POST), "POST", `/api/flags/${id}/restore`, { params: { id } })).status).toBe(403);
    expect((await call(h(flagRoute.DELETE), "DELETE", "/api/flags/s0", { params: { id: "s0" } })).status).toBe(403);
    expect((await call(h(flagRoute.DELETE), "DELETE", "/api/flags/nope", { params: { id: "nope" } })).status).toBe(404);
    await signIn("demo-leader");
    expect((await call(h(flagRoute.DELETE), "DELETE", `/api/flags/${id}`, { params: { id } })).status).toBe(403);
    await signIn("demo-admin");
    expect((await call(h(flagRoute.DELETE), "DELETE", `/api/flags/${id}`, { params: { id } })).status).toBe(200);
  });

  it("GET /api/flags/recent takes a limit from 1 to 50", async () => {
    await signIn("demo-clerk-marion");
    for (let i = 0; i < 3; i++) await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() });
    expect((await call<FlagRecord[]>(h(recentRoute.GET), "GET", "/api/flags/recent?limit=2")).body).toHaveLength(2);
    expect((await call<FlagRecord[]>(h(recentRoute.GET), "GET", "/api/flags/recent")).body).toHaveLength(3);
    for (const bad of ["0", "51", "abc", "2.5"]) {
      expect((await call(h(recentRoute.GET), "GET", `/api/flags/recent?limit=${bad}`)).status).toBe(400);
    }
  });

  it("state-changing flag routes refuse a cross-site request before doing anything", async () => {
    await signIn("demo-clerk-marion");
    const result = await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag(), headers: { origin: "https://evil.example" } });
    expect(result.status).toBe(403);
    expect(errorOf(result).code).toBe("bad_origin");
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(284);
  });

  it("mutations are limited to 60 a minute per user, with Retry-After", async () => {
    await signIn("demo-clerk-marion");
    for (let i = 0; i < 60; i++) {
      expect((await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() })).status).toBe(201);
    }
    const refused = await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() });
    expect(refused.status).toBe(429);
    expect(errorOf(refused).code).toBe("rate_limited");
    expect(refused.headers.get("retry-after")).toBe("1");
    // Reading is not limited, and another user is not affected.
    expect((await call(h(flagsRoute.GET), "GET", "/api/flags")).status).toBe(200);
    await signIn("demo-clerk-lake");
    expect((await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ county: "Lake" }) })).status).toBe(201);
  });
});

describe("import", () => {
  it("preview sorts the sample export with the rules and saves nothing", async () => {
    await signIn("demo-admin");
    const result = await call<ImportPreviewResponse>(h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv: SAMPLE_CSV } });
    expect(result.status).toBe(200);
    expect(result.body.summary).toEqual({ read: 10, accepted: 10, sorted: 9, needsReview: 1, rejected: 0 });
    expect(result.body.classifier).toEqual({ used: "rules", aiAvailable: false });
    expect(result.body.rows[0]).toEqual({
      line: 1,
      date: "2026-09-02",
      county: "Hamilton",
      caseType: "Small claims",
      form: "Small claims notice of claim",
      reason: "no signature on page 2",
      tags: ["Missing signature", "Pages missing or unreadable"],
      confidence: "medium",
      source: "rules",
    });
    expect(result.body.rows[7]).toMatchObject({ line: 8, reason: "called filer - will bring in tomorrow", tags: ["Needs review"], confidence: "low" });
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(900);
  });

  it("preview with useAi answers with the rules when AI is not enabled", async () => {
    await signIn("demo-admin");
    const result = await call<ImportPreviewResponse>(h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv: SAMPLE_CSV, useAi: true } });
    expect(result.body.classifier).toEqual({ used: "rules", aiAvailable: false });
    expect(result.body.rows.every((row) => row.source === "rules")).toBe(true);
  });

  it("preview lists rejected rows with the reason: bad values, personal data, and other counties for a clerk", async () => {
    await signIn("demo-clerk-marion");
    const csv = [
      "date,county,case_type,form,reason",
      "2026-09-02,Marion,Small claims,Small claims notice of claim,unsigned",
      "2026-09-03,Lake,Small claims,Small claims notice of claim,unsigned",
      "2026-13-03,Marion,Small claims,Small claims notice of claim,unsigned",
      "2026-09-04,Marion,Small claims,Small claims notice of claim,see case 49D01-2401-SC-000123",
    ].join("\n");
    const result = await call<ImportPreviewResponse>(h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv } });
    expect(result.body.summary).toEqual({ read: 4, accepted: 1, sorted: 1, needsReview: 0, rejected: 3 });
    expect(result.body.rows.map((r) => r.line)).toEqual([1]);
    expect(result.body.rejected.map((r) => [r.line, r.problems])).toEqual([
      [2, ["This row is for Lake County. You can add rows for Marion County only."]],
      [3, ["The date is not a real date in the form YYYY-MM-DD."]],
      [4, ["This looks like it contains a case number. The tracker does not store anything that identifies a person."]],
    ]);
  });

  it("preview refuses an unusable file with a plain message, and a leader altogether", async () => {
    await signIn("demo-admin");
    const noReason = await call(h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv: "date,county,case_type,form\n2026-09-02,Marion,Small claims,x" } });
    expect(noReason.status).toBe(400);
    expect(errorOf(noReason)).toMatchObject({ code: "invalid_csv", message: "The header needs a column named reason." });
    expect((await call(h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv: "" } })).status).toBe(400);
    expect((await call(h(previewRoute.POST), "POST", "/api/import/preview", { body: {} })).status).toBe(400);
    await signIn("demo-leader");
    expect((await call(h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv: SAMPLE_CSV } })).status).toBe(403);
  });

  it("commit saves the reviewed rows as one batch; they appear on the dashboard and in needs-review", async () => {
    await signIn("demo-clerk-lake");
    const preview = await call<ImportPreviewResponse>(h(previewRoute.POST), "POST", "/api/import/preview", { body: { csv: sampleCsv("Lake") } });
    expect(preview.body.summary.accepted).toBe(10);
    const rows = preview.body.rows.map(({ date, county, caseType, form, reason, tags }) => ({ date, county, caseType, form, reason, tags }));
    const commit = await call<ImportCommitResponse>(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows, batchName: "September export" } });
    expect(commit.status).toBe(201);
    expect(commit.body.inserted).toBe(10);
    expect(commit.body.batchId).toMatch(/^[0-9a-f-]{36}$/);

    const needsReview = await call<FlagRecord[]>(h(needsReviewRoute.GET), "GET", "/api/flags/needs-review");
    expect(needsReview.body.map((f) => f.reason)).toEqual(["called filer - will bring in tomorrow"]);
    expect(needsReview.body[0]).toMatchObject({ county: "Lake", source: "import", outcome: "Rejected", batchId: commit.body.batchId });

    await signIn("demo-leader");
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(910);
    expect((await call(h(needsReviewRoute.GET), "GET", "/api/flags/needs-review")).status).toBe(403);
  });

  it("commit refuses a batch name that looks like it holds personal data, as it does a reason", async () => {
    await signIn("demo-clerk-marion");
    const row = { date: "2026-09-02", county: "Marion", caseType: "Small claims", form: "Small claims notice of claim", reason: "no signature", tags: ["Missing signature"] };
    const refused = await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [row], batchName: "John Smith 49D01-2401-SC-000123 317-555-1212" } });
    expect(refused.status).toBe(422);
    expect(errorOf(refused).code).toBe("personal_data");
    expect(errorOf(refused).message).toContain("The batch name:");
    expect(errorOf(refused).findings?.map((finding) => finding.kind).sort()).toEqual(["case_number", "name", "phone"]);
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(284);
    // An ordinary name is fine, and so is none.
    expect((await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [row], batchName: "September export, Marion" } })).status).toBe(201);
    expect((await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [row] } })).status).toBe(201);
  });

  it("commit trusts nothing from the client: bad rows, personal data and other counties are refused and nothing is saved", async () => {
    await signIn("demo-clerk-marion");
    const good = { date: "2026-09-02", county: "Marion", caseType: "Small claims", form: "Small claims notice of claim", reason: "unsigned", tags: ["Missing signature"] };

    const invalid = await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [good, { ...good, tags: ["Made up"] }, { ...good, date: "2027-01-01" }] } });
    expect(invalid.status).toBe(400);
    expect(errorOf(invalid).issues).toEqual([
      { path: "rows.1.tags.0", message: "Problem is not on the list." },
      { path: "rows.2.date", message: "The date cannot be in the future." },
    ]);

    const personal = await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [good, { ...good, reason: "email filer@example.com" }] } });
    expect(personal.status).toBe(422);
    expect(errorOf(personal)).toMatchObject({
      code: "personal_data",
      message: "1 row has a reason that looks like it contains personal data. Nothing was added.",
      rows: [{ row: 1, findings: [{ kind: "email", match: "filer@example.com", index: 6 }] }],
    });

    const twoPersonal = await call(h(commitRoute.POST), "POST", "/api/import/commit", {
      body: { rows: [{ ...good, reason: "call 317-555-0142" }, good, { ...good, reason: "John Smith came back" }] },
    });
    expect(errorOf(twoPersonal).message).toBe("2 rows have reasons that look like they contain personal data. Nothing was added.");
    expect(errorOf(twoPersonal).rows?.map((r) => r.row)).toEqual([0, 2]);

    const otherCounty = await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [good, { ...good, county: "Lake" }] } });
    expect(otherCounty.status).toBe(403);

    expect((await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [] } })).status).toBe(400);
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(284);

    await signIn("demo-leader");
    expect((await call(h(commitRoute.POST), "POST", "/api/import/commit", { body: { rows: [good] } })).status).toBe(403);
  });
});

describe("events", () => {
  const input = { name: "New guide", date: "2026-09-01", county: "Monroe", caseType: "Eviction", tag: "Wrong form", description: "A one-page guide." };

  it("everyone reads; only an admin adds, replaces and deletes", async () => {
    await signIn("demo-clerk-marion");
    expect((await call<ChangeEvent[]>(h(eventsRoute.GET), "GET", "/api/events")).body.map((e) => e.id)).toEqual(["sc-form", "po-guide", "fam-kiosk"]);
    expect((await call(h(eventsRoute.POST), "POST", "/api/events", { body: input })).status).toBe(403);
    expect((await call(h(eventRoute.DELETE), "DELETE", "/api/events/sc-form", { params: { id: "sc-form" } })).status).toBe(403);
    await signIn("demo-leader");
    expect((await call(h(eventsRoute.POST), "POST", "/api/events", { body: input })).status).toBe(403);

    await signIn("demo-admin");
    const created = await call<ChangeEvent>(h(eventsRoute.POST), "POST", "/api/events", { body: input });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject(input);
    const replaced = await call<ChangeEvent>(h(eventsRoute.POST), "POST", "/api/events", { body: { ...input, id: created.body.id, name: "Renamed" } });
    expect(replaced.status).toBe(200);
    expect(replaced.body.name).toBe("Renamed");
    expect((await call<ChangeEvent[]>(h(eventsRoute.GET), "GET", "/api/events")).body).toHaveLength(4);
    const id = created.body.id;
    expect((await call(h(eventRoute.DELETE), "DELETE", `/api/events/${id}`, { params: { id } })).body).toEqual({ ok: true });
    expect((await call(h(eventRoute.DELETE), "DELETE", `/api/events/${id}`, { params: { id } })).status).toBe(404);
  });

  it("refuses a change whose name or description holds an identifier, with 422 and the findings", async () => {
    await signIn("demo-admin");
    for (const patch of [{ name: "Form for case 49D01-2401-SC-000123" }, { description: "Questions go to 317-555-0142." }, { description: "Write to someone@example.org." }]) {
      const refused = await call(h(eventsRoute.POST), "POST", "/api/events", { body: { ...input, ...patch } });
      expect(refused.status).toBe(422);
      expect(errorOf(refused).code).toBe("personal_data");
      expect(errorOf(refused).findings?.length).toBeGreaterThan(0);
    }
    // The name of a program reads like a person's name to the pattern check. That is a warning in the form, not a refusal.
    const program = await call<ChangeEvent>(h(eventsRoute.POST), "POST", "/api/events", { body: { ...input, name: "Self Help Kiosk" } });
    expect(program.status).toBe(201);
    expect((await call<ChangeEvent[]>(h(eventsRoute.GET), "GET", "/api/events")).body).toHaveLength(4);
  });

  it("refuses invalid input", async () => {
    await signIn("demo-admin");
    const result = await call(h(eventsRoute.POST), "POST", "/api/events", { body: { ...input, county: "Cook", date: "2026-12-25" } });
    expect(result.status).toBe(400);
    expect(errorOf(result).issues).toEqual([{ path: "county", message: "County is not on the list." }]);
  });
});

describe("folders", () => {
  const panel = { id: "p1", title: "Key numbers", size: "w", type: "kpi", params: { county: "Lake" } };

  it("each user reads, saves and deletes their own", async () => {
    await signIn("demo-leader");
    expect((await call<Folder[]>(h(foldersRoute.GET), "GET", "/api/folders")).body.map((f) => f.name)).toEqual(["Marion small claims", "Lake protective orders", "County comparison"]);
    const saved = await call<Folder>(h(foldersRoute.POST), "POST", "/api/folders", { body: { name: "Lake numbers", panels: [panel] } });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ name: "Lake numbers", panels: [panel] });
    const id = saved.body.id;
    const replaced = await call<Folder>(h(foldersRoute.POST), "POST", "/api/folders", { body: { id, name: "Lake numbers", panels: [] } });
    expect(replaced.status).toBe(200);

    await signIn("demo-admin");
    expect((await call<Folder[]>(h(foldersRoute.GET), "GET", "/api/folders")).body.map((f) => f.id)).not.toContain(id);
    expect((await call(h(folderRoute.DELETE), "DELETE", `/api/folders/${id}`, { params: { id } })).status).toBe(404);
    expect((await call(h(foldersRoute.POST), "POST", "/api/folders", { body: { id, name: "Taken", panels: [] } })).status).toBe(404);

    await signIn("demo-leader");
    expect((await call(h(folderRoute.DELETE), "DELETE", `/api/folders/${id}`, { params: { id } })).body).toEqual({ ok: true });
    expect((await call<Folder[]>(h(foldersRoute.GET), "GET", "/api/folders")).body).toHaveLength(3);
  });

  it("refuses a folder with an invalid panel", async () => {
    await signIn("demo-clerk-marion");
    const result = await call(h(foldersRoute.POST), "POST", "/api/folders", { body: { name: "Bad", panels: [{ ...panel, params: { county: "Cook" } }] } });
    expect(result.status).toBe(400);
    expect(errorOf(result).code).toBe("invalid_input");
  });
});

describe("audit log", () => {
  it("records every mutation, readable by an admin only, without note text", async () => {
    await signIn("demo-clerk-marion");
    const created = await call<FlagRecord>(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ note: "second page unsigned" }) });
    const id = created.body.id;
    await call(h(flagRoute.DELETE), "DELETE", `/api/flags/${id}`, { params: { id } });
    await call(h(restoreRoute.POST), "POST", `/api/flags/${id}/restore`, { params: { id } });
    const folder = await call<Folder>(h(foldersRoute.POST), "POST", "/api/folders", { body: { name: "Mine", panels: [] } });
    await call(h(folderRoute.DELETE), "DELETE", `/api/folders/${folder.body.id}`, { params: { id: folder.body.id } });
    await call(h(commitRoute.POST), "POST", "/api/import/commit", {
      body: { rows: [{ date: "2026-09-02", county: "Marion", caseType: "Small claims", form: "Small claims notice of claim", reason: "raw reason words", tags: ["Needs review"] }] },
    });
    expect((await call(h(auditRoute.GET), "GET", "/api/audit")).status).toBe(403);
    await signIn("demo-leader");
    expect((await call(h(auditRoute.GET), "GET", "/api/audit")).status).toBe(403);

    await signIn("demo-admin");
    const event = await call<ChangeEvent>(h(eventsRoute.POST), "POST", "/api/events", {
      body: { name: "New guide", date: "2026-09-01", county: "Monroe", caseType: "Eviction", tag: "Wrong form", description: "" },
    });
    await call(h(eventRoute.DELETE), "DELETE", `/api/events/${event.body.id}`, { params: { id: event.body.id } });

    const log = await call<AuditEntry[]>(h(auditRoute.GET), "GET", "/api/audit");
    expect(log.status).toBe(200);
    expect(log.body.map((e) => e.action)).toEqual([
      "event.delete",
      "event.save",
      "demo.login",
      "demo.login",
      "import.commit",
      "folder.delete",
      "folder.save",
      "flag.restore",
      "flag.delete",
      "flag.create",
      "demo.login",
    ]);
    const create = log.body[log.body.length - 2];
    expect(create).toMatchObject({ userId: "demo-clerk-marion", role: "clerk", entity: "flag", entityId: id, detail: { county: "Marion", caseType: "Small claims", problems: 2, hasNote: true } });
    expect(log.body[4]).toMatchObject({ action: "import.commit", entity: "import_batch", detail: { rows: 1, needsReview: 1 } });
    expect(JSON.stringify(log.body)).not.toContain("second page unsigned");
    expect(JSON.stringify(log.body)).not.toContain("raw reason words");

    expect((await call<AuditEntry[]>(h(auditRoute.GET), "GET", "/api/audit?limit=2")).body).toHaveLength(2);
    expect((await call(h(auditRoute.GET), "GET", "/api/audit?limit=501")).status).toBe(400);
  });

  it("does not record refused requests", async () => {
    await signIn("demo-clerk-marion");
    await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ county: "Lake" }) });
    await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag({ note: "call 317-555-0142" }) });
    await signIn("demo-admin");
    const log = await call<AuditEntry[]>(h(auditRoute.GET), "GET", "/api/audit");
    expect(log.body.map((e) => e.action)).toEqual(["demo.login", "demo.login"]);
  });
});

describe("POST /api/demo/reset", () => {
  it("puts the sample data back and leaves the rate limits as they were", async () => {
    await signIn("demo-clerk-marion");
    for (let i = 0; i < 60; i++) await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() });
    expect((await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() })).status).toBe(429);
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(344);

    // The clerk is over the limit for changes, and a reset is a change.
    expect((await call(h(resetRoute.POST), "POST", "/api/demo/reset")).status).toBe(429);
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(344);

    // Another account resets the data. That does not hand the clerk a new allowance.
    await signIn("demo-admin");
    expect((await call(h(resetRoute.POST), "POST", "/api/demo/reset")).body).toEqual({ ok: true });
    await signIn("demo-clerk-marion");
    expect((await call<LeanFlag[]>(h(flagsRoute.GET), "GET", "/api/flags")).body).toHaveLength(284);
    expect((await call(h(flagsRoute.POST), "POST", "/api/flags", { body: newFlag() })).status).toBe(429);

    await signIn("demo-admin");
    const log = await call<AuditEntry[]>(h(auditRoute.GET), "GET", "/api/audit");
    expect(log.body.map((e) => e.action)).toEqual(["demo.login", "demo.login", "demo.reset"]);
  });

  it("is itself limited like any other change", async () => {
    await signIn("demo-leader");
    for (let i = 0; i < 60; i++) expect((await call(h(resetRoute.POST), "POST", "/api/demo/reset")).status).toBe(200);
    const refused = await call(h(resetRoute.POST), "POST", "/api/demo/reset");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("1");
  });
});
