# Data model and access rules

## Access rules

The same rules are implemented twice on purpose: as SQL row level security policies for production, and in code in the in-memory repository for demo mode and tests.

| | clerk | leader | admin |
|---|---|---|---|
| Read flags | own county | all counties | all |
| Read notes / raw reasons | own entries; own county's needs-review rows | no | all |
| Create flag / import | own county only | no | any county |
| Delete own flag | within 5 minutes | no | any time |
| Change events | read | read | read + write |
| Folders | own | own | own |
| Audit log | no | no | read |

A clerk's county comes from their profile, never from the request body. A request that names another county is rejected with 403, not silently rewritten.

## Database

Migrations live in `supabase/migrations`.

Tables: `profiles(user_id pk -> auth.users, role, county)`, `filing_flags(id, county, filed_on, case_type, form, tags text[], outcome, note, reason, source, batch_id, created_by, created_at, deleted_at)`, `import_batches`, `change_events`, `workspace_folders(owner, name, panels jsonb)`, `audit_log`, `mcp_tokens(token_hash, user_id, revoked_at)`.

- Check constraints mirror the Zod schemas (tag and county values, note length, date range).
- Row level security is enabled and forced on every table; policies implement the access table above. Helper functions `app_role()` and `app_county()` are `security definer` with a fixed `search_path`.
- Leaders must not read `note` / `reason`. They read through the view `flags_lean` (`security_invoker`), and column privileges on the base table exclude those columns for the leader path.
- Indexes on `(county, filed_on)`, `(filed_on)`, and a GIN index on `tags`.
- `supabase/seed.sql` is generated from `sample.ts` by `scripts/gen-seed.ts`, so SQL and demo data cannot drift.

## Repository interface

Pages and route handlers only ever talk to this interface. See decision 2 in [research.md](research.md).

```ts
interface Repository {
  listFlags(): Promise<LeanFlag[]>                    // visible to this session; never includes note/reason
  listMyRecent(limit: number): Promise<FlagRecord[]>  // the caller's own entries, with notes
  listNeedsReview(): Promise<FlagRecord[]>            // imported rows tagged NEEDS_REVIEW, in scope
  createFlag(input: NewFlagInput): Promise<FlagRecord>
  createFlags(rows: ImportRow[], batchName: string): Promise<{ batchId: string; inserted: number }>
  softDeleteFlag(id: string): Promise<void>           // own entry, within 5 minutes; admin any time
  restoreFlag(id: string): Promise<void>
  listEvents(): Promise<ChangeEvent[]>
  upsertEvent(input: ChangeEventInput): Promise<ChangeEvent>   // admin only
  deleteEvent(id: string): Promise<void>                       // admin only
  listFolders(): Promise<Folder[]>                    // the caller's own
  saveFolder(input: FolderInput): Promise<Folder>
  deleteFolder(id: string): Promise<void>
  appendAudit(entry: AuditEntry): Promise<void>
  listAudit(limit: number): Promise<AuditEntry[]>     // admin only
}
```
