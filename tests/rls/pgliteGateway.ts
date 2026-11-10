// The repository's gateway over the test database, standing in for PostgREST: every operation is one
// committed transaction run as the actor (set local role + token claims), values go in as JSON and are
// cast to the column types by Postgres, rows come back as JSON, and no more than `maxRows` rows are
// returned per request, as PostgREST's max-rows setting does.

import { DbError } from "@/server/supabase/gateway";
import type { Gateway, Page, Query, Scalar } from "@/server/supabase/gateway";
import type { Actor, Row, Session, TestDatabase } from "./harness";

const NAME = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!NAME.test(name)) throw new Error(`Not a plain identifier: ${name}`);
  return `"${name}"`;
}

const list = (names: readonly string[]) => names.map(ident).join(", ");

function where(eq: Readonly<Record<string, Scalar>>, params: unknown[]): string {
  const terms = Object.entries(eq).map(([column, value]) => {
    params.push(value);
    return `${ident(column)} = $${params.length}`;
  });
  return terms.length > 0 ? ` where ${terms.join(" and ")}` : "";
}

const jsonRows = (rows: Row[]): unknown[] => rows.map((row) => row.row);

export function createPgliteGateway(db: TestDatabase, actor: Actor, options: { maxRows?: number } = {}): Gateway {
  const maxRows = options.maxRows ?? 1000;

  async function transact<T>(work: (session: Session) => Promise<T>): Promise<T> {
    try {
      return await db.actAs(actor, work, { commit: true });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
      throw new DbError(code, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Reads one page of `from` (a table, a view or a function call), with the count of all matching rows.
   * It is one statement, so a function is called exactly once, as PostgREST does.
   */
  function read(from: string, columns: string, params: unknown[], query: Query): Promise<Page> {
    const filter = where(query.eq ?? {}, params);
    const order = (query.order ?? []).map(({ column, ascending }) => `${ident(column)} ${ascending ? "asc" : "desc"}`).join(", ");
    const offset = query.range ? query.range[0] : 0;
    const asked = query.range ? query.range[1] - query.range[0] + 1 : maxRows;
    const last = offset + Math.min(asked, maxRows);
    const statement = `
      with result as materialized (
        select ${columns}, row_number() over (${order ? `order by ${order}` : ""}) as position__ from ${from}${filter}
      )
      select
        (select count(*)::int from result) as total,
        (select coalesce(jsonb_agg(to_jsonb(r) - 'position__' order by r.position__), '[]'::jsonb)
           from result r where r.position__ > ${offset} and r.position__ <= ${last}) as rows`;
    return transact(async (s) => {
      const [{ total, rows }] = await s.run(statement, params);
      // Like PostgREST, the count is only reported when it was asked for.
      return { rows: rows as unknown[], total: query.count ? Number(total) : null };
    });
  }

  return {
    select: (source, columns, query = {}) => read(`public.${ident(source)}`, list(columns), [], query),

    insert: (table, row, returning) =>
      transact(async (s) => {
        const columns = list(Object.keys(row));
        const target = `public.${ident(table)}`;
        const statement = `insert into ${target} (${columns}) select ${columns} from jsonb_populate_record(null::${target}, $1::jsonb)`;
        if (returning.length === 0) {
          await s.run(statement, [JSON.stringify(row)]);
          return [];
        }
        return jsonRows(await s.run(`with written as (${statement} returning ${list(returning)}) select to_jsonb(written) as row from written`, [JSON.stringify(row)]));
      }),

    update: (table, changes, eq, returning) =>
      transact(async (s) => {
        const params: unknown[] = [JSON.stringify(changes)];
        const target = `public.${ident(table)}`;
        const assignments = Object.keys(changes)
          .map((column) => `${ident(column)} = body.${ident(column)}`)
          .join(", ");
        const filter = Object.entries(eq)
          .map(([column, value]) => {
            params.push(value);
            return ` and ${target}.${ident(column)} = $${params.length}`;
          })
          .join("");
        const statement = `with written as (
          update ${target} set ${assignments}
          from (select * from jsonb_populate_record(null::${target}, $1::jsonb)) body
          where true${filter}
          returning ${returning.map((column) => `${target}.${ident(column)}`).join(", ")}
        ) select to_jsonb(written) as row from written`;
        return jsonRows(await s.run(statement, params));
      }),

    remove: (table, eq, returning) =>
      transact(async (s) => {
        const params: unknown[] = [];
        const filter = where(eq, params);
        const statement = `with written as (delete from public.${ident(table)}${filter} returning ${list(returning)}) select to_jsonb(written) as row from written`;
        return jsonRows(await s.run(statement, params));
      }),

    call(fn, args, query = {}) {
      const params: unknown[] = [];
      const named = Object.entries(args).map(([name, value]) => {
        const isJson = typeof value === "object" && value !== null;
        params.push(isJson ? JSON.stringify(value) : value);
        return `${ident(name)} => $${params.length}${isJson ? "::jsonb" : ""}`;
      });
      return read(`public.${ident(fn)}(${named.join(", ")})`, "*", params, query);
    },
  };
}
