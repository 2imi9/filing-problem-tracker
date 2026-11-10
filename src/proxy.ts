import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ApiErrorBody } from "@/lib/api";
import { DEMO_COOKIE, readDemoCookie } from "@/server/auth/demoCookie";
import { APP_MODE, DEMO_COOKIE_SECRET } from "@/server/config";

// Runs before every page and API request (see `config.matcher` for what is skipped).
// A page request without a session goes to /login. An API request without one gets a 401 in the API's
// own error shape. This is the first check, not the only one: every route handler and page still calls
// requireSession, which is what actually decides.

/** Reachable without a session. */
const PUBLIC_PATHS = new Set(["/login", "/api/health", "/api/demo/login", "/api/demo/logout", "/api/mcp"]);
/**
 * Supabase mode's sign-in: the page an emailed link opens (/auth/confirm) and the routes that send the
 * link, trade it for a session, and sign out (/api/auth/*). All of them must work for a signed-out person.
 */
const PUBLIC_PREFIXES = ["/auth/", "/api/auth/"];

// Supabase mode: the auth cookie is "sb-<project ref>-auth-token", sometimes split into ".0", ".1" parts.
// A request without it is refused at once; one with it has its session verified (and renewed) below.
const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

function hasSession(request: NextRequest): boolean {
  if (APP_MODE === "demo") {
    const value = request.cookies.get(DEMO_COOKIE)?.value;
    return readDemoCookie(value, DEMO_COOKIE_SECRET, Math.floor(Date.now() / 1000)) !== null;
  }
  return request.cookies.getAll().some((cookie) => SUPABASE_AUTH_COOKIE.test(cookie.name));
}

/** What a request without a session gets: 401 JSON for the API, the sign-in page for everything else. */
function refuse(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    const requestId = crypto.randomUUID();
    const body: ApiErrorBody = { error: { code: "unauthorized", message: "Sign in to continue.", requestId } };
    return NextResponse.json(body, { status: 401, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

const UNAVAILABLE_MESSAGE = "The sign-in service could not be reached, so your session could not be checked. Try again in a moment.";
const RETRY_AFTER_SECONDS = "5";

/**
 * What a request gets when the session could not be checked at all: 503, never a 401 or the sign-in page.
 * The person may well still be signed in, and a 401 would make the browser drop what is on screen and
 * show the sign-in form. The API answer has the API's error shape; a page gets one plain sentence.
 */
function unavailable(request: NextRequest): NextResponse {
  const headers = { "retry-after": RETRY_AFTER_SECONDS, "cache-control": "no-store" };
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const requestId = crypto.randomUUID();
    const body: ApiErrorBody = { error: { code: "unavailable", message: UNAVAILABLE_MESSAGE, requestId } };
    return NextResponse.json(body, { status: 503, headers: { ...headers, "x-request-id": requestId } });
  }
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Filing Problem Tracker</title></head><body><h1>Filing Problem Tracker</h1><p>${UNAVAILABLE_MESSAGE}</p><p>You have not been signed out. Reload this page to try again.</p></body></html>`;
  return new NextResponse(page, { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/**
 * Supabase mode: verifies the session and, when the access token has run out, renews it and passes the
 * new cookies on to both the page being rendered and the browser. A page cannot set cookies while it
 * renders, so without this a person who comes back after the token's lifetime would be signed out.
 */
async function continueWithSupabaseSession(request: NextRequest): Promise<NextResponse> {
  const { refreshSupabaseSession } = await import("@/server/supabase/proxy");
  const { response, session } = await refreshSupabaseSession(request);
  if (session === "unavailable") return unavailable(request);
  return session === "signed-in" ? response : refuse(request);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  if (!hasSession(request)) return refuse(request);
  return APP_MODE === "supabase" ? continueWithSupabaseSession(request) : NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next's own assets and the static files in /public.
    "/((?!_next/static|_next/image|favicon.ico|media/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|woff2|txt|xml|webmanifest)$).*)",
  ],
};
