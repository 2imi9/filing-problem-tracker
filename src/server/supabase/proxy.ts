import "server-only";
import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_OPTIONS, supabaseFetch, supabaseSettings } from "./server";

/**
 * What Supabase said about the session on a request. "unavailable" means it said nothing: the Auth
 * server could not be reached, timed out or answered with a server error. That is not the same as being
 * signed out, and must not be treated as it: the person's session may be perfectly good.
 */
export type SessionCheck = "signed-in" | "signed-out" | "unavailable";

/**
 * Supabase mode, for src/proxy.ts: verifies the session on the request and, when the access token has
 * run out, refreshes it and writes the new cookies to both the request (so the page being rendered
 * sees the new session) and the response (so the browser keeps it). A page cannot set cookies while it
 * renders, so without this step a person who returns after the token's lifetime is signed out.
 *
 * Returns the response to continue with, and what the check found. Return this response from the proxy,
 * or copy its cookies and headers onto the one you return.
 */
export async function refreshSupabaseSession(request: NextRequest): Promise<{ response: NextResponse; session: SessionCheck }> {
  const { url, anonKey } = supabaseSettings();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    global: { fetch: supabaseFetch },
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // A response that sets a session must never be stored by a shared cache.
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  if (error) return { response, session: isAuthRetryableFetchError(error) ? "unavailable" : "signed-out" };
  return { response, session: data?.claims.sub ? "signed-in" : "signed-out" };
}
