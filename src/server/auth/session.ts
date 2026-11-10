import "server-only";
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
