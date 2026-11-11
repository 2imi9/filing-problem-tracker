import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Security headers for every response, pages and API alike. "Security model" and "Known limits" in
// specs/001-filing-problem-tracker/plan.md say what the policy covers and what it does not.
//
// The policy is a fixed string, worked out when the app is built (or when `next dev` starts). It has no
// per-request nonce: a nonce needs every page rendered on request, which `cacheComponents` below rules
// out, and Next.js writes its page data into inline scripts that only a nonce or 'unsafe-inline' allows.
// So scripts are limited to this origin plus inline, and everything else is locked down.

/** The Supabase project's origin, when Supabase is configured. A bad value is reported by src/server/config.ts. */
function supabaseOrigin(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(isDev: boolean): string {
  const supabase = supabaseOrigin();
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' is for React's development tooling only. It is never sent by a production build.
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    "media-src": ["'self'"],
    // The app's own API, the Supabase project when one is configured, and the dev server's reload socket.
    "connect-src": ["'self'", ...(supabase ? [supabase] : []), ...(isDev ? ["ws:", "wss:"] : [])],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

function securityHeaders(isDev: boolean): { key: string; value: string }[] {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    // For browsers that predate frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  // Browsers ignore this header over plain http, so a local `next start` is not affected.
  if (!isDev) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return headers;
}

export default function nextConfig(phase: string): NextConfig {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    cacheComponents: true,
    partialPrefetching: true,
    poweredByHeader: false,
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders(isDev) }];
    },
  };
}
