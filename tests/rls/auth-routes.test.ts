// The Supabase sign-in routes, with Supabase Auth itself replaced by a stand-in: what the routes send
// to it, what they answer, and where they send the browser.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api";
import type { SessionUser } from "@/lib/domain";

const NO_PARAMS = { params: Promise.resolve({}) };
const ORIGIN = "http://localhost:3000";

type AuthResult = { error: { code?: string; status?: number; name: string } | null };

const auth = {
  signInWithOtp: vi.fn<(credentials: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }) => Promise<AuthResult>>(),
  exchangeCodeForSession: vi.fn<(code: string) => Promise<AuthResult>>(),
  verifyOtp: vi.fn<(params: { token_hash: string; type: string }) => Promise<AuthResult>>(),
  signOut: vi.fn<(options: { scope: string }) => Promise<AuthResult>>(),
};
/** `failure` is what reading the session throws, for example when the database or the Auth server is down. */
const signedInAs = { user: null as SessionUser | null, failure: null as Error | null };

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));
vi.mock("@/server/auth/supabase", () => ({
  sessionUserOf: async () => {
    if (signedInAs.failure) throw signedInAs.failure;
    return signedInAs.user;
  },
}));
// The audit log is written through the repository, which these tests do not have. What matters here is
// that the routes ask for the entry.
const audited: { userId: string; action: string; entity: string }[] = [];
const auditFailure = { error: null as Error | null };
vi.mock("@/server/audit", () => ({
  audit: async (user: SessionUser, action: string, entity: string) => {
    if (auditFailure.error) throw auditFailure.error;
    audited.push({ userId: user.id, action, entity });
  },
}));

function useSupabaseMode(): void {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-anon-key-anon-key-anon-key");
}

beforeEach(() => {
  vi.resetModules();
  for (const fn of Object.values(auth)) fn.mockReset().mockResolvedValue({ error: null });
  signedInAs.user = null;
  signedInAs.failure = null;
  auditFailure.error = null;
  audited.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  const { resetRateLimits } = await import("@/server/ratelimit");
  await resetRateLimits();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function post(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, host: "localhost:3000", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("demo mode", () => {
  it("has no Supabase sign-in routes (404), and Supabase is never called", async () => {
    const magicLink = await import("@/app/api/auth/magic-link/route");
    const callback = await import("@/app/api/auth/callback/route");
    const signOut = await import("@/app/api/auth/sign-out/route");
    const responses = [
      await magicLink.POST(post("/api/auth/magic-link", { email: "clerk@example.gov" }), NO_PARAMS),
      await callback.GET(new Request(`${ORIGIN}/api/auth/callback?code=abc`), NO_PARAMS),
      await signOut.POST(post("/api/auth/sign-out"), NO_PARAMS),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(((await response.json()) as ApiErrorBody).error.code).toBe("not_found");
    }
    for (const fn of Object.values(auth)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/magic-link", () => {
  beforeEach(useSupabaseMode);

  const send = async (body: unknown, headers?: Record<string, string>) => {
    const { POST } = await import("@/app/api/auth/magic-link/route");
    return POST(post("/api/auth/magic-link", body, headers), NO_PARAMS);
  };

  it("asks Supabase for a link that never creates an account and comes back to this app", async () => {
    const response = await send({ email: "  Clerk@Example.GOV ", next: "/dashboard?county=Lake" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "clerk@example.gov",
      options: { shouldCreateUser: false, emailRedirectTo: `${ORIGIN}/api/auth/callback?next=%2Fdashboard%3Fcounty%3DLake` },
    });
  });

  it("the emailed link carries the page that was asked for to the confirm page, which hands it to the callback", async () => {
    await send({ email: "admin@example.gov", next: "/admin" });
    const redirectTo = auth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo;

    // What Supabase Auth does with the template: fill in its three values. It may or may not escape
    // the address it puts into the link, so both forms have to work.
    const template = readFileSync(new URL("../../supabase/templates/magic_link.html", import.meta.url), "utf8");
    const { nextFromRedirectTarget } = await import("@/components/shell/nav");
    for (const filled of [redirectTo, encodeURIComponent(redirectTo)]) {
      const html = template.replaceAll("{{ .SiteURL }}", ORIGIN).replaceAll("{{ .TokenHash }}", "hash-123").replaceAll("{{ .RedirectTo }}", filled);
      const href = /<a href="([^"]+)"/.exec(html)?.[1].replaceAll("&amp;", "&") ?? "";
      const link = new URL(href);
      expect(link.origin + link.pathname).toBe(`${ORIGIN}/auth/confirm`);
      expect(link.searchParams.get("token_hash")).toBe("hash-123");
      expect(link.searchParams.get("type")).toBe("email");
      // The confirm page reads the page asked for out of the link (ConfirmSignIn.tsx) and posts it on.
      const next = nextFromRedirectTarget(link.searchParams.get("redirect_to"));
      expect(next).toBe("/admin");

      signedInAs.user = { id: "u-admin", email: "admin@example.gov", role: "admin", county: null };
      const { GET } = await import("@/app/api/auth/callback/route");
      const response = await GET(new Request(`${ORIGIN}/api/auth/callback?token_hash=hash-123&type=email&next=${encodeURIComponent(next ?? "")}`), NO_PARAMS);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/admin");
    }

    // An invitation is sent with no page to return to. Its link is complete without one.
    const invite = readFileSync(new URL("../../supabase/templates/invite.html", import.meta.url), "utf8");
    expect(invite).not.toContain("RedirectTo");
  });

  it("drops a destination that is not a path inside this app", async () => {
    for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example", "/api/flags", "/login"]) {
      await send({ email: `person-${auth.signInWithOtp.mock.calls.length}@example.gov`, next });
    }
    for (const [credentials] of auth.signInWithOtp.mock.calls) expect(credentials.options.emailRedirectTo).toBe(`${ORIGIN}/api/auth/callback`);
  });

  it("answers the same whether the address has an account, has none, or the email could not be sent", async () => {
    const known = await send({ email: "known@example.gov" });
    auth.signInWithOtp.mockResolvedValueOnce({ error: { code: "otp_disabled", status: 422, name: "AuthApiError" } });
    const unknown = await send({ email: "unknown@example.gov" });
    auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 500, name: "AuthApiError" } });
    const failed = await send({ email: "failed@example.gov" });
    const bodies = [];
    for (const response of [known, unknown, failed]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      bodies.push(await response.json());
    }
    expect(bodies).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  });

  it("never writes the address to the log", async () => {
    await send({ email: "someone.private@example.gov" });
    const logged = vi.mocked(console.log).mock.calls.flat().join("\n") + vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(logged).toContain("magic_link");
    expect(logged).not.toContain("someone.private");
  });

  it("refuses something that is not an email address, and unknown fields", async () => {
    for (const body of [{ email: "not an address" }, { email: "" }, {}, { email: "a@example.gov", role: "admin" }]) {
      const response = await send(body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ApiErrorBody).error.code).toBe("invalid_input");
    }
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends at most three links to one mailbox in ten minutes, without saying so", async () => {
    // Behind one trusted proxy the last X-Forwarded-For entry is the caller, so these come from five addresses.
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 5; i++) {
      const response = await send({ email: "busy@example.gov" }, { "x-forwarded-for": `10.0.0.${i}` });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(3);
  });

  it("limits how many links one network address can ask for, with 429 and Retry-After", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      // The first entry is whatever the caller typed; the last is what the proxy saw.
      last = await send({ email: `person-${i}@example.gov` }, { "x-forwarded-for": `192.0.2.${i}, 10.9.9.9` });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([...Array<number>(10).fill(200), 429]);
    expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(10);
    // Another address behind the same proxy is not affected.
    expect((await send({ email: "elsewhere@example.gov" }, { "x-forwarded-for": "10.9.9.10" })).status).toBe(200);
  });

  it("counts every caller together when no proxy is trusted, whatever X-Forwarded-For they send", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await send({ email: `person-${i}@example.gov` }, { "x-forwarded-for": `198.51.100.${i}` })).status);
    expect(statuses).toEqual([...Array<number>(10).fill(200), 429]);
  });

  it("refuses a request from another site", async () => {
    const response = await send({ email: "clerk@example.gov" }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/callback", () => {
  beforeEach(useSupabaseMode);

  const open = async (query: string) => {
    const { GET } = await import("@/app/api/auth/callback/route");
    return GET(new Request(`${ORIGIN}/api/auth/callback${query}`), NO_PARAMS);
  };
  const clerk: SessionUser = { id: "u-clerk", email: "clerk@example.gov", role: "clerk", county: "Lake" };
  const leader: SessionUser = { id: "u-leader", email: "leader@example.gov", role: "leader", county: null };
  const admin: SessionUser = { id: "u-admin", email: "admin@example.gov", role: "admin", county: null };

  it("trades the code for a session and sends each role to its start page", async () => {
    for (const [user, home] of [[clerk, "/log"], [leader, "/dashboard"], [admin, "/dashboard"]] as const) {
      signedInAs.user = user;
      const response = await open("?code=one-time-code");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(home);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
  });

  it("accepts the token-hash form of the link, for sign-in and invitation emails only", async () => {
    signedInAs.user = clerk;
    for (const type of ["email", "magiclink", "invite"]) {
      expect((await open(`?token_hash=abc123&type=${type}`)).headers.get("location")).toBe("/log");
    }
    expect(auth.verifyOtp).toHaveBeenCalledTimes(3);
    expect(auth.verifyOtp).toHaveBeenLastCalledWith({ token_hash: "abc123", type: "invite" });
    for (const type of ["recovery", "email_change", "signup", ""]) {
      expect((await open(`?token_hash=abc123&type=${type}`)).headers.get("location")).toBe("/login?error=link");
    }
    expect(auth.verifyOtp).toHaveBeenCalledTimes(3);
  });

  it("goes on to the page that was asked for, when it is a path inside this app", async () => {
    signedInAs.user = leader;
    expect((await open("?code=c&next=%2Fworkspace%3Ffolder%3Dx")).headers.get("location")).toBe("/workspace?folder=x");
    for (const next of ["https%3A%2F%2Fevil.example", "%2F%2Fevil.example", "%2F%5Cevil.example", "%2Fapi%2Fflags", "%2Flogin"]) {
      expect((await open(`?code=c&next=${next}`)).headers.get("location")).toBe("/dashboard");
    }
  });

  it("sends a used, expired or malformed link back to the sign-in page", async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: { code: "flow_state_not_found", status: 400, name: "AuthApiError" } });
    expect((await open("?code=stale")).headers.get("location")).toBe("/login?error=link");
    auth.verifyOtp.mockResolvedValueOnce({ error: { code: "otp_expired", status: 403, name: "AuthApiError" } });
    expect((await open("?token_hash=stale&type=email")).headers.get("location")).toBe("/login?error=link");
    expect((await open("")).headers.get("location")).toBe("/login?error=link");
    expect((await open("?next=%2Fdashboard")).headers.get("location")).toBe("/login?error=link");
  });

  it("a person with no profile is signed out again and told they have no access", async () => {
    signedInAs.user = null;
    const response = await open("?code=valid-for-supabase");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=no_access");
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
});

describe("POST /api/auth/sign-out", () => {
  beforeEach(useSupabaseMode);

  it("signs out of this browser only, and records it while the person is still signed in", async () => {
    signedInAs.user = { id: "user-1", email: "leader@example.gov", role: "leader", county: null };
    auth.signOut.mockImplementationOnce(async () => {
      expect(audited).toEqual([{ userId: "user-1", action: "auth.logout", entity: "session" }]);
      return { error: null };
    });
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const response = await POST(post("/api/auth/sign-out"), NO_PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(audited).toHaveLength(1);
  });

  it("still removes the session when the person's profile cannot be read", async () => {
    // What the gateway throws when the database API is down.
    signedInAs.failure = Object.assign(new Error("upstream connect error"), { name: "DbError" });
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const response = await POST(post("/api/auth/sign-out"), NO_PARAMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(audited).toEqual([]);
    const logged = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(logged).toContain("sign_out_not_recorded");
    expect(logged).not.toContain("upstream connect error");
  });

  it("still removes the session when the audit entry cannot be written", async () => {
    signedInAs.user = { id: "user-1", email: "leader@example.gov", role: "leader", county: null };
    auditFailure.error = new Error("insert failed");
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const response = await POST(post("/api/auth/sign-out"), NO_PARAMS);
    expect(response.status).toBe(200);
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("is safe to call when nobody is signed in, and records nothing", async () => {
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const response = await POST(post("/api/auth/sign-out"), NO_PARAMS);
    expect(response.status).toBe(200);
    expect(audited).toEqual([]);
  });

  it("still answers ok when the server-side revocation fails: the cookies are already gone", async () => {
    auth.signOut.mockResolvedValueOnce({ error: { name: "AuthRetryableFetchError" } });
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const response = await POST(post("/api/auth/sign-out"), NO_PARAMS);
    expect(response.status).toBe(200);
  });

  it("refuses a request from another site", async () => {
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const response = await POST(post("/api/auth/sign-out", undefined, { origin: "https://evil.example" }), NO_PARAMS);
    expect(response.status).toBe(403);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
