// How the Supabase session cookies are read and written, with the Supabase client replaced by a
// stand-in that records the cookie handlers it is given: in a route handler, while a page renders, and
// in the proxy helper that refreshes a session.

import { AuthInvalidJwtError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CookieToSet {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

interface ClientOptions {
  cookieOptions: Record<string, unknown>;
  cookies: {
    getAll(): { name: string; value: string }[];
    setAll(list: CookieToSet[], headers: Record<string, string>): void;
  };
}

const created = vi.hoisted(() => ({
  url: "",
  key: "",
  options: null as ClientOptions | null,
  claims: null as { sub: string } | null,
  refresh: false,
  /** What getClaims() reports instead of an answer. */
  error: null as Error | null,
}));

const NEW_SESSION: CookieToSet = { name: "sb-project-auth-token", value: "refreshed", options: { path: "/", httpOnly: true, sameSite: "lax" } };
const NO_STORE = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" };

vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, options: ClientOptions) => {
    Object.assign(created, { url, key, options });
    return {
      auth: {
        // Stands in for the real client, which writes a refreshed session through setAll before it answers.
        getClaims: async () => {
          if (created.refresh) options.cookies.setAll([NEW_SESSION], NO_STORE);
          if (created.error) return { data: null, error: created.error };
          return { data: created.claims ? { claims: created.claims } : null, error: null };
        },
      },
    };
  },
}));

const store = vi.hoisted(() => ({
  cookies: [{ name: "sb-project-auth-token", value: "current" }],
  set: null as ((name: string, value: string, options: Record<string, unknown>) => void) | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => store.cookies,
    set: (name: string, value: string, options: Record<string, unknown>) => store.set?.(name, value, options),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-anon-key-anon-key-anon-key");
  Object.assign(created, { url: "", key: "", options: null, claims: null, refresh: false, error: null });
  store.set = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createSupabaseServerClient", () => {
  it("uses the project URL and the anon key, never another key, and httpOnly session cookies", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-that-must-not-be-used-here");
    const { createSupabaseServerClient } = await import("@/server/supabase/server");
    await createSupabaseServerClient();
    expect(created.url).toBe("https://project.supabase.co");
    expect(created.key).toBe("anon-key-anon-key-anon-key-anon-key");
    expect(created.options?.cookieOptions).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(created.options?.cookies.getAll()).toEqual([{ name: "sb-project-auth-token", value: "current" }]);
  });

  it("writes a refreshed session to the response cookies in a route handler", async () => {
    const written: unknown[] = [];
    store.set = (name, value, options) => written.push({ name, value, options });
    const { createSupabaseServerClient } = await import("@/server/supabase/server");
    await createSupabaseServerClient();
    created.options?.cookies.setAll([NEW_SESSION], NO_STORE);
    expect(written).toEqual([NEW_SESSION]);
  });

  it("does not fail while a page renders, where cookies cannot be set", async () => {
    store.set = () => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
    };
    const { createSupabaseServerClient } = await import("@/server/supabase/server");
    await createSupabaseServerClient();
    expect(() => created.options?.cookies.setAll([NEW_SESSION], NO_STORE)).not.toThrow();
  });

  it("refuses to build a client when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { createSupabaseServerClient } = await import("@/server/supabase/server");
    await expect(createSupabaseServerClient()).rejects.toThrow("Supabase is not configured");
  });
});

describe("refreshSupabaseSession (for the proxy)", () => {
  const request = () => new NextRequest("http://localhost:3000/dashboard", { headers: { cookie: "sb-project-auth-token=expired" } });

  it("passes a valid session through untouched", async () => {
    created.claims = { sub: "user-1" };
    const { refreshSupabaseSession } = await import("@/server/supabase/proxy");
    const { response, session } = await refreshSupabaseSession(request());
    expect(session).toBe("signed-in");
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.getAll()).toEqual([]);
  });

  it("gives a refreshed session to the page being rendered and to the browser, and forbids caching it", async () => {
    created.claims = { sub: "user-1" };
    created.refresh = true;
    const incoming = request();
    const { refreshSupabaseSession } = await import("@/server/supabase/proxy");
    const { response, session } = await refreshSupabaseSession(incoming);
    expect(session).toBe("signed-in");
    expect(incoming.cookies.get("sb-project-auth-token")?.value).toBe("refreshed");
    expect(response.cookies.get("sb-project-auth-token")).toMatchObject({ value: "refreshed", httpOnly: true, sameSite: "lax", path: "/" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    // The refreshed cookie is forwarded to the page as part of the request.
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-project-auth-token=refreshed");
  });

  it("reports nobody signed in when the session cannot be verified", async () => {
    const { refreshSupabaseSession } = await import("@/server/supabase/proxy");
    expect((await refreshSupabaseSession(request())).session).toBe("signed-out");
    created.error = new AuthInvalidJwtError("Invalid JWT signature");
    expect((await refreshSupabaseSession(request())).session).toBe("signed-out");
  });

  it("reports that it could not check, not that nobody is signed in, when the Auth server cannot be reached", async () => {
    created.claims = { sub: "user-1" };
    created.error = new AuthRetryableFetchError("fetch failed", 0);
    const { refreshSupabaseSession } = await import("@/server/supabase/proxy");
    expect((await refreshSupabaseSession(request())).session).toBe("unavailable");
  });
});
