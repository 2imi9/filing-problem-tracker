// Zod schemas for everything that crosses a boundary: request bodies, imported rows, saved folders and
// panel specs. Every value is checked against the reference lists in domain.ts.
//
// "Not in the future" needs today's date, and src/lib never reads the clock, so the three schemas that
// carry a date come with a parse function that takes today as a parameter: parseNewFlagInput,
// parseImportRow and parseChangeEventInput. Use those on anything that will be saved.

import { z } from "zod";
import {
  CASE_TYPES,
  COUNTIES,
  MIN_DATE,
  NEEDS_REVIEW,
  NOTE_MAX,
  OUTCOMES,
  REASON_MAX,
  FORMS,
  TAGS,
  formMatchesCaseType,
} from "./domain";
import type { CaseType, Form } from "./domain";
import { isIsoDate, isMonth } from "./time";

export const EVENT_NAME_MAX = 80;
export const EVENT_DESCRIPTION_MAX = 300;
export const FOLDER_NAME_MAX = 60;
export const FOLDER_PANELS_MAX = 24;
export const PANEL_TITLE_MAX = 80;
export const BATCH_NAME_MAX = 80;
export const ID_MAX = 64;

const CountySchema = z.enum(COUNTIES, { error: "County is not on the list." });
const CaseTypeSchema = z.enum(CASE_TYPES as [CaseType, ...CaseType[]], { error: "Case type is not on the list." });
const FormSchema = z.enum(FORMS as [Form, ...Form[]], { error: "Form is not on the list." });
const TagSchema = z.enum(TAGS, { error: "Problem is not on the list." });
const FlagTagSchema = z.enum([...TAGS, NEEDS_REVIEW], { error: "Problem is not on the list." });
const OutcomeSchema = z.enum(OUTCOMES, { error: "Outcome is not on the list." });
const IdSchema = z.string().min(1).max(ID_MAX);

/** A real calendar date, YYYY-MM-DD, on or after MIN_DATE. */
export const IsoDate = z.string().superRefine((value, ctx) => {
  if (!isIsoDate(value)) {
    ctx.addIssue({ code: "custom", message: "Use a real date in the form YYYY-MM-DD." });
  } else if (value < MIN_DATE) {
    ctx.addIssue({ code: "custom", message: `The date cannot be before ${MIN_DATE}.` });
  }
});

const MonthSchema = z.string().refine(isMonth, { error: "Use a month in the form YYYY-MM." });

/** Free text on one line: runs of whitespace collapse to one space, ends are trimmed. */
function oneLine(max: number, label: string) {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, { error: `${label} can be at most ${max} characters.` }));
}

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

const formBelongsToCaseType = (value: { form: Form; caseType: CaseType }, ctx: z.RefinementCtx) => {
  if (!formMatchesCaseType(value.form, value.caseType)) {
    ctx.addIssue({ code: "custom", path: ["form"], message: `This form is not used for ${value.caseType}.` });
  }
};

/** What a clerk submits from Tag a filing. */
export const NewFlagInput = z
  .strictObject({
    date: IsoDate,
    county: CountySchema,
    caseType: CaseTypeSchema,
    form: FormSchema,
    tags: z
      .array(TagSchema)
      .min(1, { error: "Choose at least one problem." })
      .max(TAGS.length)
      .refine(unique, { error: "Each problem can be chosen once." }),
    outcome: OutcomeSchema,
    // A blank note is the same as no note.
    note: oneLine(NOTE_MAX, "The note")
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
  })
  .superRefine(formBelongsToCaseType);
export type NewFlagInput = z.output<typeof NewFlagInput>;

/** One reviewed row of an import, ready to save. */
export const ImportRow = z
  .strictObject({
    date: IsoDate,
    county: CountySchema,
    caseType: CaseTypeSchema,
    form: FormSchema,
    reason: oneLine(REASON_MAX, "The reason"),
    tags: z
      .array(FlagTagSchema)
      .min(1, { error: "Each row needs at least one problem, or Needs review." })
      .max(TAGS.length)
      .refine(unique, { error: "Each problem can be chosen once." })
      .refine((tags) => !tags.includes(NEEDS_REVIEW) || tags.length === 1, {
        error: "Needs review cannot be combined with other problems.",
      }),
  })
  .superRefine(formBelongsToCaseType);
export type ImportRow = z.output<typeof ImportRow>;

/** A change a court made. With an id it replaces that change; without one it adds a new change. */
export const ChangeEventInput = z.strictObject({
  id: IdSchema.optional(),
  name: oneLine(EVENT_NAME_MAX, "The name").pipe(z.string().min(1, { error: "Give the change a name." })),
  date: IsoDate,
  county: CountySchema,
  caseType: CaseTypeSchema,
  tag: TagSchema,
  description: oneLine(EVENT_DESCRIPTION_MAX, "The description"),
});
export type ChangeEventInput = z.output<typeof ChangeEventInput>;

/** Filters shared by the dashboard, every panel, the AI summary and the MCP tools. All optional. */
export const Filters = z.strictObject({
  county: CountySchema.optional(),
  caseType: CaseTypeSchema.optional(),
  form: FormSchema.optional(),
  tag: FlagTagSchema.optional(),
  fromMonth: MonthSchema.optional(),
  toMonth: MonthSchema.optional(),
});
export type Filters = z.output<typeof Filters>;

// ---------- Panels ----------
// The panel contract is described in panels.ts, which re-exports everything below. The schemas live here
// because FolderInput needs PanelSpec and panels.ts needs Filters.

export const PANEL_TYPES = [
  "kpi",
  "ranked",
  "heat",
  "forms",
  "trend",
  "before_after",
  "compare_counties",
  "needs_review",
] as const;
export type PanelType = (typeof PANEL_TYPES)[number];

export const PANEL_SIZES = ["s", "w", "l"] as const;
export type PanelSize = (typeof PANEL_SIZES)[number];

export const RANKED_DIMENSIONS = ["tag", "outcome", "county", "caseType", "form"] as const;
export type RankedDimension = (typeof RANKED_DIMENSIONS)[number];

export const RANKED_LIMIT_MAX = 20;
export const HEAT_TAGS_DEFAULT = 6;
export const HEAT_TAGS_MAX = TAGS.length + 1;

/** Headline numbers for the filtered filings. */
export const KpiParams = Filters;
/** A sorted bar list of one dimension. `limit` keeps the top N rows. */
export const RankedParams = Filters.extend({
  dimension: z.enum(RANKED_DIMENSIONS),
  limit: z.number().int().min(1).max(RANKED_LIMIT_MAX).optional(),
});
/** County by problem table. `maxTags` is how many problem columns to show (default 6). */
export const HeatParams = Filters.extend({
  maxTags: z.number().int().min(1).max(HEAT_TAGS_MAX).optional(),
});
/** One row per form. */
export const FormsParams = Filters;
/** Flagged filings per month. With a `tag` filter it counts filings that have that problem. */
export const TrendParams = Filters;
/** Before and after one change. The county and case type come from the change. `tag` defaults to the change's own. */
export const BeforeAfterParams = z.strictObject({
  eventId: IdSchema,
  tag: TagSchema.optional(),
});
/** Two or more counties side by side. With a `tag` it also counts filings that have that problem. */
export const CompareCountiesParams = Filters.omit({ county: true }).extend({
  counties: z
    .array(CountySchema)
    .min(2, { error: "Choose at least two counties." })
    .max(COUNTIES.length)
    .refine(unique, { error: "Each county can be chosen once." }),
});
/** Imported rows that still need a person to sort them. */
export const NeedsReviewParams = Filters.omit({ tag: true });

export type KpiParams = z.output<typeof KpiParams>;
export type RankedParams = z.output<typeof RankedParams>;
export type HeatParams = z.output<typeof HeatParams>;
export type FormsParams = z.output<typeof FormsParams>;
export type TrendParams = z.output<typeof TrendParams>;
export type BeforeAfterParams = z.output<typeof BeforeAfterParams>;
export type CompareCountiesParams = z.output<typeof CompareCountiesParams>;
export type NeedsReviewParams = z.output<typeof NeedsReviewParams>;

/** The params schema for each panel type, for building tool schemas and forms. */
export const PANEL_PARAMS = {
  kpi: KpiParams,
  ranked: RankedParams,
  heat: HeatParams,
  forms: FormsParams,
  trend: TrendParams,
  before_after: BeforeAfterParams,
  compare_counties: CompareCountiesParams,
  needs_review: NeedsReviewParams,
} as const satisfies Record<PanelType, z.ZodType>;

const panelBase = {
  id: IdSchema,
  title: oneLine(PANEL_TITLE_MAX, "The title").pipe(z.string().min(1, { error: "Give the panel a title." })),
  size: z.enum(PANEL_SIZES),
};

export const PanelSpec = z.discriminatedUnion("type", [
  z.strictObject({ ...panelBase, type: z.literal("kpi"), params: KpiParams }),
  z.strictObject({ ...panelBase, type: z.literal("ranked"), params: RankedParams }),
  z.strictObject({ ...panelBase, type: z.literal("heat"), params: HeatParams }),
  z.strictObject({ ...panelBase, type: z.literal("forms"), params: FormsParams }),
  z.strictObject({ ...panelBase, type: z.literal("trend"), params: TrendParams }),
  z.strictObject({ ...panelBase, type: z.literal("before_after"), params: BeforeAfterParams }),
  z.strictObject({ ...panelBase, type: z.literal("compare_counties"), params: CompareCountiesParams }),
  z.strictObject({ ...panelBase, type: z.literal("needs_review"), params: NeedsReviewParams }),
]);
export type PanelSpec = z.output<typeof PanelSpec>;

/** A saved set of workspace panels. With an id it replaces that folder; without one it adds a new folder. */
export const FolderInput = z.strictObject({
  id: IdSchema.optional(),
  name: oneLine(FOLDER_NAME_MAX, "The name").pipe(z.string().min(1, { error: "Give the folder a name." })),
  panels: z.array(PanelSpec).max(FOLDER_PANELS_MAX, { error: `A folder can hold at most ${FOLDER_PANELS_MAX} panels.` }),
});
export type FolderInput = z.output<typeof FolderInput>;

/** Body of POST /api/import/commit. */
export const ImportCommitInput = z.strictObject({
  rows: z.array(z.unknown()).min(1, { error: "There are no rows to add." }),
  batchName: oneLine(BATCH_NAME_MAX, "The batch name").optional(),
});
export type ImportCommitInput = z.output<typeof ImportCommitInput>;

/** Body of POST /api/import/preview. */
export const ImportPreviewInput = z.strictObject({
  csv: z.string(),
  useAi: z.boolean().optional(),
});
export type ImportPreviewInput = z.output<typeof ImportPreviewInput>;

// ---------- Parsing with today's date ----------

function refuseFutureDate(date: string, todayIso: string, path: PropertyKey[]): void {
  if (date > todayIso) {
    throw new z.ZodError([
      { code: "custom", path, message: "The date cannot be in the future.", input: date },
    ]);
  }
}

/** Validates a new flag. Throws ZodError. `todayIso` is the app's today (see time.ts). */
export function parseNewFlagInput(data: unknown, todayIso: string): NewFlagInput {
  const input = NewFlagInput.parse(data);
  refuseFutureDate(input.date, todayIso, ["date"]);
  return input;
}

/** Validates one import row. Throws ZodError. */
export function parseImportRow(data: unknown, todayIso: string): ImportRow {
  const row = ImportRow.parse(data);
  refuseFutureDate(row.date, todayIso, ["date"]);
  return row;
}

/** Validates a change event. Throws ZodError. */
export function parseChangeEventInput(data: unknown, todayIso: string): ChangeEventInput {
  const input = ChangeEventInput.parse(data);
  refuseFutureDate(input.date, todayIso, ["date"]);
  return input;
}
