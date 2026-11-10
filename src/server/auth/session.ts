import "server-only";
import { io } from "next/cache";
import { cookies } from "next/headers";
import type { Role, SessionUser } from "@/lib/domain";
import type { DemoUserId } from "@/lib/sample";
import { APP_MODE, DEMO_COOKIE_SECRET, LIMITS } from "../config";
import { HttpError } from "../http";
import { noteRequestUser } from "../requestContext";
import { DEMO_COOKIE, readDemoCookie, signDemoCookie } from "./demoCookie";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * The signed-in user, or null. Pages and route handlers call this (or requireSession) and never look at
 * cookies or the run mode themselves.
 */
export async function getSession(): Promise<SessionUser | null> {
  // Whether a session is still good depends on the clock (the demo cookie's expiry below, the token's
  // expiry inside the Supabase client), so the answer belongs to one real request and never to a
  // prerender. Reading cookies() first does not make that so. With `partialPrefetching` on, Next.js
  // renders a signed-in page request a second time as a "runtime prerender" (the App Shell the browser
  // keeps for the session), and cookies() resolves in that render. A clock read after it then happens
  // inside a prerender, and Next.js logs "encountered the unstable value `Date.now()` while
  // prerendering" for every signed-in request to a page that calls this.
  //
  // io() says "what follows is not for prerendering"; see 01-app/03-api-reference/04-functions/io.md
  // under node_modules/next/dist/docs. In a prerender it never resolves, so nothing below runs there.
  // For a real page request, in a route handler and outside Next.js (unit tests) it resolves at once.
  // tests/unit/session-prerender.test.ts fails if this line goes.
  await io();
  let user: SessionUser | null;
  if (APP_MODE === "demo") {
    const store = await cookies();
    user = readDemoCookie(store.get(DEMO_COOKIE)?.value, DEMO_COOKIE_SECRET, nowSeconds());
  } else {
    const { getSupabaseSession } = await import("./supabase");
    user = await getSupabaseSession();
  }
  if (user) noteRequestUser(user.id);
  return user;
}

/**
 * The signed-in user. Throws HttpError 401 when nobody is signed in, and 403 when `roles` is given and
 * the user's role is not one of them.
 */
export async function requireSession(roles?: readonly Role[]): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new HttpError(401, "Sign in to continue.");
  if (roles && !roles.includes(user.role)) throw new HttpError(403, "Your role does not allow this.");
  return user;
}

/** Demo mode: signs in as one of the fixed demo users by setting the signed cookie. */
export async function startDemoSession(userId: DemoUserId, secure: boolean): Promise<void> {
  const store = await cookies();
  store.set(DEMO_COOKIE, signDemoCookie(userId, DEMO_COOKIE_SECRET, nowSeconds() + LIMITS.demoSessionSeconds), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: LIMITS.demoSessionSeconds,
  });
}

/** Demo mode: signs out. */
export async function endDemoSession(): Promise<void> {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
}
