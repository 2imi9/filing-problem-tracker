// Fails when the SQL and the TypeScript disagree about what a valid value is.
// The lists live in SQL functions (migration 1) and are compared with src/lib directly. The length and
// date limits are checked by behavior: the largest value the app allows is accepted, the next one is not.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_CSV_ROWS } from "@/lib/csv";
import { CASES, COUNTIES, MIN_DATE, NEEDS_REVIEW, NOTE_MAX, OUTCOMES, REASON_MAX, ROLES, TAGS } from "@/lib/domain";
import type { AuditAction, AuditEntity, Source } from "@/lib/domain";
import {
  BATCH_NAME_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_NAME_MAX,
  FOLDER_NAME_MAX,
  FOLDER_PANELS_MAX,
  ID_MAX,
  ImportRow,
  NewFlagInput,
} from "@/lib/schemas";
import { APP_TIME_ZONE, todayIso } from "@/lib/time";
import { LIMITS } from "@/server/config";
import { hashMcpToken } from "@/server/mcp/tokens";
import { IDS, loadFixtures } from "./fixtures";
import { CHECK_VIOLATION, createTestDatabase } from "./harness";
import type { TestDatabase } from "./harness";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await loadFixtures(db);
});

afterAll(async () => {
  await db.close();
});

/** Runs an insert as the superuser inside a transaction that is rolled back. Check constraints apply to everyone. */
async function accepts(sql: string, params: unknown[] = []): Promise<boolean> {
  await db.adminScript("begin");
  try {
    await db.admin(sql, params);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code !== CHECK_VIOLATION) throw error;
    return false;
  } finally {
    await db.adminScript("rollback");
  }
}

// Every member of these unions, kept complete by the compiler: adding one to domain.ts without adding
// it here is a type error.
const SOURCES: Record<Source, true> = { sample: true, clerk: true, import: true };
const AUDIT_ACTIONS: Record<AuditAction, true> = {
  "flag.create": true,
  "flag.delete": true,
  "flag.restore": true,
  "import.commit": true,
  "event.save": true,
  "event.delete": true,
  "folder.save": true,
  "folder.delete": true,
  "auth.login": true,
  "auth.logout": true,
  "demo.login": true,
  "demo.logout": true,
  "demo.reset": true,
};
const AUDIT_ENTITIES: Record<AuditEntity, true> = { flag: true, import_batch: true, event: true, folder: true, session: true, demo_data: true };

describe("reference lists", () => {
  it("match src/lib/domain.ts exactly, in order", async () => {
    const [row] = await db.admin(`
      select public.app_roles() as roles, public.app_counties() as counties, public.app_case_forms() as cases,
             public.app_tags() as tags, public.app_needs_review() as needs_review, public.app_outcomes() as outcomes,
             public.app_sources() as sources, public.app_min_date()::text as min_date, public.app_time_zone() as time_zone`);
    expect(row.roles).toEqual([...ROLES]);
    expect(row.counties).toEqual([...COUNTIES]);
    expect(row.cases).toEqual(CASES);
    expect(row.tags).toEqual([...TAGS]);
    expect(row.needs_review).toBe(NEEDS_REVIEW);
    expect(row.outcomes).toEqual([...OUTCOMES]);
    expect([...(row.sources as string[])].sort()).toEqual(Object.keys(SOURCES).sort());
    expect(row.min_date).toBe(MIN_DATE);
    expect(row.time_zone).toBe(APP_TIME_ZONE);
  });

  it("the limits match src/server/config.ts", async () => {
    const [row] = await db.admin("select extract(epoch from public.app_delete_window())::int * 1000 as window_ms, public.app_folder_limit() as folders");
    expect(row.window_ms).toBe(LIMITS.softDeleteWindowMs);
    expect(row.folders).toBe(LIMITS.foldersPerUser);
  });

  it("the database's today is the app's today", async () => {
    const [row] = await db.admin("select public.app_today()::text as today, now() as now");
    expect(row.today).toBe(todayIso("supabase", row.now as Date));
  });
});

describe("filing_flags limits", () => {
  const flag = (column: string) =>
    `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, source, batch_id, ${column})
     values ('Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected', $1, $2, $3)`;

  it("a note can be NOTE_MAX characters and no longer", async () => {
    expect(await accepts(flag("note"), ["clerk", null, "n".repeat(NOTE_MAX)])).toBe(true);
    expect(await accepts(flag("note"), ["clerk", null, "n".repeat(NOTE_MAX + 1)])).toBe(false);
  });

  it("a reason can be REASON_MAX characters and no longer", async () => {
    expect(await accepts(flag("reason"), ["import", IDS.batchA, "r".repeat(REASON_MAX)])).toBe(true);
    expect(await accepts(flag("reason"), ["import", IDS.batchA, "r".repeat(REASON_MAX + 1)])).toBe(false);
  });

  it("notes and reasons are stored the way the app writes them: one line, single spaces, not blank", async () => {
    for (const text of ["", " ", " leading", "trailing ", "two  spaces", "two\nlines", "a\ttab"]) {
      expect(await accepts(flag("note"), ["clerk", null, text]), JSON.stringify(text)).toBe(false);
      expect(await accepts(flag("reason"), ["import", IDS.batchA, text]), JSON.stringify(text)).toBe(false);
    }
  });

  it("the date runs from MIN_DATE to today", async () => {
    const dated = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome)
      values ('Marion', $1::date, 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected')`;
    expect(await accepts(dated, [MIN_DATE])).toBe(true);
    expect(await accepts(`${dated.replace("$1::date", "$1::date - 1")}`, [MIN_DATE])).toBe(false);
    const [{ today }] = await db.admin("select public.app_today()::text as today");
    expect(await accepts(dated, [today])).toBe(true);
    expect(await accepts(`${dated.replace("$1::date", "$1::date + 1")}`, [today])).toBe(false);
  });

  it("every county, form, problem and outcome on the lists is accepted, and the form must belong to the case type", async () => {
    const insert = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome)
      values ($1, '2024-04-01', $2, $3, $4, $5)`;
    for (const county of COUNTIES) expect(await accepts(insert, [county, "Eviction", CASES.Eviction[0], [TAGS[0]], OUTCOMES[0]]), county).toBe(true);
    for (const [caseType, forms] of Object.entries(CASES)) {
      for (const form of forms) {
        expect(await accepts(insert, ["Marion", caseType, form, [TAGS[0]], OUTCOMES[0]]), form).toBe(true);
        for (const other of Object.keys(CASES).filter((name) => name !== caseType)) {
          expect(await accepts(insert, ["Marion", other, form, [TAGS[0]], OUTCOMES[0]]), `${other} / ${form}`).toBe(false);
        }
      }
    }
    for (const tag of TAGS) expect(await accepts(insert, ["Marion", "Eviction", CASES.Eviction[0], [tag], OUTCOMES[0]]), tag).toBe(true);
    for (const outcome of OUTCOMES) expect(await accepts(insert, ["Marion", "Eviction", CASES.Eviction[0], [TAGS[0]], outcome]), outcome).toBe(true);
    expect(await accepts(insert, ["Marion", "Eviction", CASES.Eviction[0], [...TAGS], OUTCOMES[0]])).toBe(true);
    expect(await accepts(insert, ["Cook", "Eviction", CASES.Eviction[0], [TAGS[0]], OUTCOMES[0]])).toBe(false);
  });

  it("the database and the app's schemas agree on the same inputs", async () => {
    const base = { date: "2024-04-01", county: "Marion", caseType: "Family", form: "Petition to modify child support", outcome: "Rejected" };
    const cases: { name: string; tags: string[]; change?: Record<string, string> }[] = [
      { name: "one problem", tags: ["Wrong form"] },
      { name: "three problems", tags: ["Wrong form", "Missing signature", "Not verified or notarized"] },
      { name: "no problems", tags: [] },
      { name: "the same problem twice", tags: ["Wrong form", "Wrong form"] },
      { name: "a problem not on the list", tags: ["Wrong color ink"] },
      { name: "needs review alone", tags: [NEEDS_REVIEW] },
      { name: "needs review with a problem", tags: [NEEDS_REVIEW, "Wrong form"] },
      { name: "a form from another case type", tags: ["Wrong form"], change: { form: "Petition for change of name" } },
      { name: "a county not on the list", tags: ["Wrong form"], change: { county: "Cook" } },
      { name: "an outcome not on the list", tags: ["Wrong form"], change: { outcome: "Lost" } },
      { name: "a date before the first allowed", tags: ["Wrong form"], change: { date: "2019-06-01" } },
    ];
    const clerkInsert = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, source)
      values ($1, $2, $3, $4, $5, $6, 'clerk')`;
    const importInsert = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, source, batch_id)
      values ($1, $2, $3, $4, $5, 'Rejected', 'import', '${IDS.batchA}')`;
    for (const { name, tags, change } of cases) {
      const input = { ...base, ...change, tags };
      const asClerk = NewFlagInput.safeParse(input).success;
      expect(await accepts(clerkInsert, [input.county, input.date, input.caseType, input.form, tags, input.outcome]), `clerk entry: ${name}`).toBe(asClerk);
      if (change?.outcome) continue;
      const asImport = ImportRow.safeParse({ date: input.date, county: input.county, caseType: input.caseType, form: input.form, reason: "", tags }).success;
      expect(await accepts(importInsert, [input.county, input.date, input.caseType, input.form, tags]), `import row: ${name}`).toBe(asImport);
    }
  });

  it("an imported row has a batch, is rejected and has no note; other rows have no batch and no reason", async () => {
    const row = `insert into public.filing_flags (county, filed_on, case_type, form, tags, outcome, source, batch_id, note, reason)
      values ('Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], $1, $2, $3, $4, $5)`;
    expect(await accepts(row, ["Rejected", "import", IDS.batchA, null, "a reason"])).toBe(true);
    expect(await accepts(row, ["Rejected", "import", null, null, "a reason"])).toBe(false);
    expect(await accepts(row, ["Returned to fix", "import", IDS.batchA, null, "a reason"])).toBe(false);
    expect(await accepts(row, ["Rejected", "import", IDS.batchA, "a note", null])).toBe(false);
    expect(await accepts(row, ["Rejected", "clerk", IDS.batchA, null, null])).toBe(false);
    expect(await accepts(row, ["Rejected", "clerk", null, null, "a reason"])).toBe(false);
    expect(await accepts(row, ["Rejected", "sample", null, "a note", null])).toBe(false);
  });
});

describe("other limits", () => {
  it("an id can be ID_MAX characters and no longer", async () => {
    const flag = `insert into public.filing_flags (id, county, filed_on, case_type, form, tags, outcome)
      values ($1, 'Marion', '2024-04-01', 'Small claims', 'Small claims notice of claim', array['Missing signature'], 'Rejected')`;
    const event = "insert into public.change_events (id, name, event_date, county, case_type, tag) values ($1, 'n', '2024-04-01', 'Marion', 'Family', 'Wrong form')";
    const folder = `insert into public.workspace_folders (owner, id, name) values ('${IDS.clerkB}', $1, 'n')`;
    for (const sql of [flag, event, folder]) {
      expect(await accepts(sql, ["i".repeat(ID_MAX)])).toBe(true);
      expect(await accepts(sql, ["i".repeat(ID_MAX + 1)])).toBe(false);
      expect(await accepts(sql, [""])).toBe(false);
    }
  });

  it("a change's name and description have the app's limits, and its values come from the lists", async () => {
    const event = "insert into public.change_events (name, event_date, county, case_type, tag, description) values ($1, $2::date, $3, $4, $5, $6)";
    const ok = ["Revised form", "2024-04-01", "Marion", "Family", "Wrong form", ""];
    const withValue = (index: number, value: string) => ok.map((v, i) => (i === index ? value : v));
    expect(await accepts(event, ok)).toBe(true);
    expect(await accepts(event, withValue(0, "n".repeat(EVENT_NAME_MAX)))).toBe(true);
    expect(await accepts(event, withValue(0, "n".repeat(EVENT_NAME_MAX + 1)))).toBe(false);
    expect(await accepts(event, withValue(0, ""))).toBe(false);
    expect(await accepts(event, withValue(5, "d".repeat(EVENT_DESCRIPTION_MAX)))).toBe(true);
    expect(await accepts(event, withValue(5, "d".repeat(EVENT_DESCRIPTION_MAX + 1)))).toBe(false);
    expect(await accepts(event, withValue(1, "2019-12-31"))).toBe(false);
    expect(await accepts(event, withValue(2, "Cook"))).toBe(false);
    expect(await accepts(event, withValue(3, "Traffic"))).toBe(false);
    expect(await accepts(event, withValue(4, NEEDS_REVIEW))).toBe(false);
    expect(await accepts(event.replace("$2::date", "public.app_today() + 1 + ($2::date - $2::date)"), ok)).toBe(false);
  });

  it("a folder's name and panel count have the app's limits", async () => {
    const folder = `insert into public.workspace_folders (owner, id, name, panels) values ('${IDS.clerkB}', 'f', $1, $2::jsonb)`;
    const panels = (count: number) => JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `p${i}` })));
    expect(await accepts(folder, ["n".repeat(FOLDER_NAME_MAX), panels(FOLDER_PANELS_MAX)])).toBe(true);
    expect(await accepts(folder, ["n".repeat(FOLDER_NAME_MAX + 1), "[]"])).toBe(false);
    expect(await accepts(folder, ["", "[]"])).toBe(false);
    expect(await accepts(folder, ["n", panels(FOLDER_PANELS_MAX + 1)])).toBe(false);
    expect(await accepts(folder, ["n", "{}"])).toBe(false);
  });

  it("one person can keep LIMITS.foldersPerUser folders and no more", async () => {
    await db.adminScript("begin");
    try {
      await db.admin(
        `insert into public.workspace_folders (owner, id, name) select '${IDS.clerkB}', 'f' || n, 'Folder ' || n from generate_series(1, $1::int) as n`,
        [LIMITS.foldersPerUser],
      );
      await expect(db.admin(`insert into public.workspace_folders (owner, id, name) values ('${IDS.clerkB}', 'one-more', 'One more')`)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    } finally {
      await db.adminScript("rollback");
    }
  });

  it("an import batch's name and size have the app's limits", async () => {
    const batch = "insert into public.import_batches (name, row_count) values ($1, $2)";
    expect(await accepts(batch, ["n".repeat(BATCH_NAME_MAX), MAX_CSV_ROWS])).toBe(true);
    expect(await accepts(batch, ["n".repeat(BATCH_NAME_MAX + 1), 1])).toBe(false);
    expect(await accepts(batch, ["n", MAX_CSV_ROWS + 1])).toBe(false);
    expect(await accepts(batch, ["n", 0])).toBe(false);
  });

  it("every audit action and entity the app writes fits the audit log", async () => {
    const entry = `insert into public.audit_log (user_id, role, action, entity) values ('${IDS.admin}', 'admin', $1, $2)`;
    for (const action of Object.keys(AUDIT_ACTIONS)) expect(await accepts(entry, [action, "flag"]), action).toBe(true);
    for (const entity of Object.keys(AUDIT_ENTITIES)) expect(await accepts(entry, ["flag.create", entity]), entity).toBe(true);
    expect(await accepts(entry, ["Flag Create", "flag"])).toBe(false);
    expect(await accepts(entry, ["flag.create", "a flag"])).toBe(false);
    expect(await accepts(`insert into public.audit_log (user_id, role, action, entity, detail) values ('${IDS.admin}', 'admin', 'flag.create', 'flag', $1::jsonb)`, ["[]"])).toBe(false);
  });

  it("a token hashed in SQL the way the quickstart says is the hash the app looks up", async () => {
    const token = "an-example-token-0123456789-abcdefghij";
    const [row] = await db.admin("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as hash", [token]);
    expect(row.hash).toBe(hashMcpToken(token));
  });

  it("a token is stored as a SHA-256 hash and nothing else", async () => {
    const token = `insert into public.mcp_tokens (token_hash, user_id) values ($1, '${IDS.admin}')`;
    expect(await accepts(token, ["e".repeat(64)])).toBe(true);
    expect(await accepts(token, ["a-plain-token-not-a-hash"])).toBe(false);
    expect(await accepts(token, ["E".repeat(64)])).toBe(false);
  });
});
