// Made-up sample data. The generator is the one from the single-file prototype: same seed, same weights and
// the same order of random draws, so the numbers match it record for record.

import { CASES, CASE_TYPES, COUNTIES, OUTCOMES, TAGS } from "./domain";
import type { CaseType, ChangeEvent, County, FlagRecord, Form, Outcome, Role, SessionUser, Tag } from "./domain";

/** The sample data runs from Jan 1 to Oct 28, 2026. The demo treats Oct 30, 2026 as today. */
export const SAMPLE_TODAY = "2026-10-30";
export const SAMPLE_SEED = 4535;
export const SAMPLE_SIZE = 900;

const COUNTY_W = [9, 5, 4, 3.5, 3, 2.2, 1.6, 1.8];
const CASE_W = [6, 3, 4, 2.5, 1];
const OUTCOME_W = [4, 4, 2];

// How likely each problem is for each case type (sample weights, same order as TAGS).
const TAG_W: Record<CaseType, number[]> = {
  "Small claims": [6, 2, 4, 5, 3, 1, 4, 1, 1],
  "Protective order": [4, 2, 2, 7, 0.3, 1, 3, 3, 1],
  Family: [4, 4, 2, 5, 3, 1.5, 2, 4, 2],
  Eviction: [3, 3, 3, 4, 1, 2.5, 1, 1, 1],
  "Name change": [3, 2, 2, 3, 3, 0.3, 1, 3, 1],
};

/** The three made-up changes the before/after panel measures. */
export const SAMPLE_EVENTS: ChangeEvent[] = [
  {
    id: "sc-form",
    name: "Revised small claims form (Marion, Jun 1)",
    date: "2026-06-01",
    county: "Marion",
    caseType: "Small claims",
    tag: "Missing signature",
    description:
      "Sample change: Marion County small claims court adds a clearer signature box and a one-page checklist to its notice of claim form on June 1, 2026.",
  },
  {
    id: "po-guide",
    name: "Protective order guide (Lake, Jul 15)",
    date: "2026-07-15",
    county: "Lake",
    caseType: "Protective order",
    tag: "Missing required details",
    description:
      "Sample change: Lake County starts giving filers a short guide that explains what details a protective order petition needs, starting July 15, 2026.",
  },
  {
    id: "fam-kiosk",
    name: "Self-help kiosk (Allen, Aug 1)",
    date: "2026-08-01",
    county: "Allen",
    caseType: "Family",
    tag: "Wrong form",
    description:
      "Sample change: Allen County puts a form-finder kiosk in the clerk's lobby for family cases on August 1, 2026.",
  },
];

// How much the targeted problem drops in the sample data once each change takes effect.
const EVENT_FACTOR: Record<string, number> = { "sc-form": 0.35, "po-guide": 0.45, "fam-kiosk": 0.55 };

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The prototype built its dates in the browser's local time. These constants reproduce an Indiana (Eastern
// time) browser exactly, on any machine: local midnight Jan 1 and Oct 28, and the 2026 daylight saving start.
const HOUR_MS = 3_600_000;
const RANGE_START = Date.UTC(2026, 0, 1, 5);
const RANGE_END = Date.UTC(2026, 9, 28, 4);
const DAYLIGHT_START = Date.UTC(2026, 2, 8, 7);

function easternDate(utcMs: number): string {
  const local = new Date(utcMs - (utcMs >= DAYLIGHT_START ? 4 : 5) * HOUR_MS);
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${local.getUTCFullYear()}-${month}-${day}`;
}

/** 900 made-up flagged filings, Jan 1 to Oct 28, 2026. Deterministic: every call returns the same records. */
export function makeSampleRecords(): FlagRecord[] {
  const rnd = mulberry32(SAMPLE_SEED);
  const pickW = <T,>(items: readonly T[], weights: readonly number[]): T => {
    let total = 0;
    for (const w of weights) total += w;
    let r = rnd() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  const records: FlagRecord[] = [];
  for (let k = 0; k < SAMPLE_SIZE; k++) {
    const date = easternDate(RANGE_START + rnd() * (RANGE_END - RANGE_START));
    const county: County = pickW(COUNTIES, COUNTY_W);
    const caseType: CaseType = pickW(CASE_TYPES, CASE_W);
    const forms: readonly Form[] = CASES[caseType];
    const form = forms[Math.floor(rnd() * forms.length)];
    const weights = TAG_W[caseType].slice();
    for (const event of SAMPLE_EVENTS) {
      if (county === event.county && caseType === event.caseType && date >= event.date) {
        weights[TAGS.indexOf(event.tag)] *= EVENT_FACTOR[event.id];
      }
    }
    const tagCount = rnd() < 0.55 ? 1 : rnd() < 0.75 ? 2 : 3;
    const tags: Tag[] = [];
    let guard = 0;
    while (tags.length < tagCount && guard++ < 20) {
      const tag = pickW(TAGS, weights);
      if (!tags.includes(tag)) tags.push(tag);
    }
    const outcome: Outcome = pickW(OUTCOMES, OUTCOME_W);
    records.push({
      id: `s${k}`,
      date,
      county,
      caseType,
      form,
      tags,
      outcome,
      source: "sample",
      batchId: null,
      createdBy: null,
      createdAt: `${date}T12:00:00.000Z`,
      note: null,
      reason: null,
    });
  }
  return records;
}

interface SampleCsvRow {
  date: string;
  county: County;
  caseType: CaseType;
  form: Form;
  reason: string;
}

const SAMPLE_CSV_ROWS: SampleCsvRow[] = [
  { date: "2026-09-02", county: "Hamilton", caseType: "Small claims", form: "Small claims notice of claim", reason: "no signature on page 2" },
  { date: "2026-09-03", county: "Hamilton", caseType: "Small claims", form: "Small claims notice of claim", reason: "Filed in wrong county - defendant lives in Marion" },
  { date: "2026-09-05", county: "Monroe", caseType: "Family", form: "Petition for dissolution, with children", reason: "not notarized; fee waiver form missing" },
  { date: "2026-09-08", county: "Tippecanoe", caseType: "Eviction", form: "Tenant answer or request for hearing", reason: "cites a case that does not exist (possible AI)" },
  { date: "2026-09-10", county: "Vanderburgh", caseType: "Protective order", form: "Petition for order of protection", reason: "needs dates and description of incidents" },
  { date: "2026-09-11", county: "St. Joseph", caseType: "Family", form: "Petition to modify child support", reason: "used old version of form" },
  { date: "2026-09-12", county: "Monroe", caseType: "Small claims", form: "Small claims counterclaim", reason: "no address for defendant; unsigned" },
  { date: "2026-09-15", county: "Hamilton", caseType: "Name change", form: "Petition for change of name", reason: "called filer - will bring in tomorrow" },
  { date: "2026-09-16", county: "Vanderburgh", caseType: "Small claims", form: "Small claims notice of claim", reason: "filing fee not paid" },
  { date: "2026-09-18", county: "St. Joseph", caseType: "Eviction", form: "Tenant answer or request for hearing", reason: "page 3 missing / scan unreadable" },
];

const csvField = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * The example export shown on the Import page. With a county, every row is written for that county, so a
 * clerk (who can only add rows for their own county) gets an example that works for them.
 */
export function sampleCsv(county?: County): string {
  const lines = SAMPLE_CSV_ROWS.map((row) =>
    [row.date, county ?? row.county, row.caseType, row.form, row.reason].map(csvField).join(","),
  );
  return ["date,county,case_type,form,reason", ...lines].join("\n");
}

/** The prototype's example export, with rows from several counties. */
export const SAMPLE_CSV = sampleCsv();

export interface DemoUser extends SessionUser {
  /** Shown on the demo sign-in page. */
  label: string;
}

/** The fixed demo accounts. They are roles, not people. */
export const DEMO_USERS = [
  { id: "demo-clerk-marion", email: "clerk.marion@demo.invalid", role: "clerk", county: "Marion", label: "Clerk, Marion County" },
  { id: "demo-clerk-lake", email: "clerk.lake@demo.invalid", role: "clerk", county: "Lake", label: "Clerk, Lake County" },
  { id: "demo-leader", email: "leader@demo.invalid", role: "leader", county: null, label: "Court leader, all counties" },
  { id: "demo-admin", email: "admin@demo.invalid", role: "admin", county: null, label: "Administrator" },
] as const satisfies readonly DemoUser[];

export type DemoUserId = (typeof DEMO_USERS)[number]["id"];
export const DEMO_USER_IDS = DEMO_USERS.map((user) => user.id) as [DemoUserId, ...DemoUserId[]];

/** The demo account with this id, without the label, or null. */
export function demoUserById(id: string): SessionUser | null {
  const found = DEMO_USERS.find((user) => user.id === id);
  if (!found) return null;
  const role: Role = found.role;
  return { id: found.id, email: found.email, role, county: found.county };
}
