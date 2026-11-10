import type { CaseType, ChangeEvent, County, FlagRecord, FlagTag, Form, Outcome, Source } from "@/lib/domain";

let counter = 0;

/** A full record with sensible defaults, for tests. */
export function flag(
  date: string,
  county: County,
  caseType: CaseType,
  form: Form,
  tags: FlagTag[],
  outcome: Outcome,
  extra: Partial<FlagRecord> = {},
): FlagRecord {
  counter += 1;
  const source: Source = "sample";
  return {
    id: `f${counter}`,
    date,
    county,
    caseType,
    form,
    tags,
    outcome,
    source,
    batchId: null,
    createdBy: null,
    createdAt: `${date}T12:00:00.000Z`,
    note: null,
    reason: null,
    ...extra,
  };
}

const NOTICE: Form = "Small claims notice of claim";

/**
 * Ten hand-made filings. The expectations in the tests are worked out by hand from this list.
 *
 *  1 Jan 10  Marion  Small claims      notice        Missing signature                         Rejected
 *  2 Jan 20  Marion  Small claims      notice        Missing signature, Wrong form             Returned to fix
 *  3 Feb 05  Marion  Small claims      counterclaim  Missing signature                         Fixed at counter
 *  4 Feb 15  Lake    Family            dissolution   Wrong form                                Rejected
 *  5 Mar 03  Marion  Small claims      notice        Missing signature, Missing fee, Wrong form Rejected
 *  6 Mar 20  Lake    Protective order  petition      Missing required details                  Returned to fix
 *  7 Apr 02  Marion  Small claims      notice        Missing fee                               Rejected
 *  8 May 11  Marion  Small claims      notice        Missing signature                         Fixed at counter
 *  9 Jun 09  Allen   Family            child support Needs review (imported)                   Rejected
 * 10 Jun 20  Marion  Small claims      notice        Wrong county or court                     Rejected
 */
export const FIXTURE: FlagRecord[] = [
  flag("2026-01-10", "Marion", "Small claims", NOTICE, ["Missing signature"], "Rejected"),
  flag("2026-01-20", "Marion", "Small claims", NOTICE, ["Missing signature", "Wrong form"], "Returned to fix"),
  flag("2026-02-05", "Marion", "Small claims", "Small claims counterclaim", ["Missing signature"], "Fixed at counter"),
  flag("2026-02-15", "Lake", "Family", "Petition for dissolution, no children", ["Wrong form"], "Rejected"),
  flag("2026-03-03", "Marion", "Small claims", NOTICE, ["Missing signature", "Missing fee or fee waiver", "Wrong form"], "Rejected"),
  flag("2026-03-20", "Lake", "Protective order", "Petition for order of protection", ["Missing required details"], "Returned to fix"),
  flag("2026-04-02", "Marion", "Small claims", NOTICE, ["Missing fee or fee waiver"], "Rejected"),
  flag("2026-05-11", "Marion", "Small claims", NOTICE, ["Missing signature"], "Fixed at counter"),
  flag("2026-06-09", "Allen", "Family", "Petition to modify child support", ["Needs review"], "Rejected", { source: "import" }),
  flag("2026-06-20", "Marion", "Small claims", NOTICE, ["Wrong county or court"], "Rejected"),
];

/** "Today" for the fixture: June is the month in progress. */
export const FIXTURE_TODAY = "2026-06-25";

/** A change that took effect on the first of a month. */
export const EVENT_APRIL_1: ChangeEvent = {
  id: "ev-apr",
  name: "New signature box (Marion, Apr 1)",
  date: "2026-04-01",
  county: "Marion",
  caseType: "Small claims",
  tag: "Missing signature",
  description: "Test change.",
};

/** A change that took effect in the middle of a month. */
export const EVENT_MARCH_15: ChangeEvent = { ...EVENT_APRIL_1, id: "ev-mar", name: "Mid-month change", date: "2026-03-15" };
