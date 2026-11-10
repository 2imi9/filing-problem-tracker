// supabase/seed.sql is generated from the sample data. These tests fail when the committed file is not
// what the generator produces, and they load it into the real schema to prove the SQL sample data is
// the demo's sample data, record for record.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toLean } from "@/lib/domain";
import type { SessionUser } from "@/lib/domain";
import { SAMPLE_EVENTS, makeSampleRecords } from "@/lib/sample";
import { countTags } from "@/lib/stats";
import { createGatewayRepository } from "@/server/repo/supabase";
import { buildSeedSql } from "../../scripts/gen-seed";
import { createTestDatabase } from "./harness";
import type { TestDatabase } from "./harness";
import { createPgliteGateway } from "./pgliteGateway";

const SEED_FILE = fileURLToPath(new URL("../../supabase/seed.sql", import.meta.url));
const LEADER_ID = "00000000-0000-4000-8000-0000000000f1";
const CLERK_ID = "00000000-0000-4000-8000-0000000000f2";

const seed = readFileSync(SEED_FILE, "utf8");
const records = makeSampleRecords();

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  // As on Supabase: the seed runs as the project owner, after the migrations.
  await db.ownerScript(seed);
});

afterAll(async () => {
  await db.close();
});

describe("supabase/seed.sql", () => {
  it("is exactly what scripts/gen-seed.ts produces from src/lib/sample.ts (run `npm run seed:gen` if this fails)", () => {
    expect(seed).toBe(buildSeedSql(records, SAMPLE_EVENTS));
  });

  it("loads the sample changes and every sample filing, with no author, note or reason", async () => {
    const [counts] = await db.admin(`
      select
        (select count(*)::int from public.filing_flags) as flags,
        (select count(*)::int from public.change_events) as events,
        (select count(*)::int from public.filing_flags where source <> 'sample' or created_by is not null or note is not null or reason is not null or deleted_at is not null) as not_plain`);
    expect(counts).toEqual({ flags: records.length, events: SAMPLE_EVENTS.length, not_plain: 0 });
  });

  it("creates no accounts, profiles, folders, tokens or audit entries", async () => {
    const [counts] = await db.admin(`
      select
        (select count(*)::int from auth.users) as users,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.workspace_folders) as folders,
        (select count(*)::int from public.mcp_tokens) as tokens,
        (select count(*)::int from public.audit_log) as audit`);
    expect(counts).toEqual({ users: 0, profiles: 0, folders: 0, tokens: 0, audit: 0 });
  });

  it("read back through the repository, it is the demo's sample data record for record", async () => {
    await db.admin("insert into auth.users (id, email) values ($1, 'leader@example.invalid'), ($2, 'clerk@example.invalid')", [LEADER_ID, CLERK_ID]);
    await db.admin("insert into public.profiles (user_id, role, county) values ($1, 'leader', null), ($2, 'clerk', 'Marion')", [LEADER_ID, CLERK_ID]);
    const leader: SessionUser = { id: LEADER_ID, email: "leader@example.invalid", role: "leader", county: null };
    const clerk: SessionUser = { id: CLERK_ID, email: "clerk@example.invalid", role: "clerk", county: "Marion" };
    const repoFor = (session: SessionUser) =>
      createGatewayRepository(session, createPgliteGateway(db, { role: "authenticated", userId: session.id }, { maxRows: 400 }), { today: () => "2026-12-31" });

    const flags = await repoFor(leader).listFlags();
    expect(flags).toEqual(records.map(toLean));
    expect(countTags(flags)).toEqual(countTags(records));
    expect(await repoFor(leader).listEvents()).toEqual(SAMPLE_EVENTS);

    const marion = await repoFor(clerk).listFlags();
    expect(marion).toEqual(records.filter((record) => record.county === "Marion").map(toLean));
    expect(await repoFor(clerk).listNeedsReview()).toEqual([]);
  });
});
