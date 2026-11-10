import "server-only";
import { z } from "zod";
import type { AppMode } from "@/lib/domain";

// Reads and validates the environment once. Everything else on the server imports the constants below
// and never touches process.env.

const DEFAULT_AI_MODEL = "claude-fable-5-2";
// Signs the demo cookie when no secret is set. It is public on purpose: demo sign-in is an open role
// picker, so the signature only protects the cookie's shape. Production demo deployments must opt in.
const LOCAL_DEMO_COOKIE_SECRET = "filing-tracker-demo-cookie-local-secret";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PHASE: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a URL." }).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, { error: "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short." }).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, { error: "SUPABASE_SERVICE_ROLE_KEY looks too short." }).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default(DEFAULT_AI_MODEL),
  DEMO_COOKIE_SECRET: z.string().min(32, { error: "DEMO_COOKIE_SECRET must be at least 32 characters." }).optional(),
  ALLOW_DEMO: z.enum(["0", "1"], { error: "ALLOW_DEMO must be 0 or 1." }).optional(),
  MCP_TOKEN: z.string().min(24, { error: "MCP_TOKEN must be at least 24 characters." }).optional(),
  APP_ORIGIN: z.url({ error: "APP_ORIGIN must be a URL such as https://tracker.example.gov." }).optional(),
  RATE_LIMIT_MUTATIONS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(60),
  RATE_LIMIT_AI_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(20),
  TRUSTED_PROXY_HOPS: z.coerce.number({ error: "TRUSTED_PROXY_HOPS must be a whole number from 0 to 10." }).int().min(0).max(10).default(0),
  DEMO_RESET_CLEARS_LIMITS: z.enum(["0", "1"], { error: "DEMO_RESET_CLEARS_LIMITS must be 0 or 1." }).optional(),
});

export interface AppConfig {
  APP_MODE: AppMode;
  IS_PRODUCTION: boolean;
  AI_ENABLED: boolean;
  AI_MODEL: string;
  ANTHROPIC_API_KEY: string | null;
  SUPABASE_URL: string | null;
  SUPABASE_ANON_KEY: string | null;
  /** Used for one thing only: looking up MCP tokens (src/server/mcp/supabase-tokens.ts). */
  SUPABASE_SERVICE_ROLE_KEY: string | null;
  DEMO_COOKIE_SECRET: string;
  MCP_TOKEN: string | null;
  /** The app's own origin (scheme, host, port) when set, for the Origin check. */
  APP_ORIGIN: string | null;
  /**
   * How many proxies this deployment runs behind that append to X-Forwarded-For and can be believed.
   * 0 means none: the header is ignored and sign-in attempts are counted together (src/server/clientAddress.ts).
   */
  TRUSTED_PROXY_HOPS: number;
  /**
   * Whether POST /api/demo/reset also forgets every rate limit. Off unless a test server turns it on:
   * left on, any demo account could lift everyone's limits at will.
   */
  DEMO_RESET_CLEARS_LIMITS: boolean;
  LIMITS: {
    mutationsPerMinute: number;
    aiPerMinute: number;
    loginsPerMinute: number;
    rateWindowMs: number;
    /** A clerk can delete their own entry, and undo that, for this long. */
    softDeleteWindowMs: number;
    maxBodyBytes: number;
    recentDefault: number;
    recentMax: number;
    auditDefault: number;
    auditMax: number;
    foldersPerUser: number;
    demoSessionSeconds: number;
    /** The most flagged filings, and the most import batches, the demo's in-memory store will hold. */
    demoMaxFlags: number;
    demoMaxBatches: number;
    /** How long one request to Supabase may take before it is given up. */
    supabaseTimeoutMs: number;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Configuration error: ${message}`);
    this.name = "ConfigError";
  }
}

/** Builds the config from an environment. Throws ConfigError with a plain message when it is not usable. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  // An empty value means "not set".
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ""));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "));
  }
  const e = parsed.data;

  const hasUrl = e.NEXT_PUBLIC_SUPABASE_URL !== undefined;
  const hasKey = e.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined;
  if (hasUrl !== hasKey) {
    throw new ConfigError(
      "set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to use Supabase, or neither to run in demo mode. Only one of them is set.",
    );
  }
  const mode: AppMode = hasUrl ? "supabase" : "demo";
  if (mode === "demo" && e.SUPABASE_SERVICE_ROLE_KEY !== undefined) {
    throw new ConfigError(
      "SUPABASE_SERVICE_ROLE_KEY is set but NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not. Set all three to use Supabase, or remove the key to run in demo mode.",
    );
  }
  const isProduction = e.NODE_ENV === "production";
  const isBuild = e.NEXT_PHASE === "phase-production-build";

  if (mode === "demo" && isProduction && !isBuild && !e.DEMO_COOKIE_SECRET && e.ALLOW_DEMO !== "1") {
    throw new ConfigError(
      "this is a production start in demo mode (no Supabase settings). Demo mode has open sign-in and made-up data. Set DEMO_COOKIE_SECRET, or ALLOW_DEMO=1, to confirm that is intended.",
    );
  }

  return {
    APP_MODE: mode,
    IS_PRODUCTION: isProduction,
    AI_ENABLED: e.ANTHROPIC_API_KEY !== undefined,
    AI_MODEL: e.AI_MODEL,
    ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY ?? null,
    SUPABASE_URL: e.NEXT_PUBLIC_SUPABASE_URL ?? null,
    SUPABASE_ANON_KEY: e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SERVICE_ROLE_KEY ?? null,
    DEMO_COOKIE_SECRET: e.DEMO_COOKIE_SECRET ?? LOCAL_DEMO_COOKIE_SECRET,
    MCP_TOKEN: e.MCP_TOKEN ?? null,
    APP_ORIGIN: e.APP_ORIGIN ? new URL(e.APP_ORIGIN).origin : null,
    TRUSTED_PROXY_HOPS: e.TRUSTED_PROXY_HOPS,
    DEMO_RESET_CLEARS_LIMITS: e.DEMO_RESET_CLEARS_LIMITS === "1",
    LIMITS: {
      mutationsPerMinute: e.RATE_LIMIT_MUTATIONS_PER_MINUTE,
      aiPerMinute: e.RATE_LIMIT_AI_PER_MINUTE,
      loginsPerMinute: 120,
      rateWindowMs: 60_000,
      softDeleteWindowMs: 5 * 60_000,
      maxBodyBytes: 6 * 1024 * 1024,
      recentDefault: 10,
      recentMax: 50,
      auditDefault: 100,
      auditMax: 500,
      foldersPerUser: 50,
      demoSessionSeconds: 8 * 60 * 60,
      demoMaxFlags: 50_000,
      demoMaxBatches: 500,
      supabaseTimeoutMs: 10_000,
    },
  };
}

const config = loadConfig(process.env);

export const APP_MODE = config.APP_MODE;
export const IS_PRODUCTION = config.IS_PRODUCTION;
export const AI_ENABLED = config.AI_ENABLED;
export const AI_MODEL = config.AI_MODEL;
export const ANTHROPIC_API_KEY = config.ANTHROPIC_API_KEY;
export const SUPABASE_URL = config.SUPABASE_URL;
export const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = config.SUPABASE_SERVICE_ROLE_KEY;
export const DEMO_COOKIE_SECRET = config.DEMO_COOKIE_SECRET;
export const MCP_TOKEN = config.MCP_TOKEN;
export const APP_ORIGIN = config.APP_ORIGIN;
export const TRUSTED_PROXY_HOPS = config.TRUSTED_PROXY_HOPS;
export const DEMO_RESET_CLEARS_LIMITS = config.DEMO_RESET_CLEARS_LIMITS;
export const LIMITS = config.LIMITS;
