# Data Model: Filing Problem Tracker

## Entities

Reference lists (counties, case types and their forms, problems, outcomes) are fixed in `src/lib/domain.ts` and repeated as SQL functions in the first migration. A test fails when the two differ.

| Entity | Table | Fields |
|---|---|---|
| User | `profiles` | `user_id` (the Supabase Auth account), `role` (clerk, leader or admin), `county` (clerks only) |
| Filing flag | `filing_flags` | `id`, `county`, `filed_on`, `case_type`, `form`, `tags[]`, `outcome`, `note`, `reason`, `source` (sample, clerk or import), `batch_id`, `created_by`, `created_at`, `deleted_at`, `deleted_by` |
| Import batch | `import_batches` | `id`, `name`, `row_count`, `created_by`, `created_at` |
| Change event | `change_events` | `id`, `name`, `event_date`, `county`, `case_type`, `tag`, `description` |
| Folder | `workspace_folders` | `owner`, `id`, `name`, `panels` (JSON array of panel specifications) |
| Example folders given | `workspace_seeds` | `owner`. Records who already received the example folders, so a deleted one does not come back. |
| Audit entry | `audit_log` | `at`, `user_id`, `role`, `action`, `entity`, `entity_id`, `detail` (counts and reference values, never free text) |
| MCP token | `mcp_tokens` | `token_hash` (SHA-256, never the token), `user_id`, `label`, `revoked_at` |

A panel is not stored by itself. It is a typed specification (`kpi`, `ranked`, `heat`, `forms`, `trend`, `before_after`, `compare_counties` or `needs_review`, with a title, a size and filters) saved inside a folder; `computePanel` in `src/lib/panels.ts` turns it into numbers from current records.

## Validation rules

- Every request body is parsed with a strict Zod schema in `src/lib/schemas.ts`: unknown fields are refused and listed values must be on the reference lists. Check constraints in the database repeat the rules.
- A filing date is a real day, not in the future and not before 2020-01-01.
- A flag has one to nine problems. Only an imported row may carry "Needs review".
- A note is one line of up to 200 characters; an imported reason up to 500. Both must pass the personal-data check in `src/lib/pii.ts` before they are saved.
- An imported row belongs to a batch, has the outcome "Rejected" and carries a reason, never a note.
- A folder holds up to 24 panels, and a person keeps up to 50 folders.

## State transitions

- Removing a flag sets `deleted_at` and `deleted_by` (stamped by the database) and leaves the row in place. Removed flags are left out of every count.
- A clerk may remove their own entry within 5 minutes of adding it, and restore it within 5 minutes of removing it themselves. An admin may do either at any time.
- A token is revoked by setting `revoked_at`.

## Access rules

The same rules are implemented twice on purpose: as row level security policies in `supabase/migrations/20261110120200_access_rules.sql`, and in code in `src/server/repo/memory.ts` for demo mode. `tests/rls/access.test.ts` and `tests/unit/memory-repo.test.ts` check each cell.

| | clerk | leader | admin |
|---|---|---|---|
| Read flags | own county | all counties | all |
| Read notes / raw reasons | own entries; own county's needs-review rows | no | own entries; every county's needs-review rows |
| Create flag / import | own county only | no | any county |
| Delete own flag | within 5 minutes | no | any flag, any time |
| Change events | read | read | read + write |
| Folders | own | own | own |
| Audit log | no | no | read |

A clerk's county comes from their profile, never from the request body. A request that names another county is refused with 403, not silently rewritten.

## Database

- Three migrations in `supabase/migrations`: reference lists, tables with constraints, access rules.
- Row level security is enabled and forced on every table. A signed-in person with no `profiles` row matches no policy.
- The signed-in database role has no read privilege on `note` or `reason`. The view `flags_lean` (`security_invoker`) is what dashboards read; the functions `my_recent_flags()` and `needs_review_flags()` are the only way to the free text and apply the rule themselves.
- `mcp_tokens` is closed to every API role. Three `security definer` functions take a token hash and return what that token's holder may see, without free text.
- Indexes on `(county, filed_on)`, `(filed_on)`, `(created_by, created_at)`, and a GIN index on `tags`.
- `supabase/seed.sql` is generated from `src/lib/sample.ts` by `npm run seed:gen`, and a test fails when the two differ.
- The demo store holds at most 50,000 flags and 500 import batches; past that, adding is refused until the demo data is reset.
