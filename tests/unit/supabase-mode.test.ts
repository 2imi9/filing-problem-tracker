import { AuthInvalidJwtError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api";
import { cookieJar } from "./cookies";

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

// Supabase itself is replaced by a stand-in, so nothing here reaches the network. It records how each
// client was made and answers getClaims() (the verified sign-in) with whatever the test sets.
type Claims = { sub: string; email?: string } | null;
type ClientOptions = { global?: { fetch?: typeof fetch } };
const supabase = vi.hoisted(() => ({
  created: [] as { url: string; key: string }[],
  options: [] as ClientOptions[],
  claims: null as Claims,
  /** What getClaims() reports instead of an answer, for example that the Auth server could not be reached. */
  error: null as Error | null,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, options: ClientOptions) => {
    supabase.created.push({ url, key });
    supabase.options.push(options);
    return {
      auth: {
        getClaims: async () => (supabase.error ? { data: null, error: supabase.error } : { data: supabase.claims ? { claims: supabase.claims } : null, error: null }),
      },
    };
  },
}));

// The run mode is fixed when the config module loads, so each test sets the environment and then loads
// the modules fresh.

const NO_PARAMS = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-anon-key-anon-key-anon-key");
  supabase.created.length = 0;
  supabase.options.length = 0;
  supabase.claims = null;
  supabase.error = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("supabase mode", () => {
  it("is selected by the two Supabase settings", async () => {
    const { APP_MODE } = await import("@/server/config");
    expect(APP_MODE).toBe("supabase");
  });

  it("the demo routes do not exist (404)", async () => {
    const post = () => new Request("http://localhost:3000/api/demo/x", { method: "POST", body: '{"userId":"demo-admin"}', headers: { "content-type": "application/json" } });
    const routes = [await import("@/app/api/demo/login/route"), await import("@/app/api/demo/logout/route"), await import("@/app/api/demo/reset/route")];
    for (const route of routes) {
      const response = await route.POST(post(), NO_PARAMS);
      expect(response.status).toBe(404);
      expect(((await response.json()) as ApiErrorBody).error.code).toBe("not_found");
    }
    expect(cookieJar.get("fpt_demo")).toBeUndefined();
  });

  it("a demo cookie is not a session", async () => {
    const { signDemoCookie } = await import("@/server/auth/demoCookie");
    const { DEMO_COOKIE_SECRET } = await import("@/server/config");
    const { proxy } = await import("@/proxy");
    const cookie = signDemoCookie("demo-admin", DEMO_COOKIE_SECRET, Math.floor(Date.now() / 1000) + 600);
    const response = await proxy(new NextRequest("http://localhost:3000/dashboard", { headers: { cookie: `fpt_demo=${cookie}` } }));
    expect(response.status).toBe(307);
    // Nothing was asked of Supabase: a request with no Supabase cookie is refused at once.
    expect(supabase.created).toEqual([]);
  });

  it("the proxy lets a request through only when Supabase vouches for its session cookie", async () => {
    const { proxy } = await import("@/proxy");
    const send = (path: string, cookieName: string) => proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: `${cookieName}=value` } }));

    supabase.claims = { sub: "user-1", email: "leader@example.gov" };
    expect((await send("/dashboard", "sb-project-auth-token")).headers.get("x-middleware-next")).toBe("1");
    expect((await send("/api/flags", "sb-project-auth-token.0")).headers.get("x-middleware-next")).toBe("1");
    expect(supabase.created).toEqual(Array(2).fill({ url: "https://project.supabase.co", key: "anon-key-anon-key-anon-key-anon-key" }));

    // A cookie with the right name but no valid session behind it is not enough.
    supabase.claims = null;
    expect((await send("/dashboard", "sb-project-auth-token")).status).toBe(307);
    const api = await send("/api/flags", "sb-project-auth-token");
    expect(api.status).toBe(401);
    expect(((await api.json()) as ApiErrorBody).error.code).toBe("unauthorized");

    // Other cookies are not session cookies at all, whatever Supabase would say.
    supabase.claims = { sub: "user-1" };
    supabase.created.length = 0;
    expect((await send("/dashboard", "sb-project-auth-token-code-verifier")).status).toBe(307);
    expect((await send("/dashboard", "other")).status).toBe(307);
    expect(supabase.created).toEqual([]);
  });

  it("the sign-in page and routes are reachable signed out", async () => {
    const { proxy } = await import("@/proxy");
    for (const [method, path] of [["GET", "/login"], ["GET", "/auth/confirm?token_hash=abc&type=email"], ["GET", "/api/auth/callback?code=abc"], ["POST", "/api/auth/magic-link"], ["POST", "/api/auth/sign-out"]]) {
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`, { method }));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(supabase.created).toEqual([]);
  });

  it("getRepository hands over to the Supabase repository, which acts with the anon key and the caller's own session", async () => {
    const { getRepository } = await import("@/server/repo");
    const repo = await getRepository({ id: "u1", email: "u1@example.gov", role: "leader", county: null });
    expect(typeof repo.listFlags).toBe("function");
    expect(supabase.created).toEqual([{ url: "https://project.supabase.co", key: "anon-key-anon-key-anon-key-anon-key" }]);
  });

  it("getSession asks Supabase, and is null when Supabase does not vouch for anyone", async () => {
    const { getSession, requireSession } = await import("@/server/auth/session");
    expect(await getSession()).toBeNull();
    await expect(requireSession()).rejects.toMatchObject({ status: 401 });
    expect(supabase.created.length).toBeGreaterThan(0);
  });
});

describe("when Supabase Auth cannot be reached", () => {
  const cookie = { cookie: "sb-project-auth-token=value" };

  it("the proxy answers 503, not 401 or the sign-in page: the session may still be good", async () => {
    const { proxy } = await import("@/proxy");
    supabase.claims = { sub: "user-1", email: "leader@example.gov" };
    supabase.error = new AuthRetryableFetchError("fetch failed", 0);

    const api = await proxy(new NextRequest("http://localhost:3000/api/me", { headers: cookie }));
    expect(api.status).toBe(503);
    expect(api.headers.get("retry-after")).toBe("5");
    expect(api.headers.get("cache-control")).toBe("no-store");
    const body = (await api.json()) as ApiErrorBody;
    expect(body.error.code).toBe("unavailable");
    expect(body.error.message).toContain("could not be reached");
    expect(body.error.requestId).toBe(api.headers.get("x-request-id"));

    const page = await proxy(new NextRequest("http://localhost:3000/dashboard", { headers: cookie }));
    expect(page.status).toBe(503);
    expect(page.headers.get("location")).toBeNull();
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("You have not been signed out.");

    // A server error from the Auth server is the same case.
    supabase.error = new AuthRetryableFetchError("Service Unavailable", 503);
    expect((await proxy(new NextRequest("http://localhost:3000/api/flags", { headers: cookie }))).status).toBe(503);
  });

  it("a token Supabase rejects is still a plain 'not signed in'", async () => {
    const { proxy } = await import("@/proxy");
    supabase.error = new AuthInvalidJwtError("Invalid JWT signature");
    expect((await proxy(new NextRequest("http://localhost:3000/api/me", { headers: cookie }))).status).toBe(401);
    expect((await proxy(new NextRequest("http://localhost:3000/dashboard", { headers: cookie }))).status).toBe(307);
  });

  it("requireSession throws 503, not 401", async () => {
    const { getSession, requireSession } = await import("@/server/auth/session");
    supabase.error = new AuthRetryableFetchError("fetch failed", 0);
    await expect(requireSession()).rejects.toMatchObject({ status: 503, code: "unavailable", headers: { "Retry-After": "5" } });
    await expect(getSession()).rejects.toMatchObject({ status: 503 });
    supabase.error = new AuthInvalidJwtError("Invalid JWT signature");
    await expect(requireSession()).rejects.toMatchObject({ status: 401 });
  });

  it("every Supabase client is built with a fetch that gives up after the deadline", async () => {
    const { proxy } = await import("@/proxy");
    const { getSession } = await import("@/server/auth/session");
    const { supabaseFetch } = await import("@/server/supabase/server");
    await proxy(new NextRequest("http://localhost:3000/api/me", { headers: cookie }));
    await getSession();
    expect(supabase.options).toHaveLength(2);
    for (const options of supabase.options) expect(options.global?.fetch).toBe(supabaseFetch);

    // The deadline is added to whatever signal the caller passed, and to a call with none.
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Response("{}");
    });
    // AbortSignal.timeout runs on a timer the test cannot move, so a stand-in is aborted by hand.
    const deadlines: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      deadlines.push(controller);
      return controller.signal;
    });
    try {
      await supabaseFetch("https://project.supabase.co/auth/v1/user");
      const own = new AbortController();
      await supabaseFetch("https://project.supabase.co/auth/v1/user", { signal: own.signal });
      expect(timeout.mock.calls).toEqual([[10_000], [10_000]]);
      expect(signals.map((signal) => signal?.aborted)).toEqual([false, false]);
      for (const deadline of deadlines) deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
      expect(signals.map((signal) => signal?.aborted)).toEqual([true, true]);
      expect((signals[1]?.reason as DOMException).name).toBe("TimeoutError");

      // The caller's own signal still ends the request.
      await supabaseFetch("https://project.supabase.co/auth/v1/user", { signal: own.signal });
      own.abort();
      expect(signals[2]?.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("APP_ORIGIN", () => {
  it("when set, state-changing requests must carry exactly that origin", async () => {
    vi.stubEnv("APP_ORIGIN", "https://tracker.example.gov");
    const { handle } = await import("@/server/http");
    const POST = handle(async () => ({ ok: true }));
    const send = (origin: string) => POST(new Request("http://internal:3000/api/x", { method: "POST", headers: { origin, host: "internal:3000" } }), NO_PARAMS);
    expect((await send("https://tracker.example.gov")).status).toBe(200);
    // Matching the Host header is not enough once the origin is pinned.
    expect((await send("http://internal:3000")).status).toBe(403);
    expect((await send("https://evil.example")).status).toBe(403);
  });
});

describe("rate limit settings", () => {
  it("can be raised from the environment, for example for an end-to-end test run", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("RATE_LIMIT_MUTATIONS_PER_MINUTE", "3");
    const { enforceRateLimit, resetRateLimits } = await import("@/server/ratelimit");
    await resetRateLimits();
    for (let i = 0; i < 3; i++) await enforceRateLimit("user-x", "mutation");
    await expect(enforceRateLimit("user-x", "mutation")).rejects.toMatchObject({ status: 429 });
    await resetRateLimits();
  });
});
