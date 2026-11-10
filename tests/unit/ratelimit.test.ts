import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "@/server/http";
import { createMemoryRateLimiter, enforceRateLimit, limit, resetRateLimits } from "@/server/ratelimit";

describe("createMemoryRateLimiter (token bucket)", () => {
  const options = { max: 3, windowMs: 60_000 };

  it("allows a burst of max requests, then refuses with a wait time", async () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter(() => now);
    expect(await limiter.limit("a", options)).toEqual({ ok: true, remaining: 2, retryAfterSeconds: 0 });
    expect(await limiter.limit("a", options)).toEqual({ ok: true, remaining: 1, retryAfterSeconds: 0 });
    expect(await limiter.limit("a", options)).toEqual({ ok: true, remaining: 0, retryAfterSeconds: 0 });
    // One token comes back every 20 seconds.
    expect(await limiter.limit("a", options)).toEqual({ ok: false, remaining: 0, retryAfterSeconds: 20 });
    now += 5_000;
    expect(await limiter.limit("a", options)).toEqual({ ok: false, remaining: 0, retryAfterSeconds: 15 });
  });

  it("refills steadily: one request per window/max after the burst", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) await limiter.limit("a", options);
    now += 19_999;
    expect((await limiter.limit("a", options)).ok).toBe(false);
    now += 1;
    expect((await limiter.limit("a", options)).ok).toBe(true);
    expect((await limiter.limit("a", options)).ok).toBe(false);
  });

  it("is full again after a whole window, and never holds more than max", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) await limiter.limit("a", options);
    now += 10 * 60_000;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await limiter.limit("a", options)).ok);
    expect(results).toEqual([true, true, true, false]);
  });

  it("never allows more than max plus the refill over a period", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    let allowed = 0;
    // An attempt every 200 ms from 0 s to 120 s inclusive, at max 3 per minute:
    // 3 from the burst, then one each at 20, 40, 60, 80, 100 and 120 s = 9.
    for (let i = 0; i <= 600; i++) {
      if ((await limiter.limit("a", options)).ok) allowed++;
      now += 200;
    }
    expect(allowed).toBe(9);
  });

  it("keeps keys apart", async () => {
    const limiter = createMemoryRateLimiter(() => 0);
    for (let i = 0; i < 3; i++) await limiter.limit("a", options);
    expect((await limiter.limit("a", options)).ok).toBe(false);
    expect((await limiter.limit("b", options)).ok).toBe(true);
  });

  it("does not forget a used-up bucket with a long window when many short-window keys are in use", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    const tenMinutes = { max: 3, windowMs: 10 * 60_000 };
    for (let i = 0; i < 3; i++) await limiter.limit("magic-link:email:x", tenMinutes);
    expect((await limiter.limit("magic-link:email:x", tenMinutes)).ok).toBe(false);

    // More keys than the limiter keeps without tidying up, each with a 60 second window.
    for (let i = 0; i < 10_001; i++) await limiter.limit(`login:${i}`, options);
    now += 61_000;
    await limiter.limit("login:another", options);

    // 61 seconds on, the 10 minute bucket has earned back less than one request.
    const again = await limiter.limit("magic-link:email:x", tenMinutes);
    expect(again.ok).toBe(false);
    expect(again.retryAfterSeconds).toBe(139);
  });

  it("still forgets buckets that have been idle for their own whole window", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) await limiter.limit("short", options);
    for (let i = 0; i < 10_001; i++) await limiter.limit(`other:${i}`, options);
    now += 60_000;
    await limiter.limit("trigger", options);
    expect(await limiter.limit("short", options)).toEqual({ ok: true, remaining: 2, retryAfterSeconds: 0 });
  });

  it("reset forgets every bucket", async () => {
    const limiter = createMemoryRateLimiter(() => 0);
    for (let i = 0; i < 3; i++) await limiter.limit("a", options);
    await limiter.reset();
    expect((await limiter.limit("a", options)).ok).toBe(true);
  });
});

describe("the process-wide limiter", () => {
  afterEach(async () => {
    await resetRateLimits();
  });

  it("limit() counts against one shared limiter", async () => {
    expect((await limit("shared-key", { max: 1, windowMs: 60_000 })).ok).toBe(true);
    expect((await limit("shared-key", { max: 1, windowMs: 60_000 })).ok).toBe(false);
    await resetRateLimits();
    expect((await limit("shared-key", { max: 1, windowMs: 60_000 })).ok).toBe(true);
  });

  it("enforceRateLimit allows 60 mutations a minute per user, then throws 429 with Retry-After", async () => {
    for (let i = 0; i < 60; i++) await enforceRateLimit("user-1", "mutation");
    let caught: unknown;
    try {
      await enforceRateLimit("user-1", "mutation");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    const error = caught as HttpError;
    expect(error.status).toBe(429);
    expect(error.code).toBe("rate_limited");
    expect(error.headers).toEqual({ "Retry-After": "1" });
    expect(error.message).toBe("Too many requests. Try again in 1 seconds.");
    // Another user, and the same user's AI budget, are separate.
    await expect(enforceRateLimit("user-2", "mutation")).resolves.toBeUndefined();
    await expect(enforceRateLimit("user-1", "ai")).resolves.toBeUndefined();
  });

  it("enforceRateLimit allows 20 AI requests a minute per user", async () => {
    for (let i = 0; i < 20; i++) await enforceRateLimit("user-1", "ai");
    await expect(enforceRateLimit("user-1", "ai")).rejects.toMatchObject({ status: 429, headers: { "Retry-After": "3" } });
  });
});
