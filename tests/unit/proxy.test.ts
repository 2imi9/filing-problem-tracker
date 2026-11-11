import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { ApiErrorBody } from "@/lib/api";
import { config, proxy } from "@/proxy";
import { DEMO_COOKIE, signDemoCookie } from "@/server/auth/demoCookie";
import { DEMO_COOKIE_SECRET } from "@/server/config";

const BASE = "http://localhost:3000";
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

function request(path: string, cookie?: string, method = "GET"): NextRequest {
  return new NextRequest(`${BASE}${path}`, { method, headers: cookie ? { cookie: `${DEMO_COOKIE}=${cookie}` } : {} });
}

const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy: without a session", () => {
  it.each(["/", "/dashboard", "/tag", "/import", "/workspace", "/admin", "/anything/else"])("redirects the page %s to /login", async (path) => {
    const response = await proxy(request(path));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(BASE);
    expect(location.pathname).toBe("/login");
  });

  it("remembers where the user was going, except for the home page", async () => {
    const deep = new URL((await proxy(request("/dashboard?county=Lake"))).headers.get("location") ?? "");
    expect(deep.searchParams.get("next")).toBe("/dashboard?county=Lake");
    const home = new URL((await proxy(request("/"))).headers.get("location") ?? "");
    expect(home.searchParams.has("next")).toBe(false);
  });

  it.each(["/login", "/api/health", "/api/demo/login", "/api/demo/logout", "/api/mcp", "/auth/confirm", "/api/auth/callback"])("lets %s through", async (path) => {
    expect(passesThrough(await proxy(request(path, undefined, path.startsWith("/api/demo") || path === "/api/mcp" ? "POST" : "GET")))).toBe(true);
  });

  it.each(["/api/auth/magic-link", "/api/auth/sign-out"])("lets the sign-in request %s through", async (path) => {
    expect(passesThrough(await proxy(request(path, undefined, "POST")))).toBe(true);
  });

  it.each(["/api/flags", "/api/me", "/api/events", "/api/folders", "/api/audit", "/api/import/preview", "/api/demo/reset", "/api/ai/summary"])(
    "answers the API request %s with 401 JSON, not a redirect",
    async (path) => {
      const response = await proxy(request(path));
      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      const body = (await response.json()) as ApiErrorBody;
      expect(body.error).toMatchObject({ code: "unauthorized", message: "Sign in to continue." });
      expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("does not treat look-alike paths as public", async () => {
    expect((await proxy(request("/login/extra"))).status).toBe(307);
    expect((await proxy(request("/api/healthz"))).status).toBe(401);
    expect((await proxy(request("/api/demo/login/again"))).status).toBe(401);
    expect((await proxy(request("/authx"))).status).toBe(307);
    expect((await proxy(request("/api/authx"))).status).toBe(401);
  });
});

describe("proxy: with a session", () => {
  it("lets pages and API requests through with a valid demo cookie", async () => {
    const cookie = signDemoCookie("demo-leader", DEMO_COOKIE_SECRET, inAnHour());
    expect(passesThrough(await proxy(request("/dashboard", cookie)))).toBe(true);
    expect(passesThrough(await proxy(request("/api/flags", cookie)))).toBe(true);
    expect(passesThrough(await proxy(request("/", cookie)))).toBe(true);
  });

  it("treats a forged, tampered or expired cookie as no session", async () => {
    const forged = signDemoCookie("demo-admin", "some-other-secret-some-other-secret-1", inAnHour());
    const tampered = signDemoCookie("demo-clerk-marion", DEMO_COOKIE_SECRET, inAnHour()).replace("demo-clerk-marion", "demo-admin");
    const expired = signDemoCookie("demo-admin", DEMO_COOKIE_SECRET, Math.floor(Date.now() / 1000) - 10);
    for (const cookie of [forged, tampered, expired, "garbage"]) {
      expect((await proxy(request("/dashboard", cookie))).status).toBe(307);
      expect((await proxy(request("/api/flags", cookie))).status).toBe(401);
    }
  });
});

describe("proxy: matcher", () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);

  it("skips Next's assets and the static files in /public", () => {
    for (const path of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico", "/brand/courthouse-ascii-hero.jpg", "/brand/mark.svg", "/icon.svg", "/apple-icon.png", "/fonts/lato.woff2"]) {
      expect(pattern.test(path)).toBe(false);
    }
  });

  it("covers pages and API routes", () => {
    for (const path of ["/", "/login", "/dashboard", "/api/flags", "/api/flags/abc/restore", "/api/mcp", "/admin"]) {
      expect(pattern.test(path)).toBe(true);
    }
  });
});
