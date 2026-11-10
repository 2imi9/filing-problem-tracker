import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptionsWithName } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { IS_PRODUCTION, LIMITS, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";

/** The project URL and anon key. Only call this in Supabase mode, where config.ts guarantees both. */
export function supabaseSettings(): { url: string; anonKey: string } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.");
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}

/**
 * The fetch every Supabase client on the server is built with. It gives each request a deadline: left
 * alone, a request to a Supabase that accepts the connection and never answers would hold a page or an
 * API call open for minutes. A caller's own abort signal still applies.
 */
export const supabaseFetch: typeof fetch = (input, init) => {
  const deadline = AbortSignal.timeout(LIMITS.supabaseTimeoutMs);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
};

/** What the Supabase Auth client answers when it could not reach the Auth server or got a server error from it. */
export const AUTH_UNAVAILABLE_MESSAGE = "The sign-in service could not be reached, so your session could not be checked. Try again in a moment.";

/**
 * How the session cookies are set. The browser never talks to Supabase itself (everything goes through
 * this app's own API), so scripts on the page have no reason to read the session: httpOnly.
 */
export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PRODUCTION,
  path: "/",
};

/**
 * A Supabase client for this request, acting as the signed-in person: it carries their own token from
 * the session cookies, never the service role key, so row level security applies to everything it does.
 * Make a new one for every request.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseSettings();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    global: { fetch: supabaseFetch },
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // A refreshed session is written back here. Route handlers can set cookies. A page (Server
        // Component) cannot, and `set` throws there; the session is then refreshed by the proxy or by
        // the page's next API request instead. The cache headers the library also passes are not
        // needed: every API response is already sent with cache-control: no-store.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Rendering a page: cookies are read-only here.
        }
      },
    },
  });
}
