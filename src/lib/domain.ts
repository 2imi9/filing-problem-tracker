// Reference lists and core types. Pure: no I/O, no environment, safe in the browser, on the server and in tests.
// County names are real Indiana counties. Everything else in the shipped data is made up.

export const COUNTIES = [
  "Marion",
  "Lake",
  "Allen",
  "Hamilton",
  "St. Joseph",
  "Vanderburgh",
  "Monroe",
  "Tippecanoe",
] as const;
export type County = (typeof COUNTIES)[number];

/** Case type -> the forms a self-represented filer uses for it. */
export const CASES = {
  "Small claims": ["Small claims notice of claim", "Small claims counterclaim"],
  "Protective order": ["Petition for order of protection", "Petition to modify or extend order"],
  Family: [
    "Petition for dissolution, no children",
    "Petition for dissolution, with children",
    "Petition to modify child support",
  ],
  Eviction: ["Tenant answer or request for hearing"],
  "Name change": ["Petition for change of name"],
} as const;
export type CaseType = keyof typeof CASES;
export type Form = (typeof CASES)[CaseType][number];

export const CASE_TYPES = Object.keys(CASES) as CaseType[];
export const FORMS: Form[] = CASE_TYPES.flatMap((caseType) => [...CASES[caseType]]);

export const TAGS = [
  "Missing signature",
  "Wrong form",
  "Wrong county or court",
  "Missing required details",
  "Missing fee or fee waiver",
  "Citation not found or wrong",
  "Missing addresses for service",
  "Not verified or notarized",
  "Pages missing or unreadable",
] as const;
export type Tag = (typeof TAGS)[number];

/** Marker for imported rows that no rule (or the AI) could sort. A person reviews these. */
export const NEEDS_REVIEW = "Needs review";
/** A value that can appear in a stored flag's `tags`: one of TAGS, or the Needs review marker. */
export type FlagTag = Tag | typeof NEEDS_REVIEW;

export const OUTCOMES = ["Rejected", "Returned to fix", "Fixed at counter"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type Role = "clerk" | "leader" | "admin";
export const ROLES: readonly Role[] = ["clerk", "leader", "admin"];

export type Source = "sample" | "clerk" | "import";
export type AppMode = "demo" | "supabase";

/** Earliest filing date the tracker accepts. */
export const MIN_DATE = "2020-01-01";
export const NOTE_MAX = 200;
export const REASON_MAX = 500;

/** One flagged filing. Holds nothing that identifies a litigant: no names, no case numbers. */
export interface FlagRecord {
  id: string;
  /** Filing date, YYYY-MM-DD. */
  date: string;
  county: County;
  caseType: CaseType;
  form: Form;
  tags: FlagTag[];
  outcome: Outcome;
  source: Source;
  /** Import batch this row came from, or null. */
  batchId: string | null;
  /** User id of the person who entered it, or null for sample rows. */
  createdBy: string | null;
  /** ISO timestamp of when the row was entered. */
  createdAt: string;
  /** Optional clerk note, checked for personal data before it is saved. */
  note: string | null;
  /** The clerk's raw rejection reason on imported rows. */
  reason: string | null;
}

/** A flag without the free text. This is what dashboards, leaders, the AI summary and the MCP tools work from. */
export type LeanFlag = Omit<FlagRecord, "note" | "reason">;

/** A change a court made (a revised form, a guide, a kiosk) that the before/after panel measures. */
export interface ChangeEvent {
  id: string;
  name: string;
  /** The day the change took effect, YYYY-MM-DD. */
  date: string;
  county: County;
  caseType: CaseType;
  /** The problem the change was meant to reduce. */
  tag: Tag;
  description: string;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  /** A clerk's county. Null for leaders and admins. */
  county: County | null;
}

export type AuditAction =
  | "flag.create"
  | "flag.delete"
  | "flag.restore"
  | "import.commit"
  | "event.save"
  | "event.delete"
  | "folder.save"
  | "folder.delete"
  | "auth.login"
  | "auth.logout"
  | "demo.login"
  | "demo.logout"
  | "demo.reset";

export type AuditEntity = "flag" | "import_batch" | "event" | "folder" | "session" | "demo_data";

/** Audit detail holds counts and reference values only. Never note text, never raw reasons. */
export type AuditDetail = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  userId: string;
  role: Role;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string | null;
  detail: AuditDetail;
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const isCounty = (value: unknown): value is County => includes(COUNTIES, value);
export const isCaseType = (value: unknown): value is CaseType => includes(CASE_TYPES, value);
export const isForm = (value: unknown): value is Form => includes(FORMS, value);
export const isTag = (value: unknown): value is Tag => includes(TAGS, value);
export const isFlagTag = (value: unknown): value is FlagTag => value === NEEDS_REVIEW || isTag(value);
export const isOutcome = (value: unknown): value is Outcome => includes(OUTCOMES, value);

/** The forms that belong to a case type. */
export function formsFor(caseType: CaseType): readonly Form[] {
  return CASES[caseType];
}

/** The case type a form belongs to. Every form belongs to exactly one. */
export function caseTypeOfForm(form: Form): CaseType {
  const found = CASE_TYPES.find((caseType) => includes(CASES[caseType], form));
  if (!found) throw new Error(`Unknown form: ${form}`);
  return found;
}

/** True when the form is one of the forms listed for the case type. */
export function formMatchesCaseType(form: Form, caseType: CaseType): boolean {
  return includes(CASES[caseType], form);
}

/** Drops the free text from a full record. */
export function toLean(record: FlagRecord): LeanFlag {
  return {
    id: record.id,
    date: record.date,
    county: record.county,
    caseType: record.caseType,
    form: record.form,
    tags: [...record.tags],
    outcome: record.outcome,
    source: record.source,
    batchId: record.batchId,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
  };
}
