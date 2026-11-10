import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "@/lib/domain";
import { demoUserById } from "@/lib/sample";
import type { DemoUserId } from "@/lib/sample";
import { APP_MODE, MCP_TOKEN } from "../config";

// Bearer tokens for the MCP endpoint.
//
// Demo mode has one token, set in MCP_TOKEN. With no token set the endpoint is switched off. The token
// acts as the demo court leader: every county, counts only, no notes.
// Supabase mode has a token per user. Only its SHA-256 hash is stored, and the tools run with that
// user's own scope.

/** The demo account the demo token acts as. A leader reads every county and never sees notes or reasons. */
const MCP_DEMO_USER: DemoUserId = "demo-leader";
/** Longer than any token the app issues. Anything beyond it is refused unread. */
const TOKEN_MAX = 512;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

/** The hex SHA-256 of a token: what the `mcp_tokens` table stores in place of the token itself. */
export function hashMcpToken(token: string): string {
  return sha256(token).toString("hex");
}

/** False when the endpoint is switched off: demo mode with no MCP_TOKEN. */
export function mcpEnabled(): boolean {
  return APP_MODE !== "demo" || MCP_TOKEN !== null;
}

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  return match && match[1].length <= TOKEN_MAX ? match[1] : null;
}

/** The user a token acts as, or null when the token is not valid. */
export async function resolveMcpToken(token: string): Promise<SessionUser | null> {
  if (APP_MODE === "demo") {
    if (MCP_TOKEN === null) return null;
    // Both sides are hashed first: the digests have the same length, and comparing them takes the same
    // time whatever was sent, so the reply time says nothing about the token or its length.
    return timingSafeEqual(sha256(token), sha256(MCP_TOKEN)) ? demoUserById(MCP_DEMO_USER) : null;
  }
  const { lookupMcpTokenSupabase } = await import("./supabase-tokens");
  return lookupMcpTokenSupabase(hashMcpToken(token));
}
