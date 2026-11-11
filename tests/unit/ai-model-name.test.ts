import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthResponse, MeResponse } from "@/lib/api";
import type { RouteHandler } from "@/server/http";
import { resetRateLimits } from "@/server/ratelimit";
import { resetMemoryStore } from "@/server/repo/memory";
import { clearCookies, cookieJar } from "./cookies";

import * as loginRoute from "@/app/api/demo/login/route";
import * as healthRoute from "@/app/api/health/route";
import * as meRoute from "@/app/api/me/route";

// With AI switched on, the two routes the page frame reads say which model is configured, so the footer
// can name it. With AI off they say null (tests/unit/api.test.ts). The model id here is made up.
const MODEL = "example-model-for-tests";

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));
vi.mock("@/server/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/config")>();
  return { ...actual, AI_ENABLED: true, AI_MODEL: "example-model-for-tests" };
});

const BASE = "http://localhost:3000";

async function call<T>(handler: unknown, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const request = new Request(`${BASE}${path}`, {
    method,
    headers: { host: "localhost:3000", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await (handler as RouteHandler<object>)(request, { params: Promise.resolve({}) });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

beforeEach(async () => {
  clearCookies();
  resetMemoryStore();
  await resetRateLimits();
  // Each handled request writes one log line.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the configured model's name, when AI is on", () => {
  it("GET /api/health names it", async () => {
    const health = await call<HealthResponse>(healthRoute.GET, "GET", "/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, ai: true, aiModel: MODEL });
  });

  it("GET /api/me names it to a signed-in person, and says nothing to anyone else", async () => {
    const anonymous = await call<unknown>(meRoute.GET, "GET", "/api/me");
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(anonymous.body)).not.toContain(MODEL);

    expect((await call(loginRoute.POST, "POST", "/api/demo/login", { userId: "demo-leader" })).status).toBe(200);
    const me = await call<MeResponse>(meRoute.GET, "GET", "/api/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ ai: true, aiModel: MODEL });
  });
});
