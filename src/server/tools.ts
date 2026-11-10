import "server-only";
import { z } from "zod";
import { CASES, CASE_TYPES, COUNTIES, NEEDS_REVIEW, OUTCOMES, TAGS } from "@/lib/domain";
import type { AppMode, ChangeEvent, County, LeanFlag } from "@/lib/domain";
import { computePanel, describeFilters } from "@/lib/panels";
import { BeforeAfterParams, Filters, HEAT_TAGS_DEFAULT, HEAT_TAGS_MAX } from "@/lib/schemas";
import { applyFilters, byForm, countTags, countyByProblem, kpis, rank } from "@/lib/stats";
import { formatDate, monthLabel } from "@/lib/time";

// The read-only tools the MCP endpoint offers, so a court leader can ask about the tracker from inside
// Claude. Every tool answers with counts worked out by stats.ts from the flags the caller may see.
// No tool returns a row, a note or a rejection reason, and none changes anything.

export interface ToolContext {
  /** The flags visible to the caller, already scoped by the repository. Lean: no notes, no reasons. */
  flags: readonly LeanFlag[];
  events: readonly ChangeEvent[];
  /** The one county the caller sees (a clerk's own), or null for a caller who sees every county. */
  viewerCounty: County | null;
  /** The app's today, YYYY-MM-DD. */
  todayIso: string;
  mode: AppMode;
}

export type ToolOutcome =
  | { ok: true; result: Record<string, unknown> }
  /** `error` is a plain sentence the calling model can act on. */
  | { ok: false; error: string };

export interface AggregateTool {
  name: string;
  title: string;
  /** Says what the tool returns and when to call it. */
  description: string;
  inputSchema: z.ZodType;
  /** Validates the input and runs the tool. Never throws for bad input. */
  call(input: unknown, context: ToolContext): ToolOutcome;
}

function defineTool<S extends z.ZodType>(tool: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  run(input: z.output<S>, context: ToolContext): ToolOutcome;
}): AggregateTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    call(input, context) {
      const parsed = tool.inputSchema.safeParse(input ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join(" ");
        return { ok: false, error: `The input is not valid. ${issues} Call list_reference_values for the accepted values.` };
      }
      const outcome = tool.run(parsed.data, context);
      // Every answer says whether its numbers are made up.
      return outcome.ok ? { ok: true, result: { ...outcome.result, ...dataNote(context) } } : outcome;
    },
  };
}

function dataNote(context: ToolContext): { sampleData: boolean; dataNote?: string } {
  return context.mode === "demo"
    ? { sampleData: true, dataNote: "Prototype. All data is made up. Do not present these numbers as real court figures." }
    : { sampleData: false };
}

const FILTER_HELP =
  "Optional filters, all by exact name from list_reference_values: county, caseType, form, tag (a problem), fromMonth and toMonth (YYYY-MM).";

const ProblemCountsInput = Filters.extend({
  limit: z.number().int().min(1).max(TAGS.length).optional(),
});

const CountyBreakdownInput = Filters.extend({
  maxProblems: z.number().int().min(1).max(HEAT_TAGS_MAX).optional(),
});

const NoInput = z.strictObject({});

const getProblemCounts = defineTool({
  name: "get_problem_counts",
  title: "Problem counts",
  description: `How many flagged filings there are and which problems are most common, with the outcomes. A filing with two problems counts under both. Call this for "what goes wrong most" questions. ${FILTER_HELP} limit keeps the top N problems.`,
  inputSchema: ProblemCountsInput,
  run({ limit, ...filters }, context) {
    const rows = applyFilters(context.flags, filters);
    const k = kpis(rows);
    const all = rank(countTags(rows), rows.length).filter((entry) => entry.label !== NEEDS_REVIEW);
    const shown = limit ? all.slice(0, limit) : all;
    return {
      ok: true,
      result: {
        scope: describeFilters(filters, context.viewerCounty),
        flaggedFilings: rows.length,
        problems: shown.map((entry) => ({ problem: entry.label, filings: entry.count, percentOfFlaggedFilings: entry.share })),
        problemsNotShown: all.length - shown.length,
        outcomes: k.outcomes.map((entry) => ({ outcome: entry.label, filings: entry.count, percentOfFlaggedFilings: entry.share })),
        filingsWithMoreThanOneProblem: { filings: k.multiProblem.count, percentOfFlaggedFilings: k.multiProblem.share },
        importedRowsWaitingForReview: rows.filter((r) => r.tags.includes(NEEDS_REVIEW)).length,
      },
    };
  },
});

const getCountyBreakdown = defineTool({
  name: "get_county_breakdown",
  title: "County breakdown",
  description: `Flagged filings per county, with each county's count for the most common problems. Call this to compare counties or to see where a problem is concentrated. ${FILTER_HELP} maxProblems sets how many problems are broken out (default ${HEAT_TAGS_DEFAULT}).`,
  inputSchema: CountyBreakdownInput,
  run({ maxProblems, ...filters }, context) {
    const rows = applyFilters(context.flags, filters);
    // The counties the caller has data for (a clerk has one), or the one county filtered to.
    const present = new Set(context.flags.map((flag) => flag.county));
    const counties = filters.county ? [filters.county] : COUNTIES.filter((county) => present.has(county));
    const table = countyByProblem(rows, { maxTags: maxProblems ?? HEAT_TAGS_DEFAULT, counties });
    return {
      ok: true,
      result: {
        scope: describeFilters(filters, context.viewerCounty),
        flaggedFilings: rows.length,
        problems: table.tags,
        counties: table.rows.map((row) => ({
          county: row.county,
          flaggedFilings: row.total,
          byProblem: table.tags.map((tag, index) => ({ problem: tag, filings: row.cells[index] })),
        })),
      },
    };
  },
});

const getFormBreakdown = defineTool({
  name: "get_form_breakdown",
  title: "Form breakdown",
  description: `Flagged filings per form, most flagged first, with each form's most common problem. Call this for questions about which forms cause the most trouble. ${FILTER_HELP}`,
  inputSchema: Filters,
  run(filters, context) {
    const rows = applyFilters(context.flags, filters);
    return {
      ok: true,
      result: {
        scope: describeFilters(filters, context.viewerCounty),
        flaggedFilings: rows.length,
        forms: byForm(rows).map((row) => ({
          form: row.form,
          caseType: row.caseType,
          flaggedFilings: row.flagged,
          mostCommonProblem: row.topTag,
          filingsWithThatProblem: row.topTagCount,
          percentOfThisFormsFilings: row.topShare,
        })),
      },
    };
  },
});

const compareBeforeAfter = defineTool({
  name: "compare_before_after",
  title: "Before and after a change",
  description:
    "Compares the monthly average of one problem before and after a recorded change (a revised form, a guide, a kiosk), in that change's county and case type. Only full months are averaged. Call list_reference_values first for the change ids. tag is optional and defaults to the problem the change was aimed at. The result shows what happened after the change, not why.",
  inputSchema: BeforeAfterParams,
  run(params, context) {
    // The same computation the before/after panel shows, so the two always agree.
    const data = computePanel({ id: "tool", type: "before_after", title: "Before and after a change", size: "l", params }, context.flags, context.events, context.todayIso, { county: context.viewerCounty });
    if (data.type !== "before_after" || !data.event || !data.comparison) {
      return { ok: false, error: "No recorded change has that id. Call list_reference_values to see the recorded changes and their ids." };
    }
    const { event, comparison } = data;
    return {
      ok: true,
      result: {
        change: { id: event.id, name: event.name, tookEffect: formatDate(event.date), county: event.county, caseType: event.caseType },
        problemMeasured: comparison.tag,
        before: { fullMonths: comparison.before.months, filings: comparison.before.total, averagePerMonth: comparison.before.perMonth },
        after: { fullMonths: comparison.after.months, filings: comparison.after.total, averagePerMonth: comparison.after.perMonth },
        changeInMonthlyAveragePercent: comparison.changePct,
        direction: comparison.direction,
        months: comparison.series.map((point) => ({ month: monthLabel(point.month), filings: point.count, countedAs: point.phase })),
        inWords: data.summary,
        caveat: data.caveat,
      },
    };
  },
});

const listReferenceValues = defineTool({
  name: "list_reference_values",
  title: "Reference values",
  description:
    "The exact names the other tools accept as filters: counties, case types with their forms, problems and outcomes, plus the recorded changes with their ids and the tracker's current date. Call this first. Takes no input.",
  inputSchema: NoInput,
  run(_input, context) {
    const present = new Set(context.flags.map((flag) => flag.county));
    return {
      ok: true,
      result: {
        today: context.todayIso,
        counties: [...COUNTIES],
        countiesWithDataForThisAccount: COUNTIES.filter((county) => present.has(county)),
        caseTypes: CASE_TYPES.map((caseType) => ({ caseType, forms: [...CASES[caseType]] })),
        problems: [...TAGS],
        needsReviewMarker: NEEDS_REVIEW,
        outcomes: [...OUTCOMES],
        changes: context.events.map((event) => ({
          id: event.id,
          name: event.name,
          tookEffect: event.date,
          county: event.county,
          caseType: event.caseType,
          problem: event.tag,
          description: event.description,
        })),
      },
    };
  },
});

/** The five tools, in the order they are listed to a client. */
export const AGGREGATE_TOOLS: readonly AggregateTool[] = [
  listReferenceValues,
  getProblemCounts,
  getCountyBreakdown,
  getFormBreakdown,
  compareBeforeAfter,
];

/** Runs a tool by name. */
export function callAggregateTool(name: string, input: unknown, context: ToolContext): ToolOutcome {
  const tool = AGGREGATE_TOOLS.find((candidate) => candidate.name === name);
  return tool ? tool.call(input, context) : { ok: false, error: `There is no tool named ${name}.` };
}
