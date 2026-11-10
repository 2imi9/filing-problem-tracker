import "server-only";
import { z } from "zod";
import { MAX_CSV_ROWS } from "@/lib/csv";
import { CASE_TYPES, COUNTIES, FORMS, NEEDS_REVIEW, OUTCOMES, TAGS } from "@/lib/domain";
import type { AuditAction, AuditEntity, AuditEntry, CaseType, ChangeEvent, County, FlagRecord, Form, LeanFlag, SessionUser } from "@/lib/domain";
import { CURRENT_FOLDER_NAME, PanelSpec, exampleFoldersFor } from "@/lib/panels";
import type { Folder } from "@/lib/panels";
import { describePersonalData, findPersonalData } from "@/lib/pii";
import { FolderInput, parseChangeEventInput, parseImportRow, parseNewFlagInput } from "@/lib/schemas";
import { appToday } from "../clock";
import { LIMITS } from "../config";
import { HttpError } from "../http";
import { mcpReaderFor } from "../mcp/supabase-tokens";
import type { McpReader } from "../mcp/supabase-tokens";
import { DbError, createSupabaseGateway } from "../supabase/gateway";
import type { Gateway, Page } from "../supabase/gateway";
import { createSupabaseServerClient } from "../supabase/server";
import type { Repository } from "./types";

// The production repository. Every statement runs as the signed-in person (their own token, never the
// service role key), so the row level security policies in supabase/migrations decide what happens.
// The checks in this file come first only so that a refusal carries the same plain message as in demo
// mode; if one of them were missing, the database would still refuse.

// ---------- Rows as the database returns them ----------

/** A timestamp from the database, normalized to the ISO form the rest of the app uses. */
const Timestamp = z.string().transform((value, ctx) => {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    ctx.addIssue({ code: "custom", message: "Not a timestamp." });
    return z.NEVER;
  }
  return new Date(time).toISOString();
});

const LEAN_COLUMNS = ["id", "county", "filed_on", "case_type", "form", "tags", "outcome", "source", "batch_id", "created_by", "created_at"] as const;

const LeanRow = z.object({
  id: z.string(),
  county: z.enum(COUNTIES),
  filed_on: z.string(),
  case_type: z.enum(CASE_TYPES as [CaseType, ...CaseType[]]),
  form: z.enum(FORMS as [Form, ...Form[]]),
  tags: z.array(z.enum([...TAGS, NEEDS_REVIEW])),
  outcome: z.enum(OUTCOMES),
  source: z.enum(["sample", "clerk", "import"]),
  batch_id: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: Timestamp,
});
type LeanRow = z.output<typeof LeanRow>;

const FullRow = LeanRow.extend({ note: z.string().nullable(), reason: z.string().nullable() });
type FullRow = z.output<typeof FullRow>;

const FlagStateRow = z.object({ id: z.string(), created_by: z.string().nullable(), created_at: Timestamp, deleted_at: Timestamp.nullable() });

const EVENT_COLUMNS = ["id", "name", "event_date", "county", "case_type", "tag", "description"] as const;

const EventRow = z.object({
  id: z.string(),
  name: z.string(),
  event_date: z.string(),
  county: z.enum(COUNTIES),
  case_type: z.enum(CASE_TYPES as [CaseType, ...CaseType[]]),
  tag: z.enum(TAGS),
  description: z.string(),
});

const FOLDER_COLUMNS = ["id", "name", "panels"] as const;

const FolderRow = z.object({ id: z.string(), name: z.string(), panels: z.array(z.unknown()) });

const AUDIT_COLUMNS = ["id", "at", "user_id", "role", "action", "entity", "entity_id", "detail"] as const;

const AuditRow = z.object({
  id: z.string(),
  at: Timestamp,
  user_id: z.string(),
  role: z.enum(["clerk", "leader", "admin"]),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

const ImportResultRow = z.object({ batch: z.string(), inserted: z.number().int() });
const SeededRow = z.object({ seeded: z.boolean() });

function toLeanFlag(row: LeanRow): LeanFlag {
  return {
    id: row.id,
    date: row.filed_on,
    county: row.county,
    caseType: row.case_type,
    form: row.form,
    tags: row.tags,
    outcome: row.outcome,
    source: row.source,
    batchId: row.batch_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toFlagRecord(row: FullRow): FlagRecord {
  return { ...toLeanFlag(row), note: row.note, reason: row.reason };
}

/**
 * Parses rows that were read. A row that does not fit the app's lists (possible only if the database
 * and the app have drifted apart) is left out and reported in the server log, so one bad row cannot
 * take the whole dashboard down. The log line has the count, never the row.
 */
function readRows<S extends z.ZodType>(schema: S, rows: readonly unknown[], source: string): z.output<S>[] {
  const out: z.output<S>[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  if (out.length < rows.length) {
    console.error(JSON.stringify({ level: "error", event: "db_rows_skipped", source, skipped: rows.length - out.length }));
  }
  return out;
}

/** Parses the row a write returned. Unlike a read, a write that returns something unreadable is a failure. */
function writtenRow<S extends z.ZodType>(schema: S, rows: readonly unknown[], source: string): z.output<S> {
  const parsed = schema.safeParse(rows[0]);
  if (!parsed.success) throw new Error(`The database returned an unreadable row from ${source}.`);
  return parsed.data;
}

// ---------- Errors ----------

const forbidden = (message: string) => new HttpError(403, message);
const notFound = (what: string) => new HttpError(404, `${what} was not found.`);

/**
 * Turns a database refusal into the HTTP error the caller should see. The database's own message is
 * never passed on: it can name tables, columns and policies.
 */
export function toHttpError(error: DbError): Error {
  const { code } = error;
  // insufficient_privilege: a row level security policy or a missing privilege said no.
  if (code === "42501") return forbidden("You do not have access to do this.");
  // PostgREST could not accept the token (expired, or not signed in any more).
  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303") return new HttpError(401, "Sign in to continue.");
  if (code === "23505") return new HttpError(409, "That already exists.");
  // Class 23 is a constraint (check, not null, foreign key); class 22 is a value of the wrong shape.
  if (code.startsWith("23") || code.startsWith("22")) return new HttpError(400, "A value in this request is not allowed, so nothing was saved.");
  // Anything else is a fault, not a refusal: handle() answers 500 and logs it.
  return new Error(`Database error ${code || "(no code)"}: ${error.message}`);
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof DbError ? toHttpError(error) : error;
  }
}

const PAGE_SIZE = 1000;
const BY_SEQ = [{ column: "seq", ascending: true }] as const;

/**
 * Reads every matching row, however few the server returns per request. The first request also asks
 * how many rows there are, which is how the last page is recognized without one more empty request.
 */
async function readAll(page: (range: readonly [number, number], count: boolean) => Promise<Page>, limit = Number.POSITIVE_INFINITY): Promise<unknown[]> {
  const rows: unknown[] = [];
  let total: number | null = null;
  while (rows.length < limit) {
    const last = Math.min(rows.length + PAGE_SIZE, limit) - 1;
    const next = await page([rows.length, last], total === null);
    total ??= next.total;
    rows.push(...next.rows);
    if (next.rows.length === 0 || (total !== null && rows.length >= total)) break;
  }
  return rows;
}

export interface GatewayRepositoryOptions {
  /** The app's today, YYYY-MM-DD. Defaults to the server's. */
  today?: () => string;
  /** The clock for the delete window's message. The database's own clock is what enforces the window. */
  now?: () => Date;
}

/** The repository over any gateway. Production passes the Supabase one; the tests pass one over a real Postgres. */
export function createGatewayRepository(session: SessionUser, gateway: Gateway, options: GatewayRepositoryOptions = {}): Repository {
  const today = options.today ?? appToday;
  const now = options.now ?? (() => new Date());
  const isAdmin = session.role === "admin";

  /** The county a clerk works in. A clerk without one cannot read or write anything. */
  function clerkCounty(): County {
    if (!session.county) throw forbidden("Your account has no county assigned.");
    return session.county;
  }

  /** Create and import: clerks for their own county, admins for any, leaders never. */
  function assertCanWrite(counties: readonly County[]): void {
    if (session.role === "leader") throw forbidden("Court leaders can view the tracker but cannot add filings.");
    if (session.role === "clerk") {
      const own = clerkCounty();
      const other = counties.find((county) => county !== own);
      if (other) throw forbidden(`You can add filings for ${own} County only. This request names ${other} County.`);
    }
  }

  function assertAdmin(): void {
    if (!isAdmin) throw forbidden("Only an administrator can do this.");
  }

  function assertNoPersonalData(text: string | null | undefined): void {
    if (!text) return;
    const findings = findPersonalData(text);
    if (findings.length > 0) {
      throw new HttpError(422, describePersonalData(findings), { code: "personal_data", details: { findings } });
    }
  }

  function withinWindow(sinceIso: string): boolean {
    return now().getTime() - new Date(sinceIso).getTime() <= LIMITS.softDeleteWindowMs;
  }

  /**
   * The entry to remove or restore, as far as this person can see it. Row level security hides other
   * counties' entries from a clerk, and other people's removed entries from everyone but an admin, so
   * those read as not found.
   */
  async function flagState(id: string) {
    const page = await gateway.select("filing_flags", ["id", "created_by", "created_at", "deleted_at"], { eq: { id } });
    const [flag] = readRows(FlagStateRow, page.rows, "filing_flags");
    if (!flag) throw notFound("That entry");
    if (!isAdmin && (session.role !== "clerk" || flag.created_by !== session.id)) {
      throw forbidden("You can only remove or restore entries you added yourself.");
    }
    return flag;
  }

  function toFolder(row: z.output<typeof FolderRow>): Folder {
    // A saved panel that no longer fits the panel contract is dropped, not shown broken.
    return { id: row.id, name: row.name, panels: readRows(PanelSpec, row.panels, "workspace_folders.panels") };
  }

  /** The caller's folders. The first time, the example folders are added (once, even under two requests at the same moment). */
  async function myFolders(): Promise<Folder[]> {
    const read = () => readAll((range, count) => gateway.select("workspace_folders", FOLDER_COLUMNS, { eq: { owner: session.id }, order: BY_SEQ, range, count }));
    let rows = await read();
    if (rows.length === 0) {
      const page = await gateway.call("seed_example_folders", { p_folders: exampleFoldersFor(session) });
      if (writtenRow(SeededRow, page.rows, "seed_example_folders").seeded) rows = await read();
    }
    return readRows(FolderRow, rows, "workspace_folders").map(toFolder);
  }

  return {
    listFlags: () =>
      guarded(async () => {
        const rows = await readAll((range, count) => gateway.select("flags_lean", LEAN_COLUMNS, { order: BY_SEQ, range, count }));
        return readRows(LeanRow, rows, "flags_lean").map(toLeanFlag);
      }),

    listMyRecent: (limit) =>
      guarded(async () => {
        if (limit <= 0) return [];
        const page = await gateway.call("my_recent_flags", { p_limit: Math.floor(limit) });
        return readRows(FullRow, page.rows, "my_recent_flags").map(toFlagRecord);
      }),

    listNeedsReview: () =>
      guarded(async () => {
        if (session.role === "leader") throw forbidden("Court leaders cannot read the raw rejection reasons.");
        const rows = await readAll((range, count) => gateway.call("needs_review_flags", {}, { order: BY_SEQ, range, count }));
        return readRows(FullRow, rows, "needs_review_flags").map(toFlagRecord);
      }),

    createFlag: (input) =>
      guarded(async () => {
        const data = parseNewFlagInput(input, today());
        assertCanWrite([data.county]);
        assertNoPersonalData(data.note);
        const rows = await gateway.insert(
          "filing_flags",
          {
            county: data.county,
            filed_on: data.date,
            case_type: data.caseType,
            form: data.form,
            tags: data.tags,
            outcome: data.outcome,
            note: data.note ?? null,
            source: "clerk",
            created_by: session.id,
          },
          LEAN_COLUMNS,
        );
        // The note is not read back: nobody has select access to that column. It is what was just saved.
        return { ...toLeanFlag(writtenRow(LeanRow, rows, "filing_flags")), note: data.note ?? null, reason: null };
      }),

    createFlags: (rows, batchName) =>
      guarded(async () => {
        if (rows.length === 0) throw new HttpError(400, "There are no rows to add.");
        if (rows.length > MAX_CSV_ROWS) throw new HttpError(413, `At most ${MAX_CSV_ROWS.toLocaleString("en-US")} rows can be added at once.`);
        const day = today();
        const data = rows.map((row) => parseImportRow(row, day));
        assertCanWrite(data.map((row) => row.county));
        for (const row of data) assertNoPersonalData(row.reason);
        assertNoPersonalData(batchName);
        // One function call, one transaction: the batch and all of its rows, or nothing.
        const page = await gateway.call("import_flags", { p_name: batchName, p_rows: data });
        const result = writtenRow(ImportResultRow, page.rows, "import_flags");
        return { batchId: result.batch, inserted: result.inserted };
      }),

    softDeleteFlag: (id) =>
      guarded(async () => {
        const flag = await flagState(id);
        if (flag.deleted_at !== null) return;
        const refusal = "Entries can be removed for 5 minutes after they are added. Ask an administrator to remove this one.";
        if (!isAdmin && !withinWindow(flag.created_at)) throw forbidden(refusal);
        // The database stamps the time itself and applies the window by its own clock.
        const changed = await gateway.update("filing_flags", { deleted_at: now().toISOString() }, { id }, ["id"]);
        if (changed.length === 0) throw forbidden(refusal);
      }),

    restoreFlag: (id) =>
      guarded(async () => {
        const flag = await flagState(id);
        if (flag.deleted_at === null) return;
        const refusal = "An entry can be restored for 5 minutes after it is removed. Ask an administrator to restore this one.";
        if (!isAdmin && !withinWindow(flag.deleted_at)) throw forbidden(refusal);
        const changed = await gateway.update("filing_flags", { deleted_at: null }, { id }, ["id"]);
        // Inside the window the database still refuses a clerk who did not remove the entry themselves:
        // a clerk takes back their own removal only, never an administrator's.
        if (changed.length === 0) throw forbidden("This entry was removed by someone else, or more than 5 minutes ago. Ask an administrator to restore it.");
      }),

    listEvents: () =>
      guarded(async () => {
        const rows = await readAll((range, count) => gateway.select("change_events", EVENT_COLUMNS, { order: BY_SEQ, range, count }));
        return readRows(EventRow, rows, "change_events").map(toChangeEvent);
      }),

    upsertEvent: (input) =>
      guarded(async () => {
        assertAdmin();
        const data = parseChangeEventInput(input, today());
        const values = {
          name: data.name,
          event_date: data.date,
          county: data.county,
          case_type: data.caseType,
          tag: data.tag,
          description: data.description,
        };
        if (data.id) {
          const changed = await gateway.update("change_events", values, { id: data.id }, EVENT_COLUMNS);
          if (changed.length === 0) throw notFound("That change");
          return toChangeEvent(writtenRow(EventRow, changed, "change_events"));
        }
        const added = await gateway.insert("change_events", { ...values, created_by: session.id }, EVENT_COLUMNS);
        return toChangeEvent(writtenRow(EventRow, added, "change_events"));
      }),

    deleteEvent: (id) =>
      guarded(async () => {
        assertAdmin();
        const removed = await gateway.remove("change_events", { id }, ["id"]);
        if (removed.length === 0) throw notFound("That change");
      }),

    listFolders: () => guarded(myFolders),

    saveFolder: (input) =>
      guarded(async () => {
        const data = FolderInput.parse(input);
        const folders = await myFolders();
        const values = { name: data.name, panels: data.panels };
        const reserved = data.name === CURRENT_FOLDER_NAME;
        if (data.id) {
          // Another person's folder with the same id is invisible here, so it reads as not found.
          const changed = await gateway.update("workspace_folders", values, { owner: session.id, id: data.id }, FOLDER_COLUMNS);
          if (changed.length === 0) throw notFound("That folder");
          return toFolder(writtenRow(FolderRow, changed, "workspace_folders"));
        }
        // The folder that holds the open panels is one per person (a unique index says so). Saved
        // without an id, it replaces the one already there.
        const replaceCurrent = () => gateway.update("workspace_folders", values, { owner: session.id, name: CURRENT_FOLDER_NAME }, FOLDER_COLUMNS);
        if (reserved) {
          const changed = await replaceCurrent();
          if (changed.length > 0) return toFolder(writtenRow(FolderRow, changed, "workspace_folders"));
        }
        if (folders.length >= LIMITS.foldersPerUser) {
          throw new HttpError(409, `You can keep up to ${LIMITS.foldersPerUser} folders. Delete one to save another.`);
        }
        try {
          const added = await gateway.insert("workspace_folders", { owner: session.id, ...values }, FOLDER_COLUMNS);
          return toFolder(writtenRow(FolderRow, added, "workspace_folders"));
        } catch (error) {
          // Another tab added the reserved folder between the two statements above. Replace that one.
          if (!(reserved && error instanceof DbError && error.code === "23505")) throw error;
          const changed = await replaceCurrent();
          if (changed.length === 0) throw error;
          return toFolder(writtenRow(FolderRow, changed, "workspace_folders"));
        }
      }),

    deleteFolder: (id) =>
      guarded(async () => {
        await myFolders();
        const removed = await gateway.remove("workspace_folders", { owner: session.id, id }, ["id"]);
        if (removed.length === 0) throw notFound("That folder");
      }),

    appendAudit: (entry) =>
      guarded(async () => {
        if (entry.userId !== session.id || entry.role !== session.role) {
          throw forbidden("An audit entry can only be written for the signed-in user.");
        }
        // The time is not sent: the database stamps the entry with its own clock. Nothing is read back,
        // because only administrators may read the audit log.
        await gateway.insert(
          "audit_log",
          { id: entry.id, user_id: entry.userId, role: entry.role, action: entry.action, entity: entry.entity, entity_id: entry.entityId, detail: entry.detail },
          [],
        );
      }),

    listAudit: (limit) =>
      guarded(async () => {
        assertAdmin();
        if (limit <= 0) return [];
        const order = [
          { column: "at", ascending: false },
          { column: "seq", ascending: false },
        ];
        const rows = await readAll((range, count) => gateway.select("audit_log", AUDIT_COLUMNS, { order, range, count }), Math.floor(limit));
        return readRows(AuditRow, rows, "audit_log").map(toAuditEntry);
      }),
  };
}

function toChangeEvent(row: z.output<typeof EventRow>): ChangeEvent {
  return { id: row.id, name: row.name, date: row.event_date, county: row.county, caseType: row.case_type, tag: row.tag, description: row.description };
}

function toAuditEntry(row: z.output<typeof AuditRow>): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    userId: row.user_id,
    role: row.role,
    // AuditAction and AuditEntity are compile-time lists with no runtime form to check against. The
    // database only holds what this app wrote (and constrains the shape), so the stored text is taken as is.
    action: row.action as AuditAction,
    entity: row.entity as AuditEntity,
    entityId: row.entity_id,
    detail: row.detail,
  };
}

/**
 * The repository for an MCP token holder: their flags (without free text) and the change events, read
 * through the token-checked database functions. A token is for reading statistics, so everything else
 * is refused.
 */
export function createTokenRepository(reader: McpReader): Repository {
  const refuse = async (): Promise<never> => {
    throw forbidden("An access token can only read statistics.");
  };
  return {
    listFlags: () => guarded(async () => readRows(LeanRow, await readAll(reader.flags), "mcp_flags").map(toLeanFlag)),
    listEvents: () => guarded(async () => readRows(EventRow, await readAll(reader.events), "mcp_change_events").map(toChangeEvent)),
    listMyRecent: refuse,
    listNeedsReview: refuse,
    createFlag: refuse,
    createFlags: refuse,
    softDeleteFlag: refuse,
    restoreFlag: refuse,
    upsertEvent: refuse,
    deleteEvent: refuse,
    listFolders: refuse,
    saveFolder: refuse,
    deleteFolder: refuse,
    appendAudit: refuse,
    listAudit: refuse,
  };
}

/**
 * The repository for this user in Supabase mode. A person signed in through the browser gets the one
 * bound to their own session. A user that came from an MCP token has no session, and gets the
 * read-only token repository.
 */
export async function createSupabaseRepository(session: SessionUser): Promise<Repository> {
  const reader = mcpReaderFor(session);
  if (reader) return createTokenRepository(reader);
  return createGatewayRepository(session, createSupabaseGateway(await createSupabaseServerClient()));
}
