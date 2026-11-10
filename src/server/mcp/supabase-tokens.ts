import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { COUNTIES } from "@/lib/domain";
import type { SessionUser } from "@/lib/domain";
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "../config";
import { createSupabaseGateway } from "../supabase/gateway";
import type { Gateway, Page } from "../supabase/gateway";
import { supabaseFetch } from "../supabase/server";

// Supabase mode: MCP tokens.
//
// A program that calls /api/mcp presents a token, not a sign-in session, so the app cannot act as the
// token's holder through row level security the way it does for a person in a browser. This is the one
// place the service role key is used, and it is used for three database functions only (see the last
// section of supabase/migrations/20261110120200_access_rules.sql):
//   mcp_token_user(hash)     who the token belongs to
//   mcp_flags(hash)          the flags that person may read, without notes or reasons
//   mcp_change_events(hash)  the change events
// Each function checks the token itself and applies the holder's scope in SQL. The service role client
// never leaves this file, and nothing here reads or writes a table.

const HASH = /^[0-9a-f]{64}$/;

const TokenUserRow = z
  .object({ token_hash: z.string(), user_id: z.string(), email: z.string().nullable() })
  .and(
    z.union([
      z.object({ role: z.literal("clerk"), county: z.enum(COUNTIES) }),
      z.object({ role: z.enum(["leader", "admin"]), county: z.null() }),
    ]),
  );

/** What a token holder can read: one page of their flags, or of the change events. */
export interface McpReader {
  flags(range: readonly [number, number], count: boolean): Promise<Page>;
  events(range: readonly [number, number], count: boolean): Promise<Page>;
}

let serviceGateway: Gateway | null | undefined;

/**
 * The gateway that calls the three MCP functions, or null when no service role key is configured (the
 * MCP endpoint then accepts no token in Supabase mode). This file is the only one that uses the key.
 */
function mcpGateway(): Gateway | null {
  if (serviceGateway === undefined) {
    serviceGateway =
      SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
        ? createSupabaseGateway(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
              global: { fetch: supabaseFetch },
              auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            }))
        : null;
  }
  return serviceGateway;
}

// The user objects this module handed out, and the token hash each one came from. The repository asks
// for it (mcpReaderFor) to read on behalf of a token holder. Any other user object is not in here.
const tokenOf = new WeakMap<SessionUser, string>();

/**
 * The person a token row describes, or null. Exported for the database tests, which run the same
 * function against a real Postgres.
 */
export function tokenUserFromRows(rows: readonly unknown[], hash: string): SessionUser | null {
  const row = TokenUserRow.safeParse(rows[0]);
  if (!row.success) return null;
  // The database matched the hash already. Comparing again here, in constant time, means a wrong row
  // can never be accepted, whatever the lookup returned.
  const stored = Buffer.from(row.data.token_hash, "utf8");
  const presented = Buffer.from(hash, "utf8");
  if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return null;
  return { id: row.data.user_id, email: row.data.email ?? "", role: row.data.role, county: row.data.county };
}

/**
 * Supabase mode: the user an MCP token belongs to, found by the SHA-256 hash of the token (64 hex
 * characters, as `hashMcpToken` returns it). Returns null for an unknown or revoked token, for a token
 * whose holder no longer has a profile, and when no service role key is configured.
 */
export async function lookupMcpTokenSupabase(hash: string): Promise<SessionUser | null> {
  const gateway = mcpGateway();
  if (!gateway || !HASH.test(hash)) return null;
  const page = await gateway.call("mcp_token_user", { p_token_hash: hash });
  const user = tokenUserFromRows(page.rows, hash);
  if (user) tokenOf.set(user, hash);
  return user;
}

/** Builds a reader over a gateway that may call the MCP functions. Exported for the database tests. */
export function createMcpReader(gateway: Gateway, hash: string): McpReader {
  const order = [{ column: "seq", ascending: true }];
  return {
    flags: (range, count) => gateway.call("mcp_flags", { p_token_hash: hash }, { order, range, count }),
    events: (range, count) => gateway.call("mcp_change_events", { p_token_hash: hash }, { order, range, count }),
  };
}

/**
 * The reader for a user object that lookupMcpTokenSupabase returned, or null for any other user. The
 * token is checked again by the database on every read, so a token revoked a moment ago reads nothing.
 */
export function mcpReaderFor(user: SessionUser): McpReader | null {
  const hash = tokenOf.get(user);
  const gateway = mcpGateway();
  return hash && gateway ? createMcpReader(gateway, hash) : null;
}
