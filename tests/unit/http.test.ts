import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { z } from "zod";
import type { ApiErrorBody } from "@/lib/api";
import { LIMITS } from "@/server/config";
import { HttpError, assertSameOrigin, handle } from "@/server/http";
import { currentRequestId, noteRequestUser } from "@/server/requestContext";

const NO_PARAMS = { params: Promise.resolve({}) };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function post(body: string, headers: Record<string, string> = { "content-type": "application/json" }): Request {
  return new Request("http://localhost:3000/api/thing", { method: "POST", body, headers });
}

type ConsoleSpy = MockInstance<typeof console.log>;
let log: ConsoleSpy;
let errorLog: ConsoleSpy;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const lastLine = (spy: ConsoleSpy): Record<string, unknown> => JSON.parse(String(spy.mock.calls.at(-1)?.[0]));

describe("handle: successful requests", () => {
  it("turns a returned value into JSON with a request id and no-store", async () => {
    const GET = handle(async () => ({ hello: "world" }));
    const response = await GET(new Request("http://localhost:3000/api/thing?x=1"), NO_PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hello: "world" });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("passes a returned Response through, keeping its status and headers", async () => {
    const POST = handle(async () => Response.json({ id: "n1" }, { status: 201, headers: { "cache-control": "private, max-age=5", "x-extra": "1" } }));
    const response = await POST(post("{}"), NO_PARAMS);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "n1" });
    expect(response.headers.get("x-extra")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, max-age=5");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("sends null for a handler that returns nothing", async () => {
    const GET = handle(async () => undefined);
    expect(await (await GET(new Request("http://localhost:3000/api/thing"), NO_PARAMS)).json()).toBeNull();
  });

  it("gives the handler params, query, the request id and the parsed JSON body", async () => {
    const POST = handle<{ id: string }>(async ({ params, query, requestId, json, request }) => ({
      id: params.id,
      q: query.get("q"),
      sameId: requestId === currentRequestId(),
      body: await json(),
      method: request.method,
    }));
    const request = new Request("http://localhost:3000/api/thing/abc?q=find", { method: "POST", body: '{"a":[1,2]}', headers: { "content-type": "application/json; charset=utf-8" } });
    const response = await POST(request, { params: Promise.resolve({ id: "abc" }) });
    expect(await response.json()).toEqual({ id: "abc", q: "find", sameId: true, body: { a: [1, 2] }, method: "POST" });
  });

  it("logs one JSON line with requestId, method, route, userId, status and ms", async () => {
    const GET = handle(async () => {
      noteRequestUser("demo-leader");
      return { ok: true };
    });
    const response = await GET(new Request("http://localhost:3000/api/flags?county=Lake"), NO_PARAMS);
    expect(log).toHaveBeenCalledTimes(1);
    const line = lastLine(log);
    expect(Object.keys(line).sort()).toEqual(["method", "ms", "requestId", "route", "status", "userId"]);
    expect(line).toMatchObject({ method: "GET", route: "/api/flags", userId: "demo-leader", status: 200 });
    expect(line.requestId).toBe(response.headers.get("x-request-id"));
    expect(typeof line.ms).toBe("number");
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("logs userId null when nobody signed in, and keeps requests apart", async () => {
    const GET = handle(async ({ query }) => {
      if (query.get("who")) noteRequestUser(String(query.get("who")));
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {};
    });
    await Promise.all([
      GET(new Request("http://localhost:3000/api/a?who=one"), NO_PARAMS),
      GET(new Request("http://localhost:3000/api/b"), NO_PARAMS),
    ]);
    const lines = log.mock.calls.map((call) => JSON.parse(String(call[0])) as { route: string; userId: string | null });
    expect(lines.find((l) => l.route === "/api/a")?.userId).toBe("one");
    expect(lines.find((l) => l.route === "/api/b")?.userId).toBeNull();
  });
});

describe("handle: errors", () => {
  async function failWith(error: unknown): Promise<{ response: Response; body: ApiErrorBody }> {
    const GET = handle(async () => {
      throw error;
    });
    const response = await GET(new Request("http://localhost:3000/api/thing"), NO_PARAMS);
    return { response, body: (await response.json()) as ApiErrorBody };
  }

  it("maps HttpError to its status, code, message, details and headers", async () => {
    const { response, body } = await failWith(new HttpError(403, "Not for you."));
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "forbidden", message: "Not for you.", requestId: response.headers.get("x-request-id") } });

    const limited = await failWith(new HttpError(429, "Slow down.", { headers: { "Retry-After": "7" } }));
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get("retry-after")).toBe("7");
    expect(limited.body.error.code).toBe("rate_limited");

    const pii = await failWith(new HttpError(422, "Looks personal.", { code: "personal_data", details: { findings: [{ kind: "phone", match: "317-555-0142", index: 5 }] } }));
    expect(pii.body.error).toMatchObject({ code: "personal_data", findings: [{ kind: "phone", match: "317-555-0142", index: 5 }] });
  });

  it.each([
    [400, "bad_request"],
    [401, "unauthorized"],
    [404, "not_found"],
    [409, "conflict"],
    [413, "payload_too_large"],
    [415, "unsupported_media_type"],
    [422, "unprocessable"],
    [501, "not_implemented"],
  ] as const)("uses the default code for %i", async (status, code) => {
    const { response, body } = await failWith(new HttpError(status, "x"));
    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
  });

  it("maps ZodError to 400 with paths and messages, never the rejected values", async () => {
    const schema = z.strictObject({ name: z.string().min(3), nested: z.object({ n: z.number() }) });
    const POST = handle(async ({ json }) => schema.parse(await json()));
    const response = await POST(post('{"name":"ab","nested":{"n":"also-secret"},"extra":1}'), NO_PARAMS);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("invalid_input");
    expect(body.error.message).toBe("Some of the information sent is not valid.");
    expect(body.error.issues?.map((issue) => issue.path).sort()).toEqual(["", "name", "nested.n"]);
    expect(JSON.stringify(body)).not.toContain("also-secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("also-secret");
  });

  it("answers anything else with a generic 500 and logs the detail, not the other way round", async () => {
    const { response, body } = await failWith(new Error("database password is hunter2"));
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "internal", message: "Something went wrong on the server. Nothing was saved.", requestId: response.headers.get("x-request-id") },
    });
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("at ");
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    const line = lastLine(errorLog);
    expect(line).toMatchObject({ status: 500, route: "/api/thing", error: { name: "Error", message: "database password is hunter2" } });
    expect(String((line.error as { stack: string }).stack)).toContain("http.test.ts");
  });

  it("handles a thrown value that is not an Error", async () => {
    const { response, body } = await failWith("just a string");
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal");
    expect(lastLine(errorLog).error).toEqual({ message: "just a string" });
  });

  it("logs 4xx responses as ordinary lines without the error detail", async () => {
    await failWith(new HttpError(404, "Nope."));
    expect(errorLog).not.toHaveBeenCalled();
    expect(lastLine(log)).toMatchObject({ status: 404 });
    expect(lastLine(log)).not.toHaveProperty("error");
  });
});

describe("handle: reading the JSON body", () => {
  const echo = handle(async ({ json }) => ({ got: await json() }));

  it("refuses a body that is not declared as JSON with 415", async () => {
    const response = await echo(post("a,b,c", { "content-type": "text/csv" }), NO_PARAMS);
    expect(response.status).toBe(415);
    expect(((await response.json()) as ApiErrorBody).error.code).toBe("unsupported_media_type");
    expect((await echo(new Request("http://localhost:3000/api/thing", { method: "POST", body: "{}" }), NO_PARAMS)).status).toBe(415);
  });

  it("refuses malformed and empty JSON with 400", async () => {
    for (const body of ["{not json", ""]) {
      const response = await echo(post(body), NO_PARAMS);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ApiErrorBody).error).toMatchObject({ code: "invalid_json", message: "The request body is not valid JSON." });
    }
  });

  it("refuses a body over the size limit with 413, by declared length or by actual size", async () => {
    const declared = await echo(post("{}", { "content-type": "application/json", "content-length": String(LIMITS.maxBodyBytes + 1) }), NO_PARAMS);
    expect(declared.status).toBe(413);
    const actual = await echo(post(JSON.stringify({ csv: "x".repeat(LIMITS.maxBodyBytes) })), NO_PARAMS);
    expect(actual.status).toBe(413);
    expect(((await actual.json()) as ApiErrorBody).error.code).toBe("payload_too_large");
  });

  it("does not read the body unless the handler asks", async () => {
    const POST = handle(async () => ({ ok: true }));
    expect((await POST(post("not json at all", { "content-type": "text/plain" }), NO_PARAMS)).status).toBe(200);
  });
});

describe("handle: origin check on state-changing requests", () => {
  const ok = handle(async () => ({ ok: true }));
  const request = (method: string, headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/thing", { method, headers: { host: "localhost:3000", ...headers } });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses a cross-site %s with 403", async (method) => {
    const response = await ok(request(method, { origin: "https://evil.example" }), NO_PARAMS);
    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiErrorBody).error).toMatchObject({ code: "bad_origin", message: "This request came from another site and was refused." });
  });

  it("does not run the handler for a refused request", async () => {
    const fn = vi.fn(async () => ({ ok: true }));
    await handle(fn)(request("POST", { origin: "https://evil.example" }), NO_PARAMS);
    expect(fn).not.toHaveBeenCalled();
  });

  it("allows the app's own origin, matched on host and port", async () => {
    expect((await ok(request("POST", { origin: "http://localhost:3000" }), NO_PARAMS)).status).toBe(200);
    expect((await ok(request("POST", { origin: "http://localhost:4000" }), NO_PARAMS)).status).toBe(403);
    expect((await ok(request("DELETE", { origin: "null" }), NO_PARAMS)).status).toBe(403);
  });

  it("uses the forwarded host behind a proxy", async () => {
    const headers = { origin: "https://tracker.example.gov", "x-forwarded-host": "tracker.example.gov" };
    expect((await ok(request("POST", headers), NO_PARAMS)).status).toBe(200);
    expect((await ok(request("POST", { ...headers, origin: "https://other.example.gov" }), NO_PARAMS)).status).toBe(403);
  });

  it("without an Origin header, goes by Sec-Fetch-Site, and allows requests from programs that send neither", async () => {
    expect((await ok(request("POST", { "sec-fetch-site": "cross-site" }), NO_PARAMS)).status).toBe(403);
    expect((await ok(request("POST", { "sec-fetch-site": "same-site" }), NO_PARAMS)).status).toBe(403);
    expect((await ok(request("POST", { "sec-fetch-site": "same-origin" }), NO_PARAMS)).status).toBe(200);
    expect((await ok(request("POST", {}), NO_PARAMS)).status).toBe(200);
  });

  it("never checks GET, HEAD or OPTIONS", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect((await ok(request(method, { origin: "https://evil.example" }), NO_PARAMS)).status).toBe(200);
    }
  });

  it("can be switched off for endpoints with their own credentials", async () => {
    const open = handle(async () => ({ ok: true }), { checkOrigin: false });
    expect((await open(request("POST", { origin: "https://claude.ai" }), NO_PARAMS)).status).toBe(200);
  });

  it("assertSameOrigin throws HttpError 403 and returns nothing when satisfied", () => {
    expect(() => assertSameOrigin(request("POST", { origin: "https://evil.example" }))).toThrow(HttpError);
    expect(assertSameOrigin(request("POST", { origin: "http://localhost:3000" }))).toBeUndefined();
  });
});
