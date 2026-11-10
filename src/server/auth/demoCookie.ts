import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "@/lib/domain";
import { demoUserById } from "@/lib/sample";
import type { DemoUserId } from "@/lib/sample";

// The demo session cookie: "v1.<demo user id>.<expiry, epoch seconds>.<HMAC-SHA256, base64url>".
// It names one of the fixed demo users and nothing else. Pure functions, so the proxy can use them too.

export const DEMO_COOKIE = "fpt_demo";
const VERSION = "v1";

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function signDemoCookie(userId: DemoUserId, secret: string, expiresAtSeconds: number): string {
  const payload = `${VERSION}.${userId}.${expiresAtSeconds}`;
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/** The demo user a cookie value names, or null when it is missing, altered, expired or unknown. */
export function readDemoCookie(value: string | undefined, secret: string, nowSeconds: number): SessionUser | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, userId, expires, mac] = parts;
  const expected = signature(`${VERSION}.${userId}.${expires}`, secret);
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!/^\d+$/.test(expires) || Number(expires) <= nowSeconds) return null;
  return demoUserById(userId);
}
