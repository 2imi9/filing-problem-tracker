import { describe, expect, it } from "vitest";
import { AI_ENABLED, AI_MODEL, APP_MODE, ConfigError, LIMITS, loadConfig } from "@/server/config";

const SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-anon-key-anon-key-anon-key",
};

describe("loadConfig", () => {
  it("is demo mode with AI off when nothing is set", () => {
    const config = loadConfig({});
    expect(config.APP_MODE).toBe("demo");
    expect(config.AI_ENABLED).toBe(false);
    expect(config.ANTHROPIC_API_KEY).toBeNull();
    expect(config.SUPABASE_URL).toBeNull();
    expect(config.MCP_TOKEN).toBeNull();
    expect(config.APP_ORIGIN).toBeNull();
    expect(config.IS_PRODUCTION).toBe(false);
    expect(config.DEMO_COOKIE_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("has the documented limits", () => {
    const { LIMITS: limits } = loadConfig({});
    expect(limits.mutationsPerMinute).toBe(60);
    expect(limits.aiPerMinute).toBe(20);
    expect(limits.rateWindowMs).toBe(60_000);
    expect(limits.softDeleteWindowMs).toBe(5 * 60_000);
    expect(limits.maxBodyBytes).toBeGreaterThan(5 * 1024 * 1024);
  });

  it("trusts no proxy and keeps the rate limits on a demo reset unless told otherwise", () => {
    expect(loadConfig({}).TRUSTED_PROXY_HOPS).toBe(0);
    expect(loadConfig({ TRUSTED_PROXY_HOPS: "1" }).TRUSTED_PROXY_HOPS).toBe(1);
    for (const value of ["-1", "1.5", "11", "many"]) expect(() => loadConfig({ TRUSTED_PROXY_HOPS: value })).toThrow(ConfigError);
    expect(loadConfig({}).DEMO_RESET_CLEARS_LIMITS).toBe(false);
    expect(loadConfig({ DEMO_RESET_CLEARS_LIMITS: "0" }).DEMO_RESET_CLEARS_LIMITS).toBe(false);
    expect(loadConfig({ DEMO_RESET_CLEARS_LIMITS: "1" }).DEMO_RESET_CLEARS_LIMITS).toBe(true);
    expect(() => loadConfig({ DEMO_RESET_CLEARS_LIMITS: "yes" })).toThrow(/DEMO_RESET_CLEARS_LIMITS must be 0 or 1/);
  });

  it("is supabase mode when both Supabase settings are present", () => {
    const config = loadConfig(SUPABASE);
    expect(config.APP_MODE).toBe("supabase");
    expect(config.SUPABASE_URL).toBe("https://project.supabase.co");
    expect(config.SUPABASE_ANON_KEY).toBe(SUPABASE.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });

  it("refuses a half-configured Supabase environment with a clear message", () => {
    for (const env of [{ NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE.NEXT_PUBLIC_SUPABASE_ANON_KEY }]) {
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(/set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    }
  });

  it("treats empty values as not set", () => {
    const config = loadConfig({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", ANTHROPIC_API_KEY: "", MCP_TOKEN: "" });
    expect(config.APP_MODE).toBe("demo");
    expect(config.AI_ENABLED).toBe(false);
    expect(config.MCP_TOKEN).toBeNull();
  });

  it("turns AI on with a key and takes the model from AI_MODEL", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "sk-test" });
    expect(config.AI_ENABLED).toBe(true);
    expect(config.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(config.AI_MODEL).toBe(loadConfig({}).AI_MODEL);
    expect(loadConfig({ AI_MODEL: "another-model" }).AI_MODEL).toBe("another-model");
  });

  it("refuses a production start in demo mode unless a secret or ALLOW_DEMO=1 is given", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/production start in demo mode/);
    expect(loadConfig({ NODE_ENV: "production", ALLOW_DEMO: "1" }).APP_MODE).toBe("demo");
    const secret = "s".repeat(32);
    expect(loadConfig({ NODE_ENV: "production", DEMO_COOKIE_SECRET: secret }).DEMO_COOKIE_SECRET).toBe(secret);
    expect(() => loadConfig({ NODE_ENV: "production", ALLOW_DEMO: "0" })).toThrow(ConfigError);
    // Supabase mode in production needs neither.
    expect(loadConfig({ NODE_ENV: "production", ...SUPABASE }).APP_MODE).toBe("supabase");
  });

  it("lets the production build run in demo mode; only the start is refused", () => {
    expect(loadConfig({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }).APP_MODE).toBe("demo");
  });

  it("refuses malformed values and names the variable", () => {
    expect(() => loadConfig({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE.NEXT_PUBLIC_SUPABASE_ANON_KEY })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => loadConfig({ DEMO_COOKIE_SECRET: "short" })).toThrow(/DEMO_COOKIE_SECRET/);
    expect(() => loadConfig({ MCP_TOKEN: "short" })).toThrow(/MCP_TOKEN/);
    expect(() => loadConfig({ ALLOW_DEMO: "yes" })).toThrow(/ALLOW_DEMO/);
    expect(() => loadConfig({ APP_ORIGIN: "tracker.example.gov" })).toThrow(/APP_ORIGIN/);
    expect(() => loadConfig({ RATE_LIMIT_AI_PER_MINUTE: "lots" })).toThrow(/RATE_LIMIT_AI_PER_MINUTE/);
  });

  it("reduces APP_ORIGIN to an origin and reads rate limit overrides", () => {
    const config = loadConfig({ APP_ORIGIN: "https://tracker.example.gov/some/path", RATE_LIMIT_MUTATIONS_PER_MINUTE: "600", RATE_LIMIT_AI_PER_MINUTE: "5" });
    expect(config.APP_ORIGIN).toBe("https://tracker.example.gov");
    expect(config.LIMITS.mutationsPerMinute).toBe(600);
    expect(config.LIMITS.aiPerMinute).toBe(5);
  });
});

describe("the config the tests run with", () => {
  it("is demo mode with AI off and the default limits", () => {
    expect(APP_MODE).toBe("demo");
    expect(AI_ENABLED).toBe(false);
    expect(AI_MODEL.length).toBeGreaterThan(0);
    expect(LIMITS.mutationsPerMinute).toBe(60);
  });
});
