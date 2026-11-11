import "server-only";
import type { AuditEntry, ChangeEvent, FlagRecord, LeanFlag } from "@/lib/domain";
import type { Folder } from "@/lib/panels";
import type { ChangeEventInput, FolderInput, ImportRow, NewFlagInput } from "@/lib/schemas";

/**
 * Data access for one signed-in user. Every method applies the access rules for that user (see "Access
 * rules" in specs/001-filing-problem-tracker/data-model.md) and throws HttpError 403 or 404 when the
 * rules say no.
 * There are two implementations, memory and Supabase, with the same behavior.
 */
export interface Repository {
  /** Flags visible to this session, without notes or raw reasons. Deleted flags are left out. */
  listFlags(): Promise<LeanFlag[]>;
  /** The caller's own entries, newest first, with notes. */
  listMyRecent(limit: number): Promise<FlagRecord[]>;
  /** Imported rows marked Needs review, in scope, with the raw reason. Clerks and admins only. */
  listNeedsReview(): Promise<FlagRecord[]>;
  /** A clerk can create only for their own county; a county from the request that differs is refused with 403. */
  createFlag(input: NewFlagInput): Promise<FlagRecord>;
  /** Saves reviewed import rows as one batch, all or nothing. Same county rule as createFlag. */
  createFlags(rows: ImportRow[], batchName: string): Promise<{ batchId: string; inserted: number }>;
  /** Own entry, within 5 minutes of creating it; an admin any entry at any time. */
  softDeleteFlag(id: string): Promise<void>;
  /** Undoes a soft delete. Own entry, within 5 minutes of deleting it; an admin at any time. */
  restoreFlag(id: string): Promise<void>;
  listEvents(): Promise<ChangeEvent[]>;
  /** Admin only. With an id it replaces that event (404 when it does not exist). */
  upsertEvent(input: ChangeEventInput): Promise<ChangeEvent>;
  /** Admin only. */
  deleteEvent(id: string): Promise<void>;
  /** The caller's own folders. */
  listFolders(): Promise<Folder[]>;
  /** With an id it replaces the caller's folder with that id (404 when the caller has none). */
  saveFolder(input: FolderInput): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  /** The entry's userId must be the caller's own. */
  appendAudit(entry: AuditEntry): Promise<void>;
  /** Admin only. Newest first. */
  listAudit(limit: number): Promise<AuditEntry[]>;
}
