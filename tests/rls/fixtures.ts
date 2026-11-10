// The people and rows the access tests work with. Everything is made up.

import type { Actor, TestDatabase } from "./harness";

export const IDS = {
  clerkA: "00000000-0000-4000-8000-00000000000a",
  clerkB: "00000000-0000-4000-8000-00000000000b",
  leader: "00000000-0000-4000-8000-00000000000c",
  admin: "00000000-0000-4000-8000-00000000000d",
  /** Signed in, but nobody has given them a profile. */
  stranger: "00000000-0000-4000-8000-00000000000e",
  batchA: "00000000-0000-4000-8000-0000000000a1",
  batchB: "00000000-0000-4000-8000-0000000000b1",
} as const;

const signedIn = (userId: string): Actor => ({ role: "authenticated", userId });

/** Clerk A works in Marion County, clerk B in Lake County. */
export const CLERK_A = signedIn(IDS.clerkA);
export const CLERK_B = signedIn(IDS.clerkB);
export const LEADER = signedIn(IDS.leader);
export const ADMIN = signedIn(IDS.admin);
export const STRANGER = signedIn(IDS.stranger);
export const ANON: Actor = { role: "anon", userId: null };
export const SERVICE: Actor = { role: "service_role", userId: null };

export const SIGNED_IN: readonly (readonly [string, Actor])[] = [
  ["clerk A", CLERK_A],
  ["clerk B", CLERK_B],
  ["leader", LEADER],
  ["admin", ADMIN],
  ["signed-in user with no profile", STRANGER],
];

export const EVERYONE: readonly (readonly [string, Actor])[] = [...SIGNED_IN, ["anon", ANON]];

/** Stand-ins for SHA-256 hashes: 64 hex characters. The leader's token, clerk A's token, and a revoked one of the admin's. */
export const TOKEN_HASH = "a".repeat(64);
export const CLERK_TOKEN_HASH = "f".repeat(64);
export const REVOKED_TOKEN_HASH = "b".repeat(64);

// Flags, by id:
//   a-fresh        Marion, clerk A, added 1 minute ago, with a note
//   a-old          Marion, clerk A, added 10 minutes ago, with a note
//   a-sample       Marion, sample row, no author
//   a-review       Marion, imported by clerk A, Needs review, with a raw reason
//   a-sorted       Marion, imported by clerk A, sorted, with a raw reason
//   a-gone-fresh   Marion, clerk A, removed 1 minute ago
//   a-gone-old     Marion, clerk A, removed 10 minutes ago
//   a-by-admin     Marion, added by the admin 1 minute ago, with a note
//   b-fresh        Lake, clerk B, added 1 minute ago, with a note
//   b-review       Lake, imported by clerk B, Needs review, with a raw reason
export const MARION_CURRENT = ["a-by-admin", "a-fresh", "a-old", "a-review", "a-sample", "a-sorted"];
export const MARION_REMOVED = ["a-gone-fresh", "a-gone-old"];
export const LAKE_CURRENT = ["b-fresh", "b-review"];

const FIXTURES = `
insert into auth.users (id, email) values
  ('${IDS.clerkA}', 'clerk-a@example.invalid'),
  ('${IDS.clerkB}', 'clerk-b@example.invalid'),
  ('${IDS.leader}', 'leader@example.invalid'),
  ('${IDS.admin}', 'admin@example.invalid'),
  ('${IDS.stranger}', 'stranger@example.invalid');

insert into public.profiles (user_id, role, county) values
  ('${IDS.clerkA}', 'clerk', 'Marion'),
  ('${IDS.clerkB}', 'clerk', 'Lake'),
  ('${IDS.leader}', 'leader', null),
  ('${IDS.admin}', 'admin', null);

insert into public.import_batches (id, name, row_count, created_by) values
  ('${IDS.batchA}', 'Marion export', 2, '${IDS.clerkA}'),
  ('${IDS.batchB}', 'Lake export', 1, '${IDS.clerkB}');

insert into public.filing_flags
  (id, county, filed_on, case_type, form, tags, outcome, note, reason, source, batch_id, created_by, created_at, deleted_at, deleted_by)
values
  ('a-fresh', 'Marion', '2024-03-05', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Returned to fix',
   'note on a-fresh', null, 'clerk', null, '${IDS.clerkA}', now() - interval '1 minute', null, null),
  ('a-old', 'Marion', '2024-03-06', 'Eviction', 'Tenant answer or request for hearing', array['Wrong form', 'Missing signature'], 'Rejected',
   'note on a-old', null, 'clerk', null, '${IDS.clerkA}', now() - interval '10 minutes', null, null),
  ('a-sample', 'Marion', '2024-03-07', 'Name change', 'Petition for change of name', array['Missing fee or fee waiver'], 'Fixed at counter',
   null, null, 'sample', null, null, now() - interval '30 days', null, null),
  ('a-review', 'Marion', '2024-03-08', 'Small claims', 'Small claims counterclaim', array['Needs review'], 'Rejected',
   null, 'reason on a-review', 'import', '${IDS.batchA}', '${IDS.clerkA}', now() - interval '2 hours', null, null),
  ('a-sorted', 'Marion', '2024-03-08', 'Small claims', 'Small claims counterclaim', array['Missing signature'], 'Rejected',
   null, 'reason on a-sorted', 'import', '${IDS.batchA}', '${IDS.clerkA}', now() - interval '2 hours', null, null),
  ('a-gone-fresh', 'Marion', '2024-03-09', 'Small claims', 'Small claims notice of claim', array['Wrong form'], 'Rejected',
   'note on a-gone-fresh', null, 'clerk', null, '${IDS.clerkA}', now() - interval '3 minutes', now() - interval '1 minute', '${IDS.clerkA}'),
  ('a-gone-old', 'Marion', '2024-03-09', 'Small claims', 'Small claims notice of claim', array['Wrong form'], 'Rejected',
   null, null, 'clerk', null, '${IDS.clerkA}', now() - interval '12 minutes', now() - interval '10 minutes', '${IDS.clerkA}'),
  ('a-by-admin', 'Marion', '2024-03-10', 'Family', 'Petition to modify child support', array['Not verified or notarized'], 'Rejected',
   'note on a-by-admin', null, 'clerk', null, '${IDS.admin}', now() - interval '1 minute', null, null),
  ('b-fresh', 'Lake', '2024-03-05', 'Protective order', 'Petition for order of protection', array['Missing required details'], 'Returned to fix',
   'note on b-fresh', null, 'clerk', null, '${IDS.clerkB}', now() - interval '1 minute', null, null),
  ('b-review', 'Lake', '2024-03-06', 'Family', 'Petition for dissolution, no children', array['Needs review'], 'Rejected',
   null, 'reason on b-review', 'import', '${IDS.batchB}', '${IDS.clerkB}', now() - interval '2 hours', null, null);

insert into public.change_events (id, name, event_date, county, case_type, tag, description) values
  ('event-1', 'Revised form', '2024-02-01', 'Marion', 'Small claims', 'Missing signature', 'A made-up change.');

insert into public.workspace_folders (owner, id, name, panels) values
  ('${IDS.clerkA}', 'folder-a', 'Clerk A folder', '[]'),
  ('${IDS.leader}', 'folder-l', 'Leader folder', '[]'),
  ('${IDS.admin}', 'folder-d', 'Admin folder', '[]');

insert into public.audit_log (user_id, role, action, entity, entity_id, detail) values
  ('${IDS.clerkA}', 'clerk', 'flag.create', 'flag', 'a-fresh', '{"tags": 1}'),
  ('${IDS.admin}', 'admin', 'event.save', 'event', 'event-1', '{}');

insert into public.mcp_tokens (token_hash, user_id, label, revoked_at) values
  ('${TOKEN_HASH}', '${IDS.leader}', 'leader laptop', null),
  ('${CLERK_TOKEN_HASH}', '${IDS.clerkA}', 'clerk desk', null),
  ('${REVOKED_TOKEN_HASH}', '${IDS.admin}', 'old token', now());
`;

/** Loads the fixtures as the superuser. */
export async function loadFixtures(db: TestDatabase): Promise<void> {
  await db.adminScript(FIXTURES);
}

/** The ids in a result, sorted. */
export function ids(rows: Record<string, unknown>[]): string[] {
  return rows.map((row) => String(row.id)).sort();
}
