import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api";
import type { AppMode, SessionUser } from "@/lib/domain";
import { resetRateLimits } from "@/server/ratelimit";
import { resetMemoryStore } from "@/server/repo/memory";
import { bearerToken, hashMcpToken, mcpEnabled, resolveMcpToken } from "@/server/mcp/tokens";
import { handleMcpRequest } from "@/server/mcp/server";
import { POST } from "@/app/api/mcp/route";

// The config module reads the environment once at import. These tests swap the two settings the MCP
// endpoint depends on, so one file can cover "switched off", "demo token" and "Supabase mode".
const settings = vi.hoisted(() => ({ token: null as string | null, mode: "demo" as AppMode }));
const lookup = vi.hoisted(() => ({ fn: null as ((hash: string) => Promise<SessionUser | null>) | null, hashes: [] as string[] }));

vi.mock("@/server/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/config")>();
  return {
    ...actual,
    get MCP_TOKEN() {
      return settings.token;
    },
    get APP_MODE() {
      return settings.mode;
    },
  };
});

vi.mock("@/server/mcp/supabase-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/mcp/supabase-tokens")>();
  return {
    ...actual,
    lookupMcpTokenSupabase: async (hash: string) => {
      lookup.hashes.push(hash);
      return lookup.fn ? lookup.fn(hash) : actual.lookupMcpTokenSupabase(hash);
    },
  };
});

const TOKEN = "test-token-0123456789-abcdefghij";
const URL = "http://localhost:3000/api/mcp";
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

interface RpcReply {
  jsonrpc: string;
  id?: number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; body: unknown }> {
  const request = new Request(URL, { method: "POST", headers: { ...MCP_HEADERS, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const response = await POST(request, { params: Promise.resolve({}) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

let nextId = 1;
async function rpc(method: string, params?: Record<string, unknown>): Promise<RpcReply> {
  const reply = await post({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }, { authorization: `Bearer ${TOKEN}` });
  expect(reply.status).toBe(200);
  return reply.body as RpcReply;
}

interface ToolReply {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  const reply = await rpc("tools/call", { name, arguments: args });
  expect(reply.error).toBeUndefined();
  return reply.result as unknown as ToolReply;
}

const INITIALIZE = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unit-test", version: "1.0.0" } };
const errorOf = (reply: { body: unknown }) => (reply.body as ApiErrorBody).error;

beforeEach(async () => {
  settings.token = TOKEN;
  settings.mode = "demo";
  lookup.fn = null;
  lookup.hashes = [];
  resetMemoryStore();
  await resetRateLimits();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MCP tokens", () => {
  it("hashes a token with SHA-256, in hex", () => {
    expect(hashMcpToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashMcpToken(TOKEN)).toBe(createHash("sha256").update(TOKEN).digest("hex"));
  });

  it("reads the token from a Bearer header and nothing else", () => {
    const withHeader = (value?: string) => bearerToken(new Request(URL, { headers: value === undefined ? {} : { authorization: value } }));
    expect(withHeader(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(withHeader(`bearer   ${TOKEN}  `)).toBe(TOKEN);
    expect(withHeader()).toBeNull();
    expect(withHeader("Bearer")).toBeNull();
    expect(withHeader(`Basic ${TOKEN}`)).toBeNull();
    expect(withHeader(TOKEN)).toBeNull();
    expect(withHeader(`Bearer ${TOKEN} extra`)).toBeNull();
    expect(withHeader(`Bearer ${"x".repeat(513)}`)).toBeNull();
  });

  it("in demo mode accepts only the configured token, and acts as the court leader", async () => {
    expect(mcpEnabled()).toBe(true);
    expect(await resolveMcpToken(TOKEN)).toMatchObject({ id: "demo-leader", role: "leader" });
    expect(await resolveMcpToken(`${TOKEN}x`)).toBeNull();
    expect(await resolveMcpToken(TOKEN.slice(0, -1))).toBeNull();
    expect(await resolveMcpToken("")).toBeNull();
    expect(lookup.hashes).toEqual([]);
  });

  it("in demo mode with no token set, the endpoint is off and no token is valid", async () => {
    settings.token = null;
    expect(mcpEnabled()).toBe(false);
    expect(await resolveMcpToken(TOKEN)).toBeNull();
    expect(await resolveMcpToken("")).toBeNull();
  });

  it("in Supabase mode looks the token up by its hash, never by the token itself", async () => {
    settings.mode = "supabase";
    settings.token = null;
    const clerk: SessionUser = { id: "user-1", email: "clerk@example.invalid", role: "clerk", county: "Lake" };
    lookup.fn = async (hash) => (hash === hashMcpToken("a-users-own-token") ? clerk : null);
    expect(mcpEnabled()).toBe(true);
    expect(await resolveMcpToken("a-users-own-token")).toEqual(clerk);
    expect(await resolveMcpToken("some-other-token")).toBeNull();
    expect(lookup.hashes).toEqual([hashMcpToken("a-users-own-token"), hashMcpToken("some-other-token")]);
    // The demo token means nothing here.
    settings.token = TOKEN;
    expect(await resolveMcpToken(TOKEN)).toBeNull();
  });

  it("the Supabase lookup accepts no token when no service role key is configured", async () => {
    settings.mode = "supabase";
    expect(await resolveMcpToken(TOKEN)).toBeNull();
    expect(lookup.hashes).toEqual([hashMcpToken(TOKEN)]);
  });
});

describe("POST /api/mcp: who gets in", () => {
  const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  it("answers 404 when the endpoint is switched off, with or without a token", async () => {
    settings.token = null;
    const attempts: Record<string, string>[] = [{}, { authorization: `Bearer ${TOKEN}` }];
    for (const headers of attempts) {
      const reply = await post(listTools, headers);
      expect(reply.status).toBe(404);
      expect(errorOf(reply).code).toBe("not_found");
      expect(reply.headers.get("www-authenticate")).toBeNull();
    }
  });

  it("answers 401 without a token", async () => {
    const reply = await post(listTools);
    expect(reply.status).toBe(401);
    expect(errorOf(reply).code).toBe("unauthorized");
    expect(reply.headers.get("www-authenticate")).toBe('Bearer realm="filing-problem-tracker"');
    expect(JSON.stringify(reply.body)).not.toContain("get_problem_counts");
  });

  it.each([
    ["a wrong token", { authorization: "Bearer not-the-right-token-0123456789" }],
    ["the token without the Bearer scheme", { authorization: TOKEN }],
    ["a Basic header", { authorization: `Basic ${TOKEN}` }],
    ["the token in a query-style header", { "x-api-key": TOKEN }],
  ])("answers 401 with %s", async (_name, headers) => {
    const reply = await post(listTools, headers);
    expect(reply.status).toBe(401);
    expect(reply.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("answers 401 in Supabase mode when the lookup does not know the token", async () => {
    settings.mode = "supabase";
    settings.token = null;
    const reply = await post(listTools, { authorization: `Bearer ${TOKEN}` });
    expect(reply.status).toBe(401);
  });

  it("needs no cookie and no Origin header, and is not put off by a foreign Origin", async () => {
    const reply = await post(listTools, { authorization: `Bearer ${TOKEN}`, origin: "https://claude.ai" });
    expect(reply.status).toBe(200);
  });

  it("limits how often one token holder can call", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 1) statuses.push((await post(listTools, { authorization: `Bearer ${TOKEN}` })).status);
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    const refused = await post(listTools, { authorization: `Bearer ${TOKEN}` });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("does not spend a caller's allowance on requests without a valid token", async () => {
    for (let i = 0; i < 70; i += 1) expect((await post(listTools)).status).toBe(401);
    expect((await post(listTools, { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });
});

describe("POST /api/mcp: the protocol", () => {
  it("answers initialize with the server's name, its tools capability and its instructions", async () => {
    const reply = await rpc("initialize", INITIALIZE);
    expect(reply.error).toBeUndefined();
    expect(reply.result?.serverInfo).toMatchObject({ name: "filing-problem-tracker", version: "1.0.0" });
    expect(reply.result?.capabilities).toHaveProperty("tools");
    expect(String(reply.result?.instructions)).toContain("Call list_reference_values first");
    expect(String(reply.result?.instructions)).toContain("counts only");
  });

  it("keeps no session: the reply carries no session id and is plain JSON", async () => {
    const request = new Request(URL, {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE }),
    });
    const response = await POST(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("accepts a notification with 202 and no body", async () => {
    const reply = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { authorization: `Bearer ${TOKEN}` });
    expect(reply.status).toBe(202);
    expect(reply.body).toBeNull();
  });

  it("lists the five tools, each marked read-only, with an input schema", async () => {
    const reply = await rpc("tools/list");
    const tools = reply.result?.tools as { name: string; title?: string; description: string; inputSchema: { type: string; properties?: Record<string, unknown> }; annotations?: Record<string, unknown> }[];
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_reference_values",
      "get_problem_counts",
      "get_county_breakdown",
      "get_form_breakdown",
      "compare_before_after",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(60);
    }
    const counts = tools.find((tool) => tool.name === "get_problem_counts");
    expect(Object.keys(counts?.inputSchema.properties ?? {}).sort()).toEqual(["caseType", "county", "form", "fromMonth", "limit", "tag", "toMonth"]);
    const compare = tools.find((tool) => tool.name === "compare_before_after");
    expect(Object.keys(compare?.inputSchema.properties ?? {}).sort()).toEqual(["eventId", "tag"]);
  });

  it("round trip: initialize, list the tools, then call them", async () => {
    expect((await rpc("initialize", INITIALIZE)).result?.protocolVersion).toBeTypeOf("string");
    expect(((await rpc("tools/list")).result?.tools as unknown[]).length).toBe(5);

    const reference = await callTool("list_reference_values");
    expect(reference.isError).toBeUndefined();
    expect(reference.structuredContent).toMatchObject({ sampleData: true, needsReviewMarker: "Needs review" });
    expect((reference.structuredContent?.changes as { id: string }[]).map((change) => change.id)).toEqual(["sc-form", "po-guide", "fam-kiosk"]);
    // The text block is the same answer as JSON, for clients that read only text.
    expect(JSON.parse(reference.content[0].text)).toEqual(reference.structuredContent);

    const counts = await callTool("get_problem_counts", { limit: 3 });
    expect(counts.structuredContent).toMatchObject({ flaggedFilings: 900, sampleData: true });
    expect((counts.structuredContent?.problems as { problem: string; filings: number }[]).map((entry) => [entry.problem, entry.filings])).toEqual([
      ["Missing required details", 284],
      ["Missing signature", 249],
      ["Wrong county or court", 159],
    ]);

    // The demo token acts as the court leader, who sees every county.
    const marion = await callTool("get_problem_counts", { county: "Marion" });
    expect(marion.structuredContent).toMatchObject({ flaggedFilings: 284 });

    const compare = await callTool("compare_before_after", { eventId: "sc-form" });
    expect(compare.structuredContent).toMatchObject({ problemMeasured: "Missing signature", changeInMonthlyAveragePercent: -75, direction: "down" });

    const forms = await callTool("get_form_breakdown", { caseType: "Small claims" });
    expect((forms.structuredContent?.forms as unknown[]).length).toBeGreaterThan(0);
    const counties = await callTool("get_county_breakdown", { maxProblems: 2 });
    expect((counties.structuredContent?.problems as unknown[]).length).toBe(2);
  });

  it("tells a token holder who sees one county that the numbers are that county's", async () => {
    // In Supabase mode a token acts as the person it was issued to, who can be a clerk.
    const clerk: SessionUser = { id: "demo-clerk-marion", email: "clerk.marion@demo.invalid", role: "clerk", county: "Marion" };
    for (const name of ["get_problem_counts", "get_county_breakdown", "get_form_breakdown"]) {
      const request = new Request(URL, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: {} } }) });
      const reply = (await (await handleMcpRequest(request, clerk)).json()) as RpcReply;
      expect((reply.result as unknown as ToolReply).structuredContent).toMatchObject({ scope: "Marion County, all case types, all months", flaggedFilings: 284 });
    }
  });

  it("answers bad tool input and an unknown change with an error the model can read, not a crash", async () => {
    const unknownChange = await callTool("compare_before_after", { eventId: "no-such-change" });
    expect(unknownChange.isError).toBe(true);
    expect(unknownChange.content[0].text).toContain("No recorded change has that id");

    const badCounty = await rpc("tools/call", { name: "get_problem_counts", arguments: { county: "Cook" } });
    const refused = badCounty.error ? badCounty.error.message : (badCounty.result as unknown as ToolReply).content[0].text;
    expect(badCounty.error !== undefined || (badCounty.result as unknown as ToolReply).isError === true).toBe(true);
    expect(refused.toLowerCase()).toContain("county");
    expect(refused).not.toContain("900");

    const unknownTool = await rpc("tools/call", { name: "delete_flags", arguments: {} });
    expect(unknownTool.error !== undefined || (unknownTool.result as unknown as ToolReply).isError === true).toBe(true);
  });

  it("answers a method it does not have with a JSON-RPC error", async () => {
    const reply = await rpc("resources/list");
    expect(reply.error?.code).toBe(-32601);
  });

  it("refuses a body that is not JSON-RPC", async () => {
    const notJson = await post("{not json", { authorization: `Bearer ${TOKEN}` });
    expect(notJson.status).toBe(400);
    const notRpc = await post({ hello: "world" }, { authorization: `Bearer ${TOKEN}` });
    expect(notRpc.status).toBe(400);
  });

  it("never returns a filing, a note or a rejection reason", async () => {
    const all = [
      await callTool("list_reference_values"),
      await callTool("get_problem_counts"),
      await callTool("get_county_breakdown"),
      await callTool("get_form_breakdown"),
      await callTool("compare_before_after", { eventId: "po-guide" }),
    ];
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/"(?:note|reason|createdBy|batchId)"/);
    expect(text).not.toMatch(/"s\d+"/);
  });
});
