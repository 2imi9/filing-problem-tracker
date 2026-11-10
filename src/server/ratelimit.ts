import "server-only";
import { LIMITS } from "./config";
import { HttpError } from "./http";

export interface RateLimitOptions {
  /** Requests allowed per window. Also the burst size. */
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Whole requests left right now. */
  remaining: number;
  /** Seconds until the next request would be allowed. Zero when `ok`. */
  retryAfterSeconds: number;
}

/** The interface the app codes against. The in-memory limiter below can be swapped for Redis or Upstash. */
export interface RateLimiter {
  limit(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
  reset(): Promise<void>;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  /** The window this key is limited over. Keys with different windows share the map. */
  windowMs: number;
}

const PRUNE_ABOVE = 10_000;

/**
 * A token bucket per key: it holds `max` tokens, refills steadily at `max` per `windowMs`, and each
 * request takes one. State lives in this process, so it suits one server instance.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    async limit(key, { max, windowMs }) {
      const at = now();
      const refillPerMs = max / windowMs;
      const bucket = buckets.get(key) ?? { tokens: max, updatedAt: at, windowMs };
      bucket.tokens = Math.min(max, bucket.tokens + (at - bucket.updatedAt) * refillPerMs);
      bucket.updatedAt = at;
      bucket.windowMs = windowMs;
      buckets.set(key, bucket);

      if (buckets.size > PRUNE_ABOVE) {
        // A bucket idle for a full window of its own is full again and can be forgotten. Each is judged by
        // its own window: a 10 minute bucket is not full after the 60 seconds of whichever key is asking now.
        for (const [k, b] of buckets) {
          if (at - b.updatedAt >= b.windowMs) buckets.delete(k);
        }
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
      }
      return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) };
    },
    async reset() {
      buckets.clear();
    },
  };
}

// One limiter per process, kept across module reloads in development.
const GLOBAL_KEY = Symbol.for("fpt.rateLimiter");
type GlobalWithLimiter = typeof globalThis & { [GLOBAL_KEY]?: RateLimiter };

function limiter(): RateLimiter {
  const g = globalThis as GlobalWithLimiter;
  g[GLOBAL_KEY] ??= createMemoryRateLimiter();
  return g[GLOBAL_KEY];
}

/** Takes one token for `key`. */
export function limit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  return limiter().limit(key, options);
}

/** Forgets every bucket. Used by tests, and by the demo reset of a test server (DEMO_RESET_CLEARS_LIMITS=1). */
export function resetRateLimits(): Promise<void> {
  return limiter().reset();
}

export type RateLimitKind = "mutation" | "ai" | "login";

/**
 * Counts one request of this kind for the subject (a user id, or clientAddress() for sign-in) and throws
 * HttpError 429 with Retry-After when the limit is reached: 60 mutations and 20 AI requests per user
 * per minute by default.
 */
export async function enforceRateLimit(subject: string, kind: RateLimitKind): Promise<void> {
  const max = kind === "ai" ? LIMITS.aiPerMinute : kind === "login" ? LIMITS.loginsPerMinute : LIMITS.mutationsPerMinute;
  const result = await limit(`${kind}:${subject}`, { max, windowMs: LIMITS.rateWindowMs });
  if (!result.ok) {
    throw new HttpError(429, `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`, {
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    });
  }
}
