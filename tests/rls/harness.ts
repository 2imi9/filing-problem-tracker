// A real Postgres (PGlite, in memory) set up the way a Supabase project is, with the project's real
// migration files applied. The tests then act as each kind of person and check what the database allows.
//
// What stands in for Supabase here (the shim):
//   * the API roles anon, authenticated and service_role (service_role bypasses row level security);
//   * the auth schema with auth.users and auth.uid(), which reads the caller from request.jwt.claims
//     exactly as Supabase's own auth.uid() does;
//   * a non-superuser owner role with BYPASSRLS that runs the migrations, like Supabase's "postgres";
//   * Supabase's default privileges: every new table, function and sequence in public is granted to
//     the API roles. The migrations have to take those away, and the tests prove that they do.
// PostgREST is stood in for by actAs(): one transaction with "set local role" and the claims set.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

const SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role project_owner nologin nosuperuser createrole bypassrls;
grant anon, authenticated, service_role to project_owner;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email varchar(255) unique
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role, project_owner;
grant select, references on table auth.users to project_owner;

grant usage, create on schema public to project_owner;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role project_owner in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role project_owner in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role project_owner in schema public grant all on sequences to anon, authenticated, service_role;
`;

/** The migration files, oldest first. */
export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8") }));
}

export type ApiRole = "authenticated" | "anon" | "service_role";

/** Who a statement runs as. `userId` null means no token subject. */
export interface Actor {
  role: ApiRole;
  userId: string | null;
}

export type Row = Record<string, unknown>;

export type Attempt = { ok: true; rows: Row[]; affected: number } | { ok: false; code: string; message: string };

/** Runs statements as one actor, inside one transaction. */
export interface Session {
  /** Runs a statement and returns its rows. Throws when the database refuses it. */
  run(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Runs a statement and reports the outcome. A refusal leaves the transaction usable. */
  attempt(sql: string, params?: unknown[]): Promise<Attempt>;
}

export interface TestDatabase {
  /** Runs as the superuser: for fixtures and for looking at what really got stored. */
  admin(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Runs several statements as the superuser. */
  adminScript(sql: string): Promise<void>;
  /** Runs several statements as the project owner, the role that applies migrations and the seed on Supabase. */
  ownerScript(sql: string): Promise<void>;
  /**
   * Acts as the actor for the length of `fn`, in one transaction. The transaction is rolled back at the
   * end unless `commit` is set, so one test cannot change what the next one sees.
   */
  actAs<T>(actor: Actor, fn: (session: Session) => Promise<T>, options?: { commit?: boolean }): Promise<T>;
  close(): Promise<void>;
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "unknown";
}

/** A fresh database with the shim and every migration applied. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  await db.exec(SHIM);
  // The migrations run as the non-superuser owner, as they do on Supabase.
  await db.exec("set role project_owner");
  for (const file of migrationFiles()) {
    try {
      await db.exec(file.sql);
    } catch (error) {
      throw new Error(`Migration ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await db.exec("reset role");

  const admin = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;

  return {
    admin,
    adminScript: async (sql) => {
      await db.exec(sql);
    },
    async ownerScript(sql) {
      await db.exec("set role project_owner");
      try {
        await db.exec(sql);
      } finally {
        await db.exec("reset role");
      }
    },
    async actAs(actor, fn, options = {}) {
      await db.exec("begin");
      try {
        await db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(actor.userId === null ? { role: actor.role } : { sub: actor.userId, role: actor.role }),
        ]);
        await db.exec(`set local role ${actor.role}`);
        let savepoint = 0;
        const session: Session = {
          run: async (sql, params = []) => (await db.query<Row>(sql, params)).rows,
          async attempt(sql, params = []) {
            const name = `attempt_${savepoint++}`;
            await db.exec(`savepoint ${name}`);
            try {
              const result = await db.query<Row>(sql, params);
              await db.exec(`release savepoint ${name}`);
              return { ok: true, rows: result.rows, affected: result.affectedRows ?? 0 };
            } catch (error) {
              await db.exec(`rollback to savepoint ${name}`);
              return { ok: false, code: errorCode(error), message: error instanceof Error ? error.message : String(error) };
            }
          },
        };
        const result = await fn(session);
        await db.exec(options.commit ? "commit" : "rollback");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
    close: () => db.close(),
  };
}

/** Postgres error codes the tests expect. */
export const DENIED = "42501"; // insufficient_privilege: no table or column privilege, or a row level security violation
export const CHECK_VIOLATION = "23514";
