import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USERS } from "@/lib/sample";
import { DEMO_COOKIE, readDemoCookie, signDemoCookie } from "@/server/auth/demoCookie";
import { endDemoSession, getSession, requireSession, startDemoSession } from "@/server/auth/session";
import { DEMO_COOKIE_SECRET, LIMITS } from "@/server/config";
import { clearCookies, cookieJar, cookieOptions } from "./cookies";

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const SECRET = "a-test-secret-that-is-long-enough-32";
const NOW = 1_800_000_000;

describe("demo cookie", () => {
  it("round-trips each demo user", () => {
    for (const user of DEMO_USERS) {
      const value = signDemoCookie(user.id, SECRET, NOW + 60);
      expect(readDemoCookie(value, SECRET, NOW)).toEqual({ id: user.id, email: user.email, role: user.role, county: user.county });
    }
  });

  it("has the form v1.<user>.<expiry>.<signature> and holds nothing else", () => {
    const value = signDemoCookie("demo-leader", SECRET, NOW + 60);
    const parts = value.split(".");
    expect(parts.slice(0, 3)).toEqual(["v1", "demo-leader", String(NOW + 60)]);
    expect(parts[3]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a missing, malformed or tampered cookie", () => {
    const value = signDemoCookie("demo-clerk-marion", SECRET, NOW + 60);
    expect(readDemoCookie(undefined, SECRET, NOW)).toBeNull();
    expect(readDemoCookie("", SECRET, NOW)).toBeNull();
    expect(readDemoCookie("demo-admin", SECRET, NOW)).toBeNull();
    expect(readDemoCookie("v1.demo-admin.9999999999.", SECRET, NOW)).toBeNull();
    // Swapping the user or the expiry while keeping the signature must fail.
    expect(readDemoCookie(value.replace("demo-clerk-marion", "demo-admin"), SECRET, NOW)).toBeNull();
    expect(readDemoCookie(value.replace(String(NOW + 60), String(NOW + 6000)), SECRET, NOW)).toBeNull();
    expect(readDemoCookie(value.replace("v1.", "v2."), SECRET, NOW)).toBeNull();
    expect(readDemoCookie(`${value}x`, SECRET, NOW)).toBeNull();
  });

  it("refuses a cookie signed with another secret", () => {
    const value = signDemoCookie("demo-admin", "another-secret-another-secret-123456", NOW + 60);
    expect(readDemoCookie(value, SECRET, NOW)).toBeNull();
  });

  it("refuses an expired cookie", () => {
    const value = signDemoCookie("demo-admin", SECRET, NOW + 60);
    expect(readDemoCookie(value, SECRET, NOW + 59)).not.toBeNull();
    expect(readDemoCookie(value, SECRET, NOW + 60)).toBeNull();
    expect(readDemoCookie(value, SECRET, NOW + 600)).toBeNull();
  });

  it("refuses a correctly signed cookie for a user that is not a demo user", () => {
    const forged = signDemoCookie("demo-admin", SECRET, NOW + 60).replace("demo-admin", "root");
    expect(readDemoCookie(forged, SECRET, NOW)).toBeNull();
    // Even signed properly by someone holding the secret, an unknown id is nobody.
    const signedUnknown = signDemoCookie("root" as never, SECRET, NOW + 60);
    expect(readDemoCookie(signedUnknown, SECRET, NOW)).toBeNull();
  });
});

describe("getSession and requireSession in demo mode", () => {
  beforeEach(() => {
    clearCookies();
  });

  it("is null with no cookie, and requireSession throws 401", async () => {
    expect(await getSession()).toBeNull();
    await expect(requireSession()).rejects.toMatchObject({ status: 401, code: "unauthorized", message: "Sign in to continue." });
  });

  it("startDemoSession sets an httpOnly, SameSite=Lax cookie that getSession reads back", async () => {
    await startDemoSession("demo-clerk-lake", false);
    expect(cookieOptions(DEMO_COOKIE)).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: LIMITS.demoSessionSeconds });
    expect(await getSession()).toEqual({ id: "demo-clerk-lake", email: "clerk.lake@demo.invalid", role: "clerk", county: "Lake" });
    await startDemoSession("demo-admin", true);
    expect(cookieOptions(DEMO_COOKIE)?.secure).toBe(true);
    expect((await getSession())?.role).toBe("admin");
  });

  it("requireSession returns the user, and enforces roles with 403", async () => {
    await startDemoSession("demo-leader", false);
    expect((await requireSession()).id).toBe("demo-leader");
    expect((await requireSession(["leader", "admin"])).role).toBe("leader");
    await expect(requireSession(["clerk", "admin"])).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(requireSession([])).rejects.toMatchObject({ status: 403 });
  });

  it("ignores a cookie that was tampered with or signed with another secret", async () => {
    const good = signDemoCookie("demo-clerk-marion", DEMO_COOKIE_SECRET, Math.floor(Date.now() / 1000) + 600);
    cookieJar.set(DEMO_COOKIE, good.replace("demo-clerk-marion", "demo-admin"));
    expect(await getSession()).toBeNull();
    cookieJar.set(DEMO_COOKIE, signDemoCookie("demo-admin", "another-secret-another-secret-123456", Math.floor(Date.now() / 1000) + 600));
    expect(await getSession()).toBeNull();
    cookieJar.set(DEMO_COOKIE, good);
    expect((await getSession())?.id).toBe("demo-clerk-marion");
  });

  it("endDemoSession signs out", async () => {
    await startDemoSession("demo-admin", false);
    await endDemoSession();
    expect(cookieJar.get(DEMO_COOKIE)).toBeUndefined();
    expect(await getSession()).toBeNull();
  });
});
