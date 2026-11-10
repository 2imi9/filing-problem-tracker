// The access table in ARCHITECTURE.md, checked cell by cell against the real migrations.
// Actors: clerk A (Marion), clerk B (Lake), a leader, an admin, a signed-in user with no profile, anon.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN,
  ANON,
  CLERK_A,
  CLERK_B,
  CLERK_TOKEN_HASH,
  EVERYONE,
  IDS,
  LAKE_CURRENT,
  LEADER,
  MARION_CURRENT,
  MARION_REMOVED,
  REVOKED_TOKEN_HASH,
  SERVICE,
  SIGNED_IN,
  STRANGER,
  TOKEN_HASH,
  ids,
  loadFixtures,
} from "./fixtures";
import { CHECK_VIOLATION, DENIED, createTestDatabase } from "./harness";
import type { Actor, Attempt, Row, TestDatabase } from "./harness";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await loadFixtures(db);
});

afterAll(async () => {
  await db.close();
});

/** One statement as one actor. Rolled back afterwards. */
const attemptAs = (actor: Actor, sql: string, params?: unknown[]): Promise<Attempt> => db.actAs(actor, (s) => s.attempt(sql, params));

const rowsAs = (actor: Actor, sql: string, params?: unknown[]): Promise<Row[]> => db.actAs(actor, (s) => s.run(sql, params));

function expectDenied(result: Attempt): void {
  expect(result).toMatchObject({ ok: false, code: DENIED });
}

/** The statement ran and touched nothing: row level security hid every row from it. */
function expectNoRows(result: Attempt): void {
  expect(result).toMatchObject({ ok: true, affected: 0 });
}

function expectRows(result: Attempt, count: number): void {
  expect(result).toMatchObject({ ok: true, affected: count });
}

const ALL_CURRENT = [...MARION_CURRENT, ...LAKE_CURRENT].sort();

const NEW_FLAG = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, note)
  values ($1, '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected', 'a short note')`;

describe("how the schema is locked down", () => {
  it("row level security is enabled and forced on every table", async () => {
    const tables = await db.admin(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname",
    );
    expect(tables.map((t) => t.relname)).toEqual([
      "audit_log",
      "change_events",
      "filing_flags",
      "import_batches",
      "mcp_tokens",
      "profiles",
      "workspace_folders",
      "workspace_seeds",
    ]);
    for (const table of tables) expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("every policy applies to the authenticated role only, and mcp_tokens has none", async () => {
    const policies = await db.admin("select tablename, policyname, roles::text as roles from pg_policies where schemaname = 'public'");
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy.roles).toBe("{authenticated}");
    expect(policies.filter((p) => p.tablename === "mcp_tokens")).toEqual([]);
  });

  it("anon holds no privilege on any table, view, sequence or function", async () => {
    const relations = await db.admin(`
      select c.relname
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')
        and (
          has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'update')
          or (c.relkind <> 'S' and has_any_column_privilege('anon', c.oid, 'select, insert, update, references'))
          or (c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'insert, delete, truncate, references, trigger'))
          or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'usage'))
        )`);
    expect(relations).toEqual([]);
    const functions = await db.admin(
      "select p.oid::regprocedure::text as fn from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')",
    );
    expect(functions).toEqual([]);
  });

  it("authenticated has no select privilege on the note and reason columns, and none on the counters", async () => {
    const [columns] = await db.admin(`
      select
        has_column_privilege('authenticated', 'public.filing_flags', 'note', 'select') as note,
        has_column_privilege('authenticated', 'public.filing_flags', 'reason', 'select') as reason,
        has_column_privilege('authenticated', 'public.filing_flags', 'county', 'select') as county,
        has_table_privilege('authenticated', 'public.filing_flags', 'select') as whole_table,
        has_table_privilege('authenticated', 'public.filing_flags', 'delete') as hard_delete,
        has_sequence_privilege('authenticated', 'public.filing_flags_seq_seq', 'usage') as counter`);
    expect(columns).toEqual({ note: false, reason: false, county: true, whole_table: false, hard_delete: false, counter: false });
  });

  it("every function has a fixed search_path, and only the intended ones are security definer", async () => {
    const functions = await db.admin(`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config
      from pg_proc p where p.pronamespace = 'public'::regnamespace order by p.proname`);
    for (const fn of functions) expect(fn.config, String(fn.proname)).toContain("search_path=");
    expect(functions.filter((fn) => fn.prosecdef).map((fn) => fn.proname)).toEqual([
      "app_county",
      "app_role",
      "mcp_change_events",
      "mcp_flags",
      "mcp_token_user",
      "my_recent_flags",
      "needs_review_flags",
    ]);
  });

  it("flags_lean runs as the person asking and has no free-text columns", async () => {
    const [view] = await db.admin("select reloptions::text as options from pg_class where oid = 'public.flags_lean'::regclass");
    expect(view.options).toContain("security_invoker=true");
    const columns = await db.admin("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'flags_lean'");
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain("note");
    expect(names).not.toContain("reason");
    expect(names).not.toContain("deleted_at");
  });
});

describe("read flags", () => {
  it("clerk A reads Marion only", async () => {
    expect(ids(await rowsAs(CLERK_A, "select id from public.flags_lean"))).toEqual(MARION_CURRENT);
    expect(await rowsAs(CLERK_A, "select id from public.flags_lean where county <> 'Marion'")).toEqual([]);
    expect(await rowsAs(CLERK_A, "select id from public.filing_flags where county = 'Lake'")).toEqual([]);
  });

  it("clerk B reads Lake only", async () => {
    expect(ids(await rowsAs(CLERK_B, "select id from public.flags_lean"))).toEqual(LAKE_CURRENT);
    expect(await rowsAs(CLERK_B, "select id from public.filing_flags where county = 'Marion'")).toEqual([]);
  });

  it("the leader and the admin read every county", async () => {
    expect(ids(await rowsAs(LEADER, "select id from public.flags_lean"))).toEqual(ALL_CURRENT);
    expect(ids(await rowsAs(ADMIN, "select id from public.flags_lean"))).toEqual(ALL_CURRENT);
  });

  it("removed entries are in nobody's view, and in the table only for their author and the admin", async () => {
    for (const [, actor] of SIGNED_IN) {
      expect(await rowsAs(actor, "select id from public.flags_lean where id = any($1)", [MARION_REMOVED])).toEqual([]);
    }
    const removed = "select id from public.filing_flags where deleted_at is not null";
    expect(ids(await rowsAs(CLERK_A, removed))).toEqual(MARION_REMOVED);
    expect(ids(await rowsAs(ADMIN, removed))).toEqual(MARION_REMOVED);
    expect(await rowsAs(LEADER, removed)).toEqual([]);
    expect(await rowsAs(CLERK_B, removed)).toEqual([]);
  });

  it("a signed-in user with no profile reads nothing", async () => {
    expect(await rowsAs(STRANGER, "select id from public.flags_lean")).toEqual([]);
    expect(await rowsAs(STRANGER, "select id from public.filing_flags")).toEqual([]);
  });

  it("anon is refused", async () => {
    expectDenied(await attemptAs(ANON, "select id from public.flags_lean"));
    expectDenied(await attemptAs(ANON, "select id from public.filing_flags"));
  });
});

describe("read notes and raw reasons", () => {
  const BASE_TABLE_PATHS: readonly (readonly [string, string])[] = [
    ["selecting the columns", "select id, note, reason from public.filing_flags"],
    ["selecting every column", "select * from public.filing_flags"],
    ["selecting the whole row", "select f from public.filing_flags f"],
    ["filtering on a note", "select id from public.filing_flags where note like '%a%'"],
    ["sorting by a reason", "select id from public.filing_flags order by reason"],
    ["counting notes", "select count(note) from public.filing_flags"],
    ["grouping by a reason", "select reason, count(*) from public.filing_flags group by reason"],
    ["joining the view back to the table", "select f.note from public.flags_lean l join public.filing_flags f on f.id = l.id"],
    ["copying a note into another column on update", "update public.filing_flags set deleted_at = now() where note is not null"],
    ["returning the text from an update", "update public.filing_flags set deleted_at = now() where id = 'a-fresh' returning note"],
  ];

  describe.each(EVERYONE)("%s", (_name, actor) => {
    it.each(BASE_TABLE_PATHS)("cannot reach the text in the table by %s", async (_path, sql) => {
      expectDenied(await attemptAs(actor, sql));
    });

    it("finds no text columns in the view", async () => {
      // 42703: the column does not exist.
      expect(await attemptAs(actor, "select note from public.flags_lean")).toMatchObject({ ok: false, code: "42703" });
      expect(await attemptAs(actor, "select reason from public.flags_lean")).toMatchObject({ ok: false, code: "42703" });
    });
  });

  it("an insert cannot hand the text back either", async () => {
    expectDenied(await attemptAs(CLERK_A, `${NEW_FLAG} returning note`, ["Marion"]));
    expectDenied(await attemptAs(ADMIN, `${NEW_FLAG} returning *`, ["Marion"]));
  });

  it("clerk A reads the notes on their own entries, and no one else's", async () => {
    const rows = await rowsAs(CLERK_A, "select id, note, reason from public.my_recent_flags(50)");
    expect(ids(rows)).toEqual(["a-fresh", "a-old", "a-review", "a-sorted"]);
    expect(rows.find((r) => r.id === "a-fresh")?.note).toBe("note on a-fresh");
    // Newest first.
    expect(rows[0].id === "a-fresh").toBe(true);
    // The limit is honored and capped.
    expect(await rowsAs(CLERK_A, "select id from public.my_recent_flags(1)")).toHaveLength(1);
    expect(await rowsAs(CLERK_A, "select id from public.my_recent_flags(-5)")).toHaveLength(0);
  });

  it("clerk A reads the raw reasons of Marion's needs-review rows, and not Lake's", async () => {
    const rows = await rowsAs(CLERK_A, "select id, reason from public.needs_review_flags()");
    expect(rows).toEqual([{ id: "a-review", reason: "reason on a-review" }]);
  });

  it("clerk B gets Lake's only", async () => {
    expect(ids(await rowsAs(CLERK_B, "select id from public.my_recent_flags(50)"))).toEqual(["b-fresh", "b-review"]);
    expect(await rowsAs(CLERK_B, "select id, reason from public.needs_review_flags()")).toEqual([{ id: "b-review", reason: "reason on b-review" }]);
  });

  it("a clerk moved to another county no longer reads the notes they wrote in the old one", async () => {
    await db.admin("update public.profiles set county = 'Allen' where user_id = $1", [IDS.clerkA]);
    try {
      expect(await rowsAs(CLERK_A, "select id from public.my_recent_flags(50)")).toEqual([]);
      expect(await rowsAs(CLERK_A, "select id from public.needs_review_flags()")).toEqual([]);
    } finally {
      await db.admin("update public.profiles set county = 'Marion' where user_id = $1", [IDS.clerkA]);
    }
  });

  it("the leader gets zero notes and zero reasons, by every path", async () => {
    expect(await rowsAs(LEADER, "select * from public.my_recent_flags(50)")).toEqual([]);
    expectDenied(await attemptAs(LEADER, "select * from public.needs_review_flags()"));
    // Even for an entry the leader is recorded as the author of (it cannot happen through the app).
    await db.admin("update public.filing_flags set created_by = $1 where id = 'a-old'", [IDS.leader]);
    try {
      expect(await rowsAs(LEADER, "select * from public.my_recent_flags(50)")).toEqual([]);
    } finally {
      await db.admin("update public.filing_flags set created_by = $1 where id = 'a-old'", [IDS.clerkA]);
    }
  });

  it("the admin reads the reasons of every county's needs-review rows, and the notes on their own entries", async () => {
    const review = await rowsAs(ADMIN, "select id, reason from public.needs_review_flags()");
    expect(review).toEqual([
      { id: "a-review", reason: "reason on a-review" },
      { id: "b-review", reason: "reason on b-review" },
    ]);
    expect(await rowsAs(ADMIN, "select id, note from public.my_recent_flags(50)")).toEqual([{ id: "a-by-admin", note: "note on a-by-admin" }]);
  });

  it("a signed-in user with no profile and anon get nothing", async () => {
    expect(await rowsAs(STRANGER, "select * from public.my_recent_flags(50)")).toEqual([]);
    expectDenied(await attemptAs(STRANGER, "select * from public.needs_review_flags()"));
    expectDenied(await attemptAs(ANON, "select * from public.my_recent_flags(50)"));
    expectDenied(await attemptAs(ANON, "select * from public.needs_review_flags()"));
  });
});

describe("create a flag", () => {
  it("clerk A adds one for Marion, and the database records the author and the time", async () => {
    await db.actAs(CLERK_A, async (s) => {
      const [row] = await s.run(`${NEW_FLAG} returning id, created_by, source, created_at, deleted_at`, ["Marion"]);
      expect(row).toMatchObject({ created_by: IDS.clerkA, source: "clerk", deleted_at: null });
      expect(await s.run("select id from public.flags_lean where id = $1", [row.id])).toHaveLength(1);
    });
  });

  it("clerk A cannot add one for Lake", async () => {
    expectDenied(await attemptAs(CLERK_A, NEW_FLAG, ["Lake"]));
  });

  it("a clerk cannot name someone else, or no one, as the author", async () => {
    const withAuthor = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, created_by)
      values ('Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected', $1)`;
    expectDenied(await attemptAs(CLERK_A, withAuthor, [IDS.clerkB]));
    expectDenied(await attemptAs(CLERK_A, withAuthor, [IDS.admin]));
    expectDenied(await attemptAs(CLERK_A, withAuthor, [null]));
    expectRows(await attemptAs(CLERK_A, withAuthor, [IDS.clerkA]), 1);
  });

  it("a clerk cannot set the id, the time added or the time removed", async () => {
    const withColumn = (column: string, value: string) =>
      `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, ${column})
       values ('Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected', ${value})`;
    expectDenied(await attemptAs(CLERK_A, withColumn("id", "'chosen-id'")));
    expectDenied(await attemptAs(CLERK_A, withColumn("created_at", "now() + interval '1 year'")));
    expectDenied(await attemptAs(CLERK_A, withColumn("deleted_at", "now()")));
  });

  it("nobody can add a sample row through the API", async () => {
    const sample = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, source)
      values ('Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected', 'sample')`;
    expectDenied(await attemptAs(CLERK_A, sample));
    expectDenied(await attemptAs(ADMIN, sample));
  });

  it("the admin adds one for any county", async () => {
    expectRows(await attemptAs(ADMIN, NEW_FLAG, ["Marion"]), 1);
    expectRows(await attemptAs(ADMIN, NEW_FLAG, ["Tippecanoe"]), 1);
  });

  it.each([
    ["leader", LEADER],
    ["signed-in user with no profile", STRANGER],
    ["anon", ANON],
  ] as const)("%s cannot add one", async (_name, actor) => {
    expectDenied(await attemptAs(actor, NEW_FLAG, ["Marion"]));
  });

  it("the check constraints hold whoever is asking", async () => {
    const insert = (columns: string) =>
      `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome) values (${columns})`;
    const bad = [
      "'Marion', '2019-12-31', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected'",
      "'Marion', current_date + 2, 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected'",
      "'Marion', '2024-04-01', 'Small claims', 'Petition for change of name', array['Missing signature'], 'Rejected'",
      "'Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Not a problem'], 'Rejected'",
      "'Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Needs review'], 'Rejected'",
      "'Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array[]::text[], 'Rejected'",
      "'Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Wrong form', 'Wrong form'], 'Rejected'",
      "'Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Lost'",
    ];
    for (const columns of bad) {
      expect(await attemptAs(ADMIN, insert(columns)), columns).toMatchObject({ ok: false, code: CHECK_VIOLATION });
    }
  });
});

describe("import", () => {
  const rows = (county: string) =>
    JSON.stringify([
      { date: "2024-04-02", county: "Marion", caseType: "Eviction", form: "Tenant answer or request for hearing", reason: "page 3 missing", tags: ["Pages missing or unreadable"] },
      { date: "2024-04-03", county, caseType: "Name change", form: "Petition for change of name", reason: "", tags: ["Needs review"] },
    ]);
  const IMPORT = "select batch, inserted from public.import_flags($1, $2::jsonb)";

  it("clerk A imports Marion rows as one batch, saved as rejected imports under their own name", async () => {
    await db.actAs(CLERK_A, async (s) => {
      const [result] = await s.run(IMPORT, ["April export", rows("Marion")]);
      expect(result.inserted).toBe(2);
      const saved = await s.run("select county, outcome, source, created_by, tags from public.flags_lean where batch_id = $1 order by seq", [result.batch]);
      expect(saved).toEqual([
        { county: "Marion", outcome: "Rejected", source: "import", created_by: IDS.clerkA, tags: ["Pages missing or unreadable"] },
        { county: "Marion", outcome: "Rejected", source: "import", created_by: IDS.clerkA, tags: ["Needs review"] },
      ]);
      const review = await s.run("select reason from public.needs_review_flags() where batch_id = $1", [result.batch]);
      // An empty reason is stored as no reason.
      expect(review).toEqual([{ reason: null }]);
      expect(await s.run("select name, row_count, created_by from public.import_batches where id = $1", [result.batch])).toEqual([
        { name: "April export", row_count: 2, created_by: IDS.clerkA },
      ]);
    });
  });

  it("one row for another county refuses the whole import, and nothing is saved", async () => {
    await db.actAs(CLERK_A, async (s) => {
      const before = await s.run("select count(*)::int as n from public.import_batches");
      expectDenied(await s.attempt(IMPORT, ["April export", rows("Lake")]));
      expect(await s.run("select count(*)::int as n from public.import_batches")).toEqual(before);
      expect(await s.run("select id from public.flags_lean where filed_on = '2024-04-02'")).toEqual([]);
    });
  });

  it("the admin imports for any county", async () => {
    expect(await rowsAs(ADMIN, IMPORT, ["April export", rows("Lake")])).toMatchObject([{ inserted: 2 }]);
  });

  it.each([
    ["leader", LEADER],
    ["signed-in user with no profile", STRANGER],
    ["anon", ANON],
  ] as const)("%s cannot import", async (_name, actor) => {
    expectDenied(await attemptAs(actor, IMPORT, ["April export", rows("Marion")]));
  });

  it("a clerk cannot add rows to another clerk's batch", async () => {
    const intoBatch = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, reason, source, batch_id)
      values ('Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Needs review'], 'Rejected', 'a reason', 'import', $1)`;
    expectDenied(await attemptAs(CLERK_A, intoBatch, [IDS.batchB]));
    expectRows(await attemptAs(CLERK_A, intoBatch, [IDS.batchA]), 1);
  });

  it("an empty import and a malformed row are refused", async () => {
    expect(await attemptAs(CLERK_A, IMPORT, ["Empty", "[]"])).toMatchObject({ ok: false, code: "22023" });
    const badDate = JSON.stringify([{ date: "not a date", county: "Marion", caseType: "Eviction", form: "Tenant answer or request for hearing", reason: "", tags: ["Wrong form"] }]);
    expect(await attemptAs(CLERK_A, IMPORT, ["Bad", badDate])).toMatchObject({ ok: false, code: "22007" });
  });

  it("import batches are read by the clerk who made them and by the admin", async () => {
    const all = "select id from public.import_batches";
    expect(ids(await rowsAs(CLERK_A, all))).toEqual([IDS.batchA]);
    expect(ids(await rowsAs(CLERK_B, all))).toEqual([IDS.batchB]);
    expect(ids(await rowsAs(ADMIN, all))).toEqual([IDS.batchA, IDS.batchB]);
    expect(await rowsAs(LEADER, all)).toEqual([]);
    expect(await rowsAs(STRANGER, all)).toEqual([]);
    expectDenied(await attemptAs(ANON, all));
  });
});

describe("remove and restore a flag", () => {
  const REMOVE = "update public.filing_flags set deleted_at = now() where id = $1";
  const RESTORE = "update public.filing_flags set deleted_at = null where id = $1";

  it("clerk A removes their own entry within 5 minutes of adding it", async () => {
    await db.actAs(CLERK_A, async (s) => {
      expectRows(await s.attempt(REMOVE, ["a-fresh"]), 1);
      expect(await s.run("select id from public.flags_lean where id = 'a-fresh'")).toEqual([]);
    });
  });

  it("clerk A cannot remove their own entry after 5 minutes", async () => {
    expectNoRows(await attemptAs(CLERK_A, REMOVE, ["a-old"]));
    expectNoRows(await attemptAs(CLERK_A, REMOVE, ["a-review"]));
  });

  it("the window is exactly the one the database is set to", async () => {
    await db.admin("update public.filing_flags set created_at = now() - interval '4 minutes 50 seconds' where id = 'a-old'");
    try {
      expectRows(await attemptAs(CLERK_A, REMOVE, ["a-old"]), 1);
      await db.admin("update public.filing_flags set created_at = now() - interval '5 minutes 10 seconds' where id = 'a-old'");
      expectNoRows(await attemptAs(CLERK_A, REMOVE, ["a-old"]));
    } finally {
      await db.admin("update public.filing_flags set created_at = now() - interval '10 minutes' where id = 'a-old'");
    }
  });

  it("clerk A cannot remove an entry someone else added, or a sample row", async () => {
    expectNoRows(await attemptAs(CLERK_A, REMOVE, ["a-by-admin"]));
    expectNoRows(await attemptAs(CLERK_A, REMOVE, ["a-sample"]));
    expectNoRows(await attemptAs(CLERK_A, REMOVE, ["b-fresh"]));
  });

  it("clerk B cannot remove clerk A's entry", async () => {
    expectNoRows(await attemptAs(CLERK_B, REMOVE, ["a-fresh"]));
  });

  it("the time removed is the database's clock, whatever the clerk sends", async () => {
    await db.actAs(CLERK_A, async (s) => {
      const [row] = await s.run("update public.filing_flags set deleted_at = now() + interval '1 year' where id = 'a-fresh' returning deleted_at = now() as stamped_now");
      expect(row.stamped_now).toBe(true);
      // And a removed entry cannot be re-dated.
      const [again] = await s.run("update public.filing_flags set deleted_at = now() + interval '1 year' where id = 'a-gone-fresh' returning deleted_at < now() as kept");
      expect(again.kept).toBe(true);
    });
  });

  it("clerk A restores their own entry within 5 minutes of removing it, and not after", async () => {
    await db.actAs(CLERK_A, async (s) => {
      expectRows(await s.attempt(RESTORE, ["a-gone-fresh"]), 1);
      expect(await s.run("select id from public.flags_lean where id = 'a-gone-fresh'")).toHaveLength(1);
      expectNoRows(await s.attempt(RESTORE, ["a-gone-old"]));
    });
  });

  it("clerk A cannot restore their entry after an administrator removed it, even within 5 minutes", async () => {
    const whoRemoved = async () => (await db.admin("select deleted_by from public.filing_flags where id = 'a-fresh'"))[0].deleted_by;
    await db.actAs(ADMIN, async (s) => expectRows(await s.attempt(REMOVE, ["a-fresh"]), 1), { commit: true });
    try {
      // The database recorded who removed it.
      expect(await whoRemoved()).toBe(IDS.admin);
      expectNoRows(await attemptAs(CLERK_A, RESTORE, ["a-fresh"]));
      // Removing it "again" does not make the removal the clerk's own.
      await attemptAs(CLERK_A, REMOVE, ["a-fresh"]);
      expect(await whoRemoved()).toBe(IDS.admin);
      // Nobody can write the column, to claim a removal or to disown one.
      expectDenied(await attemptAs(CLERK_A, "update public.filing_flags set deleted_by = $1 where id = 'a-fresh'", [IDS.clerkA]));
      expectDenied(await attemptAs(ADMIN, "update public.filing_flags set deleted_by = null where id = 'a-fresh'"));
      expectDenied(await attemptAs(CLERK_A, "update public.filing_flags set deleted_at = null, deleted_by = $1 where id = 'a-fresh'", [IDS.clerkA]));
    } finally {
      await db.actAs(ADMIN, async (s) => expectRows(await s.attempt(RESTORE, ["a-fresh"]), 1), { commit: true });
    }
    // Restored, the entry has no remover.
    expect(await whoRemoved()).toBeNull();
  });

  it("a removal is recorded as the clerk's own, which is what lets them undo it", async () => {
    await db.actAs(CLERK_A, async (s) => {
      expectRows(await s.attempt(REMOVE, ["a-fresh"]), 1);
      expectRows(await s.attempt(RESTORE, ["a-fresh"]), 1);
      expectRows(await s.attempt(REMOVE, ["a-fresh"]), 1);
    });
    await db.actAs(CLERK_A, async (s) => expectRows(await s.attempt(REMOVE, ["a-fresh"]), 1), { commit: true });
    try {
      expect((await db.admin("select deleted_by from public.filing_flags where id = 'a-fresh'"))[0].deleted_by).toBe(IDS.clerkA);
    } finally {
      await db.actAs(CLERK_A, async (s) => expectRows(await s.attempt(RESTORE, ["a-fresh"]), 1), { commit: true });
    }
  });

  it("the leader, a signed-in user with no profile and anon can remove and restore nothing", async () => {
    for (const id of ["a-fresh", "a-sample", "b-fresh"]) {
      expectNoRows(await attemptAs(LEADER, REMOVE, [id]));
      expectNoRows(await attemptAs(STRANGER, REMOVE, [id]));
      expectDenied(await attemptAs(ANON, REMOVE, [id]));
    }
    expectNoRows(await attemptAs(LEADER, RESTORE, ["a-gone-fresh"]));
    expectNoRows(await attemptAs(STRANGER, RESTORE, ["a-gone-fresh"]));
    expectDenied(await attemptAs(ANON, RESTORE, ["a-gone-fresh"]));
  });

  it("the admin removes and restores any entry at any time", async () => {
    await db.actAs(ADMIN, async (s) => {
      expectRows(await s.attempt(REMOVE, ["a-old"]), 1);
      expectRows(await s.attempt(REMOVE, ["a-sample"]), 1);
      expectRows(await s.attempt(REMOVE, ["b-fresh"]), 1);
      expectRows(await s.attempt(RESTORE, ["a-gone-old"]), 1);
    });
  });

  describe.each(EVERYONE)("%s", (_name, actor) => {
    it("cannot delete a row outright", async () => {
      expectDenied(await attemptAs(actor, "delete from public.filing_flags where id = 'a-fresh'"));
      expectDenied(await attemptAs(actor, "truncate public.filing_flags"));
    });

    it.each(["county = 'Lake'", "tags = array['Wrong form']", "note = 'changed'", "reason = 'changed'", "created_by = null", "created_at = now()", "outcome = 'Rejected'", "id = 'x'"])(
      "cannot change anything else about a row (%s)",
      async (assignment) => {
        expectDenied(await attemptAs(actor, `update public.filing_flags set ${assignment} where id = 'a-fresh'`));
      },
    );
  });
});

describe("change events", () => {
  const INSERT = `insert into public.change_events (name, event_date, county, case_type, tag, description)
    values ('New guide', '2024-05-01', 'Lake', 'Family', 'Wrong form', 'A made-up change.')`;
  const UPDATE = "update public.change_events set name = 'Renamed' where id = 'event-1'";
  const DELETE = "delete from public.change_events where id = 'event-1'";

  it.each([
    ["clerk A", CLERK_A],
    ["clerk B", CLERK_B],
    ["leader", LEADER],
  ] as const)("%s reads them and cannot write them", async (_name, actor) => {
    expect(ids(await rowsAs(actor, "select id from public.change_events"))).toEqual(["event-1"]);
    expectDenied(await attemptAs(actor, INSERT));
    expectNoRows(await attemptAs(actor, UPDATE));
    expectNoRows(await attemptAs(actor, DELETE));
  });

  it("the admin reads and writes them", async () => {
    await db.actAs(ADMIN, async (s) => {
      expect(await s.run(`${INSERT} returning created_by`)).toEqual([{ created_by: IDS.admin }]);
      expectRows(await s.attempt(UPDATE), 1);
      expectRows(await s.attempt(DELETE), 1);
      expect(await s.run("select name from public.change_events")).toEqual([{ name: "New guide" }]);
    });
  });

  it("the admin cannot choose an event's id or record someone else as its author", async () => {
    expectDenied(await attemptAs(ADMIN, "insert into public.change_events (id, name, event_date, county, case_type, tag) values ('x', 'n', '2024-05-01', 'Lake', 'Family', 'Wrong form')"));
    expectDenied(
      await attemptAs(ADMIN, "insert into public.change_events (name, event_date, county, case_type, tag, created_by) values ('n', '2024-05-01', 'Lake', 'Family', 'Wrong form', $1)", [IDS.leader]),
    );
  });

  it("a signed-in user with no profile sees none and writes none; anon is refused", async () => {
    expect(await rowsAs(STRANGER, "select id from public.change_events")).toEqual([]);
    expectDenied(await attemptAs(STRANGER, INSERT));
    expectNoRows(await attemptAs(STRANGER, UPDATE));
    expectNoRows(await attemptAs(STRANGER, DELETE));
    for (const sql of ["select id from public.change_events", INSERT, UPDATE, DELETE]) expectDenied(await attemptAs(ANON, sql));
  });
});

describe("folders", () => {
  const OWN: readonly (readonly [string, Actor, string[]])[] = [
    ["clerk A", CLERK_A, ["folder-a"]],
    ["clerk B", CLERK_B, []],
    ["leader", LEADER, ["folder-l"]],
    ["admin", ADMIN, ["folder-d"]],
    ["signed-in user with no profile", STRANGER, []],
  ];

  it.each(OWN)("%s reads only their own", async (_name, actor, expected) => {
    expect(ids(await rowsAs(actor, "select id from public.workspace_folders"))).toEqual(expected);
  });

  it.each(OWN)("%s cannot change or delete anyone else's", async (_name, actor, own) => {
    for (const id of ["folder-a", "folder-l", "folder-d"].filter((folder) => !own.includes(folder))) {
      expectNoRows(await attemptAs(actor, "update public.workspace_folders set name = 'Taken' where id = $1", [id]));
      expectNoRows(await attemptAs(actor, "delete from public.workspace_folders where id = $1", [id]));
    }
  });

  it("each person with a profile saves, renames and deletes their own", async () => {
    for (const actor of [CLERK_A, CLERK_B, LEADER, ADMIN]) {
      await db.actAs(actor, async (s) => {
        const [row] = await s.run("insert into public.workspace_folders (id, name, panels) values ('mine', 'Mine', '[]') returning owner");
        expect(row.owner).toBe(actor.userId);
        expectRows(await s.attempt("update public.workspace_folders set name = 'Renamed', panels = '[{}]' where id = 'mine'"), 1);
        expectRows(await s.attempt("delete from public.workspace_folders where id = 'mine'"), 1);
      });
    }
  });

  it("a person has at most one folder with the reserved name that holds their open panels", async () => {
    await db.actAs(LEADER, async (s) => {
      expectRows(await s.attempt("insert into public.workspace_folders (id, name) values ('current-1', '__current')"), 1);
      const second = await s.attempt("insert into public.workspace_folders (id, name) values ('current-2', '__current')");
      expect(second).toMatchObject({ ok: false, code: "23505" });
      const renamed = await s.attempt("update public.workspace_folders set name = '__current' where id = 'folder-l'");
      expect(renamed).toMatchObject({ ok: false, code: "23505" });
      // Any other name can be used twice, as before.
      expectRows(await s.attempt("insert into public.workspace_folders (id, name) values ('twin', 'Leader folder')"), 1);
    });
    // The rule is per person: someone else's reserved folder is their own business.
    await db.actAs(ADMIN, async (s) => expectRows(await s.attempt("insert into public.workspace_folders (id, name) values ('current-1', '__current')"), 1));
  });

  it("nobody can save a folder as someone else, or hand one over", async () => {
    expectDenied(await attemptAs(CLERK_A, "insert into public.workspace_folders (id, owner, name) values ('planted', $1, 'Planted')", [IDS.leader]));
    expectDenied(await attemptAs(ADMIN, "insert into public.workspace_folders (id, owner, name) values ('planted', $1, 'Planted')", [IDS.leader]));
    expectDenied(await attemptAs(CLERK_A, "update public.workspace_folders set owner = $1 where id = 'folder-a'", [IDS.leader]));
  });

  it("a signed-in user with no profile cannot save one; anon is refused everything", async () => {
    expectDenied(await attemptAs(STRANGER, "insert into public.workspace_folders (id, name) values ('mine', 'Mine')"));
    for (const sql of ["select id from public.workspace_folders", "insert into public.workspace_folders (id, name) values ('mine', 'Mine')", "delete from public.workspace_folders"]) {
      expectDenied(await attemptAs(ANON, sql));
    }
  });

  it("the example folders are given once per person", async () => {
    const examples = JSON.stringify([
      { id: "example-1", name: "Example one", panels: [] },
      { id: "example-2", name: "Example two", panels: [{ id: "p1" }] },
    ]);
    await db.actAs(CLERK_B, async (s) => {
      expect(await s.run("select seeded from public.seed_example_folders($1::jsonb)", [examples])).toEqual([{ seeded: true }]);
      expect(await s.run("select id from public.workspace_folders order by seq")).toEqual([{ id: "example-1" }, { id: "example-2" }]);
      await s.run("delete from public.workspace_folders where id = 'example-1'");
      expect(await s.run("select seeded from public.seed_example_folders($1::jsonb)", [examples])).toEqual([{ seeded: false }]);
      expect(await s.run("select id from public.workspace_folders")).toEqual([{ id: "example-2" }]);
    });
    expectDenied(await attemptAs(STRANGER, "select seeded from public.seed_example_folders($1::jsonb)", [examples]));
    expectDenied(await attemptAs(ANON, "select seeded from public.seed_example_folders($1::jsonb)", [examples]));
  });

  it("the record of who has their examples is private too", async () => {
    await db.admin("insert into public.workspace_seeds (owner) values ($1)", [IDS.leader]);
    try {
      expect(await rowsAs(LEADER, "select owner from public.workspace_seeds")).toHaveLength(1);
      expect(await rowsAs(ADMIN, "select owner from public.workspace_seeds")).toEqual([]);
      expectDenied(await attemptAs(CLERK_A, "insert into public.workspace_seeds (owner) values ($1)", [IDS.admin]));
      expectDenied(await attemptAs(LEADER, "delete from public.workspace_seeds"));
    } finally {
      await db.admin("delete from public.workspace_seeds");
    }
  });
});

describe("audit log", () => {
  const READ = "select id from public.audit_log";
  const WRITE = "insert into public.audit_log (user_id, role, action, entity, entity_id, detail) values ($1, $2, 'flag.create', 'flag', 'a-fresh', '{\"tags\": 2}')";

  it("only the admin reads it", async () => {
    expect(await rowsAs(ADMIN, READ)).toHaveLength(2);
    for (const actor of [CLERK_A, CLERK_B, LEADER, STRANGER]) expect(await rowsAs(actor, READ)).toEqual([]);
    expectDenied(await attemptAs(ANON, READ));
  });

  it("each person with a profile adds entries about themselves, stamped by the database", async () => {
    for (const [actor, role] of [[CLERK_A, "clerk"], [LEADER, "leader"], [ADMIN, "admin"]] as const) {
      expectRows(await attemptAs(actor, WRITE, [actor.userId, role]), 1);
    }
    await db.actAs(ADMIN, async (s) => {
      const [row] = await s.run(`${WRITE} returning at = now() as stamped_now`, [IDS.admin, "admin"]);
      expect(row.stamped_now).toBe(true);
    });
  });

  it("nobody can write an entry as someone else, under another role, or with a chosen time", async () => {
    expectDenied(await attemptAs(CLERK_A, WRITE, [IDS.clerkB, "clerk"]));
    expectDenied(await attemptAs(CLERK_A, WRITE, [IDS.admin, "admin"]));
    expectDenied(await attemptAs(CLERK_A, WRITE, [IDS.clerkA, "admin"]));
    expectDenied(await attemptAs(ADMIN, WRITE, [IDS.clerkA, "clerk"]));
    expectDenied(
      await attemptAs(CLERK_A, "insert into public.audit_log (user_id, role, action, entity, at) values ($1, 'clerk', 'flag.create', 'flag', now() - interval '1 year')", [IDS.clerkA]),
    );
  });

  it("a signed-in user with no profile and anon cannot add entries", async () => {
    for (const role of ["clerk", "leader", "admin"]) expectDenied(await attemptAs(STRANGER, WRITE, [IDS.stranger, role]));
    expectDenied(await attemptAs(ANON, WRITE, [IDS.clerkA, "clerk"]));
  });

  it.each(EVERYONE)("%s cannot change or delete entries", async (_name, actor) => {
    expectDenied(await attemptAs(actor, "update public.audit_log set action = 'flag.delete'"));
    expectDenied(await attemptAs(actor, "delete from public.audit_log"));
    expectDenied(await attemptAs(actor, "truncate public.audit_log"));
  });
});

describe("profiles (invite only)", () => {
  it("a person reads their own profile; the admin reads everyone's", async () => {
    expect(await rowsAs(CLERK_A, "select user_id, role, county from public.profiles")).toEqual([{ user_id: IDS.clerkA, role: "clerk", county: "Marion" }]);
    expect(await rowsAs(LEADER, "select role from public.profiles")).toEqual([{ role: "leader" }]);
    expect(await rowsAs(ADMIN, "select role from public.profiles")).toHaveLength(4);
    expect(await rowsAs(STRANGER, "select role from public.profiles")).toEqual([]);
    expectDenied(await attemptAs(ANON, "select role from public.profiles"));
  });

  it("signing in does not create a profile", async () => {
    expect(await db.admin("select 1 from public.profiles where user_id = $1", [IDS.stranger])).toEqual([]);
    expect(await db.admin("select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'auth'::regnamespace and not t.tgisinternal")).toEqual([]);
  });

  it("nobody can give themselves a profile or a different role", async () => {
    for (const role of ["clerk", "leader", "admin"]) {
      const county = role === "clerk" ? "Marion" : null;
      expectDenied(await attemptAs(STRANGER, "insert into public.profiles (user_id, role, county) values ($1, $2, $3)", [IDS.stranger, role, county]));
    }
    expectNoRows(await attemptAs(CLERK_A, "update public.profiles set role = 'admin', county = null where user_id = $1", [IDS.clerkA]));
    expectNoRows(await attemptAs(CLERK_A, "update public.profiles set county = 'Lake' where user_id = $1", [IDS.clerkA]));
    expectNoRows(await attemptAs(LEADER, "update public.profiles set role = 'admin' where user_id = $1", [IDS.leader]));
    expectNoRows(await attemptAs(LEADER, "delete from public.profiles where user_id = $1", [IDS.clerkA]));
    expectDenied(await attemptAs(CLERK_A, "insert into public.profiles (user_id, role, county) values ($1, 'clerk', 'Marion')", [IDS.stranger]));
    expectDenied(await attemptAs(ANON, "insert into public.profiles (user_id, role) values ($1, 'admin')", [IDS.stranger]));
  });

  it("the admin invites a person by adding their profile, and that is what gives them access", async () => {
    await db.actAs(ADMIN, (s) => s.run("insert into public.profiles (user_id, role, county) values ($1, 'clerk', 'Lake')", [IDS.stranger]), { commit: true });
    try {
      expect(ids(await rowsAs(STRANGER, "select id from public.flags_lean"))).toEqual(LAKE_CURRENT);
      expectRows(await attemptAs(STRANGER, NEW_FLAG, ["Lake"]), 1);
      expectDenied(await attemptAs(STRANGER, NEW_FLAG, ["Marion"]));
      // The admin changes the role, and the access follows at once.
      await db.actAs(ADMIN, (s) => s.run("update public.profiles set role = 'leader', county = null where user_id = $1", [IDS.stranger]), { commit: true });
      expect(ids(await rowsAs(STRANGER, "select id from public.flags_lean"))).toEqual(ALL_CURRENT);
      expectDenied(await attemptAs(STRANGER, NEW_FLAG, ["Lake"]));
    } finally {
      await db.actAs(ADMIN, (s) => s.run("delete from public.profiles where user_id = $1", [IDS.stranger]), { commit: true });
    }
    expect(await rowsAs(STRANGER, "select id from public.flags_lean")).toEqual([]);
  });

  it("a clerk has a county and nobody else does", async () => {
    const insert = "insert into public.profiles (user_id, role, county) values ($1, $2, $3)";
    expect(await attemptAs(ADMIN, insert, [IDS.stranger, "clerk", null])).toMatchObject({ ok: false, code: CHECK_VIOLATION });
    expect(await attemptAs(ADMIN, insert, [IDS.stranger, "leader", "Lake"])).toMatchObject({ ok: false, code: CHECK_VIOLATION });
    expect(await attemptAs(ADMIN, insert, [IDS.stranger, "clerk", "Cook"])).toMatchObject({ ok: false, code: CHECK_VIOLATION });
    expect(await attemptAs(ADMIN, insert, [IDS.stranger, "owner", null])).toMatchObject({ ok: false, code: CHECK_VIOLATION });
  });
});

describe("a signed-in user with no profile has no access anywhere", () => {
  it("reads zero rows from every table and view, or is refused", async () => {
    const relations = await db.admin("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by relname");
    expect(relations.length).toBe(9);
    for (const { relname } of relations) {
      const result = await attemptAs(STRANGER, `select count(*)::int as n from public.${String(relname)}`);
      if (result.ok) expect(result.rows, String(relname)).toEqual([{ n: 0 }]);
      else expect(result.code, String(relname)).toBe(DENIED);
    }
  });

  it("app_role() and app_county() are null for them", async () => {
    expect(await rowsAs(STRANGER, "select public.app_role() as role, public.app_county() as county")).toEqual([{ role: null, county: null }]);
    expect(await rowsAs(CLERK_A, "select public.app_role() as role, public.app_county() as county")).toEqual([{ role: "clerk", county: "Marion" }]);
    expectDenied(await attemptAs(ANON, "select public.app_role()"));
  });
});

describe("MCP tokens", () => {
  it.each(EVERYONE)("%s cannot read, add, change or look up tokens", async (_name, actor) => {
    expectDenied(await attemptAs(actor, "select token_hash from public.mcp_tokens"));
    expectDenied(await attemptAs(actor, "select count(*) from public.mcp_tokens"));
    expectDenied(await attemptAs(actor, "insert into public.mcp_tokens (token_hash, user_id) values ($1, $2)", ["c".repeat(64), IDS.admin]));
    expectDenied(await attemptAs(actor, "update public.mcp_tokens set revoked_at = null"));
    expectDenied(await attemptAs(actor, "delete from public.mcp_tokens"));
    expectDenied(await attemptAs(actor, "select * from public.mcp_token_user($1)", [TOKEN_HASH]));
    expectDenied(await attemptAs(actor, "select * from public.mcp_flags($1)", [TOKEN_HASH]));
    expectDenied(await attemptAs(actor, "select * from public.mcp_change_events($1)", [TOKEN_HASH]));
  });

  it("the service role resolves a live token to its user, and only through the lookup function", async () => {
    expect(await rowsAs(SERVICE, "select * from public.mcp_token_user($1)", [TOKEN_HASH])).toEqual([
      { token_hash: TOKEN_HASH, user_id: IDS.leader, email: "leader@example.invalid", role: "leader", county: null },
    ]);
    expect(await rowsAs(SERVICE, "select * from public.mcp_token_user($1)", [REVOKED_TOKEN_HASH])).toEqual([]);
    expect(await rowsAs(SERVICE, "select * from public.mcp_token_user($1)", ["d".repeat(64)])).toEqual([]);
    expectDenied(await attemptAs(SERVICE, "select token_hash from public.mcp_tokens"));
  });

  it("a token reads the flags its holder may read, without free text, and the change events", async () => {
    const leaderFlags = await rowsAs(SERVICE, "select * from public.mcp_flags($1)", [TOKEN_HASH]);
    expect(ids(leaderFlags)).toEqual(ALL_CURRENT);
    expect(Object.keys(leaderFlags[0]).sort()).toEqual(["batch_id", "case_type", "county", "created_at", "created_by", "filed_on", "form", "id", "outcome", "seq", "source", "tags"]);
    expect(ids(await rowsAs(SERVICE, "select id from public.mcp_flags($1)", [CLERK_TOKEN_HASH]))).toEqual(MARION_CURRENT);
    expect(ids(await rowsAs(SERVICE, "select id from public.mcp_change_events($1)", [CLERK_TOKEN_HASH]))).toEqual(["event-1"]);
  });

  it("a revoked or unknown token reads nothing", async () => {
    for (const hash of [REVOKED_TOKEN_HASH, "d".repeat(64), ""]) {
      expect(await rowsAs(SERVICE, "select id from public.mcp_flags($1)", [hash])).toEqual([]);
      expect(await rowsAs(SERVICE, "select id from public.mcp_change_events($1)", [hash])).toEqual([]);
    }
  });

  it("a token whose user has lost their profile resolves to nobody and reads nothing", async () => {
    await db.admin("delete from public.profiles where user_id = $1", [IDS.leader]);
    try {
      expect(await rowsAs(SERVICE, "select * from public.mcp_token_user($1)", [TOKEN_HASH])).toEqual([]);
      expect(await rowsAs(SERVICE, "select id from public.mcp_flags($1)", [TOKEN_HASH])).toEqual([]);
      expect(await rowsAs(SERVICE, "select id from public.mcp_change_events($1)", [TOKEN_HASH])).toEqual([]);
    } finally {
      await db.admin("insert into public.profiles (user_id, role) values ($1, 'leader')", [IDS.leader]);
    }
  });
});
