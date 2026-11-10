import "server-only";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { COUNTIES } from "@/lib/domain";
import type { SessionUser } from "@/lib/domain";
import { HttpError } from "../http";
import { createSupabaseGateway } from "../supabase/gateway";
import type { Gateway } from "../supabase/gateway";
import { AUTH_UNAVAILABLE_MESSAGE, createSupabaseServerClient } from "../supabase/server";

// Supabase sign-in. A person is signed in when two things hold: Supabase Auth vouches for their token,
// and an administrator has given them a profile (role, and county for a clerk). Accounts are invite
// only. Nothing creates a profile automatically, and without one a person has no access anywhere.

// The same shape the database enforces: a clerk has a county, nobody else does.
const ProfileRow = z.union([
  z.object({ role: z.literal("clerk"), county: z.enum(COUNTIES) }),
  z.object({ role: z.enum(["leader", "admin"]), county: z.null() }),
]);

/**
 * The session user for a verified identity, or null when they have no profile. The profile is read as
 * the person themselves; row level security lets everyone read their own profile row and nothing more.
 */
export async function loadSessionUser(gateway: Gateway, identity: { id: string; email: string }): Promise<SessionUser | null> {
  const page = await gateway.select("profiles", ["role", "county"], { eq: { user_id: identity.id } });
  const profile = ProfileRow.safeParse(page.rows[0]);
  if (!profile.success) return null;
  return { id: identity.id, email: identity.email, role: profile.data.role, county: profile.data.county };
}

/**
 * The signed-in person behind this client, or null. getClaims() verifies the token's signature (with
 * the project's public keys, or by asking the Auth server when the project signs with a shared
 * secret), so the user id is never taken from an unverified cookie.
 *
 * Null means Supabase said this is nobody. When Supabase could not be asked (unreachable, timed out, a
 * server error) this throws HttpError 503 instead: "could not check" is not "signed out", and answering
 * 401 would send a person with a good session to the sign-in page.
 */
export async function sessionUserOf(client: SupabaseClient): Promise<SessionUser | null> {
  const { data, error } = await client.auth.getClaims();
  if (error && isAuthRetryableFetchError(error)) throw new HttpError(503, AUTH_UNAVAILABLE_MESSAGE, { headers: { "Retry-After": "5" } });
  if (error || !data) return null;
  const { sub, email } = data.claims;
  if (!sub) return null;
  return loadSessionUser(createSupabaseGateway(client), { id: sub, email: email ?? "" });
}

/** The signed-in person for this request, or null. Only reached in Supabase mode. */
export async function getSupabaseSession(): Promise<SessionUser | null> {
  return sessionUserOf(await createSupabaseServerClient());
}
