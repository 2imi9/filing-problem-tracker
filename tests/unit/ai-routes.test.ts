import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api";
import { PanelSpec } from "@/lib/panels";
import type { DemoUserId } from "@/lib/sample";
import type { AiClient } from "@/server/ai/client";
import type { ComposeResult } from "@/server/ai/compose";
import type { SummaryAggregates, SummaryResult } from "@/server/ai/summary";
import { AI_MODEL } from "@/server/config";
import type { RouteHandler } from "@/server/http";
import { resetRateLimits } from "@/server/ratelimit";
import { resetMemoryStore } from "@/server/repo/memory";
import { blockJson, fakeClient, userText } from "./ai-fake";
import type { FakeClient } from "./ai-fake";
import { clearCookies, cookieJar } from "./cookies";

import * as composeRoute from "@/app/api/ai/compose/route";
import * as summaryRoute from "@/app/api/ai/summary/route";
import * as loginRoute from "@/app/api/demo/login/route";

// The two AI routes, called the way the framework calls them. The test environment has no API key, so
// the shared client is null unless a test puts a fake one in `ai.client`.
const ai = vi.hoisted(() => ({ client: null as AiClient | null }));

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));
vi.mock("@/server/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/client")>();
  return { ...actual, getAiClient: () => ai.client };
});

const BASE = "http://localhost:3000";

async function call<T>(handler: RouteHandler<object>, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const request = new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve({}) });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T, headers: response.headers };
}

const compose = (body: unknown, headers?: Record<string, string>) => call<ComposeResult>(composeRoute.POST, "/api/ai/compose", body, headers);
const summary = (body: unknown, headers?: Record<string, string>) => call<SummaryResult>(summaryRoute.POST, "/api/ai/summary", body, headers);
const errorOf = (result: { body: unknown }) => (result.body as ApiErrorBody).error;

async function signIn(userId: DemoUserId): Promise<void> {
  const result = await call(loginRoute.POST as RouteHandler<object>, "/api/demo/login", { userId });
  expect(result.status).toBe(200);
}

/** A fake model that writes a summary using only the total it was given. */
const honestSummarizer = (): FakeClient =>
  fakeClient((params) => {
    const data = blockJson(userText(params), "data") as SummaryAggregates;
    return { text: `In this sample data, ${data.flaggedFilings} filings were flagged.` };
  });

let logged: string[];

beforeEach(async () => {
  ai.client = null;
  clearCookies();
  resetMemoryStore();
  await resetRateLimits();
  logged = [];
  const keep = (...parts: unknown[]) => void logged.push(parts.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("both AI routes", () => {
  it("answer 401 without a session", async () => {
    ai.client = honestSummarizer();
    const composed = await compose({ request: "compare the three biggest counties" });
    expect(composed.status).toBe(401);
    expect(errorOf(composed).code).toBe("unauthorized");
    const summarized = await summary({ filters: {} });
    expect(summarized.status).toBe(401);
    expect((ai.client as FakeClient).calls).toHaveLength(0);
  });

  it("refuse a request sent from another site", async () => {
    await signIn("demo-leader");
    const composed = await compose({ request: "compare the three biggest counties" }, { origin: "https://elsewhere.example" });
    expect(composed.status).toBe(403);
    const summarized = await summary({ filters: {} }, { origin: "https://elsewhere.example" });
    expect(summarized.status).toBe(403);
  });

  it("share one allowance of 20 requests a minute per user, and answer 429 with Retry-After beyond it", async () => {
    await signIn("demo-leader");
    for (let i = 0; i < 12; i += 1) expect((await compose({ request: "compare the three biggest counties" })).status).toBe(200);
    for (let i = 0; i < 8; i += 1) expect((await summary({ filters: {} })).status).toBe(200);

    const refused = await compose({ request: "compare the three biggest counties" });
    expect(refused.status).toBe(429);
    expect(errorOf(refused).code).toBe("rate_limited");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const alsoRefused = await summary({ filters: {} });
    expect(alsoRefused.status).toBe(429);
    expect(Number(alsoRefused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // Another user has an allowance of their own.
    await signIn("demo-clerk-lake");
    expect((await compose({ request: "compare the three biggest counties" })).status).toBe(200);
  });

  it("count a refused request against the allowance before the body is read", async () => {
    await signIn("demo-leader");
    for (let i = 0; i < 20; i += 1) expect((await compose({ request: "" })).status).toBe(400);
    expect((await compose({ request: "compare the three biggest counties" })).status).toBe(429);
  });
});

describe("POST /api/ai/compose", () => {
  it("answers from the keyword matcher when there is no API key", async () => {
    await signIn("demo-leader");
    const result = await compose({ request: "signature problems in Marion small claims this year" });
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("rules");
    expect(result.body.notice).toBeUndefined();
    expect(result.body.panels.map((panel) => panel.type)).toEqual(["trend", "ranked", "kpi"]);
    expect(result.body.panels[0].params).toEqual({ county: "Marion", caseType: "Small claims", tag: "Missing signature", fromMonth: "2026-01" });
    for (const panel of result.body.panels) expect(PanelSpec.safeParse(panel).success).toBe(true);
  });

  it("answers the other two example requests from the keyword matcher", async () => {
    await signIn("demo-leader");
    const guide = await compose({ request: "did the Lake County guide help?" });
    expect(guide.body.panels[0]).toMatchObject({ type: "before_after", params: { eventId: "po-guide" } });
    const counties = await compose({ request: "compare the three biggest counties" });
    expect(counties.body.panels).toHaveLength(1);
    expect(counties.body.panels[0]).toMatchObject({ type: "compare_counties", params: { counties: ["Marion", "Lake", "Allen"] } });
  });

  it("answers with no panels and a notice when nothing in the request matches", async () => {
    await signIn("demo-leader");
    const result = await compose({ request: "hello there" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ panels: [], source: "rules" });
    expect(result.body.notice).toContain("Nothing in that request matched");
  });

  it("tells a clerk with one county that there is nothing to compare", async () => {
    await signIn("demo-clerk-marion");
    const result = await compose({ request: "compare the three biggest counties" });
    expect(result.body.panels).toEqual([]);
    expect(result.body.notice).toContain("one county only");
  });

  it("gives a clerk panels for their own county only, never another county's numbers as zero", async () => {
    await signIn("demo-clerk-marion");
    const compared = await compose({ request: "Compare Marion, Lake and Allen on wrong form" });
    expect(compared.status).toBe(200);
    expect(compared.body.panels.map((panel) => panel.type)).toEqual(["trend", "ranked", "kpi"]);
    expect(JSON.stringify(compared.body.panels)).not.toMatch(/Lake|Allen/);
    expect(compared.body.notice).toContain("You see Marion County only, so Lake and Allen were left out.");

    const guide = await compose({ request: "Did the protective order guide help?" });
    expect(guide.body.panels.map((panel) => panel.type)).not.toContain("before_after");
    const changes = await compose({ request: "Did the changes help?" });
    expect(changes.body.panels.filter((panel) => panel.type === "before_after").map((panel) => panel.params)).toEqual([{ eventId: "sc-form" }]);
  });

  it.each([
    ["an empty request", { request: "   " }],
    ["a request over 500 characters", { request: "trend ".repeat(100) }],
    ["no request", {}],
    ["a request that is not text", { request: ["trend"] }],
    ["panels supplied by the caller", { request: "trend", panels: [{ type: "kpi" }] }],
  ])("refuses %s with 400", async (_name, body) => {
    await signIn("demo-leader");
    const result = await compose(body);
    expect(result.status).toBe(400);
    expect(errorOf(result).code).toBe("invalid_input");
  });

  it("refuses a body that is not JSON", async () => {
    await signIn("demo-leader");
    expect((await compose("{nope")).status).toBe(400);
    expect((await compose("request=trend", { "content-type": "text/plain" })).status).toBe(415);
  });

  it("with AI on, returns the panels the model chose and sends the model no counts or rows", async () => {
    await signIn("demo-leader");
    const client = fakeClient(() => ({
      toolCalls: [
        { name: "open_trend_panel", input: { county: "Marion", caseType: "any", form: "any", tag: "Missing signature", fromMonth: "", toMonth: "", title: "Signatures in Marion" } },
        { name: "open_kpi_panel", input: { county: "Cook", caseType: "any", form: "any", tag: "any", fromMonth: "", toMonth: "", title: "" } },
      ],
    }));
    ai.client = client;
    const result = await compose({ request: "signature problems in Marion" });
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("ai");
    expect(result.body.panels).toHaveLength(1);
    expect(result.body.panels[0]).toMatchObject({ type: "trend", title: "Signatures in Marion", params: { county: "Marion", tag: "Missing signature" } });

    expect(client.calls).toHaveLength(1);
    const user = userText(client.calls[0].params);
    expect(blockJson(user, "request")).toBe("signature problems in Marion");
    expect(user).not.toContain("900");
    expect(user).not.toMatch(/"s\d+"/);
    expect(user).not.toContain("@demo.invalid");
  });

  it("with AI on, falls back to the keyword matcher when the model refuses", async () => {
    await signIn("demo-leader");
    ai.client = fakeClient(() => ({ text: "", stopReason: "refusal" }));
    const result = await compose({ request: "compare the three biggest counties" });
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("rules");
    expect(result.body.panels[0].type).toBe("compare_counties");
  });
});

describe("POST /api/ai/summary", () => {
  it("answers 'not available' with a reason when there is no API key", async () => {
    await signIn("demo-leader");
    const result = await summary({ filters: {} });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ available: false, reason: "AI features are switched off on this server." });
  });

  it.each([
    ["no filters", {}],
    ["a number supplied by the caller", { filters: {}, flaggedFilings: 5 }],
    ["aggregates supplied by the caller", { filters: {}, aggregates: { flaggedFilings: 5 } }],
    ["a county that is not on the list", { filters: { county: "Cook" } }],
    ["a filter the app does not have", { filters: { total: 12 } }],
    ["a problem that is not on the list", { filters: {}, tag: "Filed late" }],
    ["a month in the wrong form", { filters: { fromMonth: "June" } }],
  ])("refuses %s with 400", async (_name, body) => {
    await signIn("demo-leader");
    ai.client = honestSummarizer();
    const result = await summary(body);
    expect(result.status).toBe(400);
    expect(errorOf(result).code).toBe("invalid_input");
    expect((ai.client as FakeClient).calls).toHaveLength(0);
  });

  it("with AI on, counts the filings on the server and sends the model those counts and nothing else", async () => {
    await signIn("demo-leader");
    const client = honestSummarizer();
    ai.client = client;
    const result = await summary({ filters: {} });
    expect(result.body).toEqual({ available: true, summary: "In this sample data, 900 filings were flagged.", source: "ai" });

    expect(client.calls).toHaveLength(1);
    const user = userText(client.calls[0].params);
    const data = blockJson(user, "data") as SummaryAggregates;
    expect(data.sampleData).toBe(true);
    expect(data.flaggedFilings).toBe(900);
    expect(data.problems.slice(0, 3).map((entry) => [entry.problem, entry.filings])).toEqual([
      ["Missing required details", 284],
      ["Missing signature", 249],
      ["Wrong county or court", 159],
    ]);
    // Counts only: no filing ids, no account, nothing row by row.
    expect(user).not.toMatch(/"s\d+"/);
    expect(user).not.toContain("@demo.invalid");
    expect(user).not.toContain("demo-leader");
    expect(client.calls[0].params.output_config).toEqual({ effort: "medium" });
    expect(client.calls[0].options?.timeout).toBe(30_000);
  });

  it("counts only what the signed-in user may see", async () => {
    await signIn("demo-clerk-marion");
    const client = honestSummarizer();
    ai.client = client;
    const result = await summary({ filters: {} });
    expect(result.body).toMatchObject({ available: true, summary: "In this sample data, 284 filings were flagged." });
    const user = userText(client.calls[0].params);
    const data = blockJson(user, "data") as SummaryAggregates;
    expect(data.flaggedFilings).toBe(284);
    // The model is told whose numbers these are: one county's, not the whole state's.
    expect(data.scope).toBe("Marion County, all case types, all months");
    expect(user).not.toContain("All counties");
    expect(data.counties).toBeUndefined();
    expect(user).not.toContain("Lake");

    // The clerk asking for another county gets nothing, and the model is not asked.
    const other = await summary({ filters: { county: "Lake" } });
    expect(other.body).toEqual({ available: false, reason: "No flagged filings match these filters, so there is nothing to summarize." });
    expect(client.calls).toHaveLength(1);
  });

  it("applies the filters and adds the comparison for a change picked on the dashboard", async () => {
    await signIn("demo-leader");
    const client = honestSummarizer();
    ai.client = client;
    const result = await summary({ filters: { county: "Marion", caseType: "Small claims" }, eventId: "sc-form" });
    expect(result.body.available).toBe(true);
    const data = blockJson(userText(client.calls[0].params), "data") as SummaryAggregates;
    expect(data.scope).toContain("Marion");
    expect(data.counties).toBeUndefined();
    expect(data.change).toMatchObject({
      name: "Revised small claims form (Marion, Jun 1)",
      problemMeasured: "Missing signature",
      before: { averagePerMonth: 4 },
      after: { averagePerMonth: 1 },
      changeInMonthlyAveragePercent: -75,
    });
  });

  it("discards a summary that states a number the server did not count", async () => {
    await signIn("demo-leader");
    ai.client = fakeClient(() => ({ text: "In this sample data, 1,250 filings were flagged." }));
    const result = await summary({ filters: {} });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ available: false, reason: "The summary used a number that is not in the data, so it was discarded." });
  });

  it("answers 'not available' when the model refuses or the reply is cut off", async () => {
    await signIn("demo-leader");
    ai.client = fakeClient(() => ({ text: "In this sample data, 900 filings were flagged.", stopReason: "refusal" }));
    const refused = await summary({ filters: {} });
    expect(refused.body.available).toBe(false);
    ai.client = fakeClient(() => ({ text: "In this sample data, 900 filings", stopReason: "max_tokens" }));
    const cut = await summary({ filters: {} });
    expect(cut.body.available).toBe(false);
    expect(JSON.stringify([refused.body, cut.body])).not.toContain("900 filings");
  });
});

describe("what the AI routes log", () => {
  it("logs sizes, the model, the stop reason and the panel choices, never the request or the reply", async () => {
    await signIn("demo-leader");
    ai.client = fakeClient((params) =>
      params.tools
        ? { toolCalls: [{ name: "open_trend_panel", input: { county: "Marion", caseType: "any", form: "any", tag: "Wrong form", fromMonth: "", toMonth: "", title: "A title the model wrote" } }] }
        : { text: "In this sample data, 900 filings were flagged." },
    );
    await compose({ request: "wrong form trouble in Marion lately" });
    await summary({ filters: {} });

    const lines = logged.join("\n");
    expect(lines).toContain('"event":"ai_call"');
    expect(lines).toContain('"feature":"compose"');
    expect(lines).toContain('"feature":"summary"');
    expect(lines).toContain(`"model":${JSON.stringify(AI_MODEL)}`);
    expect(lines).toContain('"stopReason":"tool_use"');
    expect(lines).toContain('"event":"ai_compose_choices"');
    expect(lines).not.toContain("trouble in Marion lately");
    expect(lines).not.toContain("A title the model wrote");
    expect(lines).not.toContain("900 filings were flagged");
    expect(lines).not.toContain("You never state a count");
  });
});
