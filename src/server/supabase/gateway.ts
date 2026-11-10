import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The few database operations the Supabase repository needs, as an interface. The production
// implementation below sends them through PostgREST with the caller's own token. The row level
// security tests have a second implementation that runs the same operations against a real Postgres
// (tests/rls/pgliteGateway.ts), so the repository's logic is tested against the real policies.

export type Scalar = string | number | boolean;

export interface Query {
  /** Column = value, all of them. */
  eq?: Readonly<Record<string, Scalar>>;
  order?: readonly { column: string; ascending: boolean }[];
  /** First and last row wanted, counted from 0, both included. */
  range?: readonly [from: number, to: number];
  /** Also count every matching row, not only the ones returned. Costs a count query, so ask once, not per page. */
  count?: boolean;
}

export interface Page {
  /** The rows returned. The server may return fewer per request than were asked for. */
  rows: unknown[];
  /** How many rows match in all, when the query asked for the count. Otherwise null. */
  total: number | null;
}

export interface Gateway {
  /** Reads rows from a table or view. */
  select(source: string, columns: readonly string[], query?: Query): Promise<Page>;
  /** Adds one row and returns the named columns of it. With no columns, nothing is read back. */
  insert(table: string, row: Readonly<Record<string, unknown>>, returning: readonly string[]): Promise<unknown[]>;
  /** Changes the matching rows and returns the named columns of each row that was changed. */
  update(table: string, changes: Readonly<Record<string, unknown>>, eq: Readonly<Record<string, Scalar>>, returning: readonly string[]): Promise<unknown[]>;
  /** Deletes the matching rows and returns the named columns of each row that was deleted. */
  remove(table: string, eq: Readonly<Record<string, Scalar>>, returning: readonly string[]): Promise<unknown[]>;
  /** Calls a function that returns rows. */
  call(fn: string, args: Readonly<Record<string, unknown>>, query?: Query): Promise<Page>;
}

/** A refusal or failure reported by the database. `code` is the Postgres or PostgREST error code. */
export class DbError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

interface Reply {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

function rowsOf(reply: Reply): unknown[] {
  if (reply.error) throw new DbError(reply.error.code ?? "", reply.error.message);
  return Array.isArray(reply.data) ? (reply.data as unknown[]) : [];
}

function pageOf(reply: Reply, counted: boolean): Page {
  // PGRST103: the range starts past the last row. That happens when rows went away between two pages
  // of one read, and it means what an empty page means.
  if (reply.error?.code === "PGRST103") return { rows: [], total: null };
  const rows = rowsOf(reply);
  if (!counted) return { rows, total: null };
  if (typeof reply.count !== "number") throw new DbError("", "The database did not say how many rows there are.");
  return { rows, total: reply.count };
}

/**
 * The gateway over a Supabase client. Pass the client bound to the caller's session, so row level
 * security applies. The filter loops are written out in each method because the client's builder types
 * are too deep for the compiler to follow through a shared generic helper.
 */
export function createSupabaseGateway(client: SupabaseClient): Gateway {
  return {
    async select(source, columns, query = {}) {
      let read = client.from(source).select(columns.join(","), { count: query.count ? "exact" : undefined });
      for (const [column, value] of Object.entries(query.eq ?? {})) read = read.eq(column, value);
      for (const { column, ascending } of query.order ?? []) read = read.order(column, { ascending });
      if (query.range) read = read.range(query.range[0], query.range[1]);
      return pageOf(await read, query.count === true);
    },

    async insert(table, row, returning) {
      const insert = client.from(table).insert(row);
      return rowsOf(returning.length > 0 ? await insert.select(returning.join(",")) : await insert);
    },

    async update(table, changes, eq, returning) {
      let change = client.from(table).update(changes);
      for (const [column, value] of Object.entries(eq)) change = change.eq(column, value);
      return rowsOf(await change.select(returning.join(",")));
    },

    async remove(table, eq, returning) {
      let removal = client.from(table).delete();
      for (const [column, value] of Object.entries(eq)) removal = removal.eq(column, value);
      return rowsOf(await removal.select(returning.join(",")));
    },

    async call(fn, args, query = {}) {
      let read = client.rpc(fn, args, { count: query.count ? "exact" : undefined });
      for (const [column, value] of Object.entries(query.eq ?? {})) read = read.eq(column, value);
      for (const { column, ascending } of query.order ?? []) read = read.order(column, { ascending });
      if (query.range) read = read.range(query.range[0], query.range[1]);
      return pageOf(await read, query.count === true);
    },
  };
}
