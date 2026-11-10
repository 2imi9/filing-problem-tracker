// The panel contract shared by the dashboard, the workspace, the AI composer and the MCP tools.
//
// A PanelSpec says what to show: a type, a title, a size and typed params (filters plus a few fields per
// type). computePanel turns a spec and the records into PanelData: every number, label and sentence the
// UI prints. The UI draws PanelData and computes nothing. The AI only ever writes a PanelSpec.

import { COUNTIES, NEEDS_REVIEW } from "./domain";
import type { ChangeEvent, County, FlagTag, Role, Tag } from "./domain";
import { SAMPLE_EVENTS } from "./sample";
import { HEAT_TAGS_DEFAULT, PANEL_TITLE_MAX } from "./schemas";
import type { Filters, PanelSize, PanelSpec, PanelType, RankedDimension } from "./schemas";
import { applyFilters, beforeAfter, byForm, compareCounties, countBy, countTags, countyByProblem, kpis, monthlySeries, pct, rank } from "./stats";
import type { BeforeAfter, Counted, CountyComparison, FormRow, HeatTable, StatFlag } from "./stats";
import { formatDate, monthLabel, monthOf, monthsBetween, addMonths } from "./time";

export {
  PANEL_TYPES,
  PANEL_SIZES,
  PANEL_PARAMS,
  RANKED_DIMENSIONS,
  PanelSpec,
  FolderInput,
  KpiParams,
  RankedParams,
  HeatParams,
  FormsParams,
  TrendParams,
  BeforeAfterParams,
  CompareCountiesParams,
  NeedsReviewParams,
} from "./schemas";
export type { PanelType, PanelSize, RankedDimension } from "./schemas";

/** A saved set of workspace panels. */
/**
 * The reserved folder name a person's open workspace panels are saved under. It never appears in the
 * folder rail, and each person has at most one folder with this name: saving it again replaces it.
 */
export const CURRENT_FOLDER_NAME = "__current";

export interface Folder {
  id: string;
  name: string;
  panels: PanelSpec[];
}

/** A panel before it has an id. `title` and `size` fall back to the defaults for its type. */
export type PanelDraft = PanelSpec extends infer S
  ? S extends PanelSpec
    ? Pick<S, "type" | "params"> & { title?: string; size?: PanelSize }
    : never
  : never;

export const PANEL_TYPE_LABELS: Record<PanelType, string> = {
  kpi: "Key numbers",
  ranked: "Ranked list",
  heat: "County by problem",
  forms: "Forms",
  trend: "Month by month",
  before_after: "Before and after a change",
  compare_counties: "Compare counties",
  needs_review: "Needs review",
};

const DEFAULT_SIZE: Record<PanelType, PanelSize> = {
  kpi: "w",
  ranked: "s",
  heat: "l",
  forms: "w",
  trend: "w",
  before_after: "l",
  compare_counties: "w",
  needs_review: "s",
};

/** The size a new panel of this type opens at. */
export function defaultSize(type: PanelType): PanelSize {
  return DEFAULT_SIZE[type];
}

const RANKED_TITLES: Record<RankedDimension, string> = {
  tag: "Most common problems",
  outcome: "Outcomes",
  county: "Flagged filings by county",
  caseType: "Flagged filings by case type",
  form: "Flagged filings by form",
};

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function monthRange(filters: Pick<Filters, "fromMonth" | "toMonth">): string | null {
  let from = filters.fromMonth;
  let to = filters.toMonth;
  if (from && to && from > to) [from, to] = [to, from];
  if (from && to) return from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`;
  if (from) return `from ${monthLabel(from)}`;
  if (to) return `through ${monthLabel(to)}`;
  return null;
}

/** One removable chip per filter that is set, in a fixed order. */
export function filterChips(filters: Filters): { key: keyof Filters; label: string }[] {
  const chips: { key: keyof Filters; label: string }[] = [];
  if (filters.county) chips.push({ key: "county", label: `${filters.county} County` });
  if (filters.caseType) chips.push({ key: "caseType", label: filters.caseType });
  if (filters.form) chips.push({ key: "form", label: filters.form });
  if (filters.tag) chips.push({ key: "tag", label: filters.tag });
  if (filters.fromMonth) chips.push({ key: "fromMonth", label: `From ${monthLabel(filters.fromMonth)}` });
  if (filters.toMonth) chips.push({ key: "toMonth", label: `Through ${monthLabel(filters.toMonth)}` });
  return chips;
}

/**
 * The filters in words, for a caption: "Marion County, Small claims, Jun 2026 to Sep 2026".
 * `onlyCounty` is the one county the viewer can see (a clerk's own), named when no county filter is set.
 */
export function describeFilters(filters: Filters, onlyCounty: County | null = null): string {
  const place = filters.county ?? onlyCounty;
  return describeScope(place ? `${place} County` : "All counties", filters);
}

function describeScope(place: string, filters: Omit<Filters, "county">): string {
  const parts: string[] = [place, filters.caseType ?? "all case types"];
  if (filters.form) parts.push(filters.form);
  if (filters.tag) parts.push(filters.tag);
  parts.push(monthRange(filters) ?? "all months");
  return parts.join(", ");
}

/** A short title for a panel, built from its type and params. Pass the events to name a before/after panel. */
export function defaultTitle(spec: PanelDraft, events: readonly ChangeEvent[] = []): string {
  let title: string;
  let scope: string[] = [];
  switch (spec.type) {
    case "kpi":
      title = "Key numbers";
      scope = scopeWords(spec.params);
      break;
    case "ranked":
      title = RANKED_TITLES[spec.params.dimension];
      scope = scopeWords(spec.params);
      break;
    case "heat":
      title = "County by problem";
      scope = scopeWords(spec.params);
      break;
    case "forms":
      title = "Forms";
      scope = scopeWords(spec.params);
      break;
    case "trend":
      title = spec.params.tag ? `${spec.params.tag} by month` : "Flagged filings by month";
      scope = scopeWords({ ...spec.params, tag: undefined });
      break;
    case "before_after": {
      const event = events.find((e) => e.id === spec.params.eventId);
      title = event ? `Before and after: ${event.name}` : "Before and after a change";
      break;
    }
    case "compare_counties":
      title = `Compare ${joinList(spec.params.counties)}`;
      scope = scopeWords(spec.params);
      break;
    case "needs_review":
      title = "Needs review";
      scope = scopeWords(spec.params);
      break;
  }
  const full = scope.length > 0 ? `${title}: ${scope.join(", ")}` : title;
  return full.length > PANEL_TITLE_MAX ? `${full.slice(0, PANEL_TITLE_MAX - 3).trimEnd()}...` : full;
}

function scopeWords(filters: Filters): string[] {
  const words: string[] = [];
  if (filters.county) words.push(filters.county);
  if (filters.caseType) words.push(filters.caseType);
  if (filters.form) words.push(filters.form);
  if (filters.tag) words.push(filters.tag);
  const range = monthRange(filters);
  if (range) words.push(range);
  return words;
}

/** Turns a draft into a full spec: fills in the default title and size. The caller supplies the id. */
export function createPanel(draft: PanelDraft, id: string, events: readonly ChangeEvent[] = []): PanelSpec {
  const title = draft.title?.trim() || defaultTitle(draft, events);
  const size = draft.size ?? defaultSize(draft.type);
  // Spreading a union member loses the link between `type` and `params` for the compiler, so each case
  // is rebuilt by name.
  switch (draft.type) {
    case "kpi":
      return { id, title, size, type: draft.type, params: draft.params };
    case "ranked":
      return { id, title, size, type: draft.type, params: draft.params };
    case "heat":
      return { id, title, size, type: draft.type, params: draft.params };
    case "forms":
      return { id, title, size, type: draft.type, params: draft.params };
    case "trend":
      return { id, title, size, type: draft.type, params: draft.params };
    case "before_after":
      return { id, title, size, type: draft.type, params: draft.params };
    case "compare_counties":
      return { id, title, size, type: draft.type, params: draft.params };
    case "needs_review":
      return { id, title, size, type: draft.type, params: draft.params };
  }
}

// ---------- PanelData ----------

interface PanelDataBase {
  /** Flagged filings the panel is built from, after its filters. */
  total: number;
  /** The panel's filters in words. */
  scope: string;
  /** One plain sentence saying what the panel shows. Describes the numbers and nothing else. */
  summary: string;
}

export interface KpiTile {
  key: "total" | "top_tag" | "top_county" | "multi";
  label: string;
  /** The headline, ready to print: a number, a percentage or a name. */
  value: string;
  /** The line under the headline. */
  detail: string;
  /** True when the headline is a name rather than a figure, so it is set smaller. */
  isText: boolean;
  /** One count per month in `months`, for the sparkline. Null when there is nothing to draw. */
  trend: number[] | null;
}

export interface TrendPoint {
  month: string;
  /** "Jun 2026" */
  label: string;
  count: number;
  /** True for the month of today: it is not over yet. */
  inProgress: boolean;
}

export interface KpiPanelData extends PanelDataBase {
  type: "kpi";
  tiles: KpiTile[];
  /** The months the sparklines cover. */
  months: string[];
}

export interface RankedPanelData extends PanelDataBase {
  type: "ranked";
  dimension: RankedDimension;
  /** Column heading for the labels: "Problem", "Outcome", "County", "Case type" or "Form". */
  dimensionLabel: string;
  /** Sorted from most to least. `share` is a percentage of `total`. */
  rows: Counted[];
  /** The largest count, at least 1, for bar widths. */
  max: number;
  /** Rows left out by `limit`. */
  hidden: number;
}

export interface HeatPanelData extends PanelDataBase, HeatTable {
  type: "heat";
}

export interface FormsPanelData extends PanelDataBase {
  type: "forms";
  rows: FormRow[];
}

export interface TrendPanelData extends PanelDataBase {
  type: "trend";
  /** The problem counted, or null when every flagged filing is counted. */
  tag: FlagTag | null;
  points: TrendPoint[];
  /** The largest monthly count, at least 1. */
  max: number;
}

export interface BeforeAfterPanelData extends PanelDataBase {
  type: "before_after";
  /** The change being measured. Null when it is no longer on the list. */
  event: ChangeEvent | null;
  /** "Jun 1, 2026" */
  eventDateLabel: string | null;
  tag: Tag | null;
  /** The comparison. Null when the change was not found. */
  comparison: BeforeAfter | null;
  /** The comparison's months with labels, ready for the chart and its data table. */
  points: (TrendPoint & { phase: BeforeAfter["series"][number]["phase"] })[];
  /** The largest monthly count, at least 1. */
  max: number;
  /** "-62%", "+8%", "0%" or "n/a". */
  changeLabel: string;
  /** A reminder printed with the figure: it shows what happened, not why, and says so when the counts are small. */
  caveat: string;
}

export interface CompareCountiesPanelData extends PanelDataBase {
  type: "compare_counties";
  /** The problem compared, or null. */
  tag: FlagTag | null;
  rows: CountyComparison[];
  /** The largest county total, at least 1. */
  max: number;
}

export interface NeedsReviewPanelData extends PanelDataBase {
  type: "needs_review";
  /** Imported rows still marked Needs review. */
  count: number;
  /** Share of `total`. */
  share: number;
  byCounty: Counted<County>[];
  points: TrendPoint[];
}

/** Everything a panel prints. Discriminated by `type`, which always equals the spec's type. */
export type PanelData =
  | KpiPanelData
  | RankedPanelData
  | HeatPanelData
  | FormsPanelData
  | TrendPanelData
  | BeforeAfterPanelData
  | CompareCountiesPanelData
  | NeedsReviewPanelData;

const NO_MATCH = "No flagged filings match these filters.";
const MAX_TREND_MONTHS = 36;
const DIMENSION_LABELS: Record<RankedDimension, string> = {
  tag: "Problem",
  outcome: "Outcome",
  county: "County",
  caseType: "Case type",
  form: "Form",
};
const BEFORE_AFTER_CAVEAT = "This shows what happened after the change, not why. Other things may have changed in the same months.";
const SMALL_NUMBERS_CAVEAT = "The counts are small, so one or two filings move the percentage a lot.";
/** Below this many filings across both sides of a change, the small-numbers reminder is added. */
const SMALL_NUMBERS_BELOW = 20;

const num = (value: number) => value.toLocaleString("en-US");
const filings = (count: number) => `${num(count)} flagged ${count === 1 ? "filing" : "filings"}`;

/** The first and last month asked for: the month filters when set, otherwise the first month with data through the month of today. */
function monthSpan(records: readonly StatFlag[], filters: Pick<Filters, "fromMonth" | "toMonth">, todayIso: string): { from: string; to: string } {
  const current = monthOf(todayIso);
  let from = filters.fromMonth ?? records.reduce((min, r) => (monthOf(r.date) < min ? monthOf(r.date) : min), current);
  let to = filters.toMonth ?? current;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

/**
 * The months a time series covers: the month filters when set, otherwise from the first month there is
 * any data for through the month of today. At most the last 36 months, so a caption over the series has
 * to name the months when the series was cut short (the trend panel does).
 */
export function monthWindow(records: readonly StatFlag[], filters: Pick<Filters, "fromMonth" | "toMonth">, todayIso: string): string[] {
  const { from, to } = monthSpan(records, filters, todayIso);
  const earliest = addMonths(to, -(MAX_TREND_MONTHS - 1));
  return monthsBetween(from < earliest ? earliest : from, to);
}

/**
 * Every month a month filter can be set to: from the first month there is any data for through the month
 * of today, however long ago that first month is. A filing that is counted can always be picked by month.
 */
export function monthChoices(records: readonly StatFlag[], todayIso: string): string[] {
  const { from, to } = monthSpan(records, {}, todayIso);
  return monthsBetween(from, to);
}

function trendPoints(records: readonly StatFlag[], months: readonly string[], todayIso: string, tag?: FlagTag): TrendPoint[] {
  const current = monthOf(todayIso);
  return monthlySeries(records, months, tag).map((point) => ({
    month: point.month,
    label: monthLabel(point.month),
    count: point.count,
    inProgress: point.month === current,
  }));
}

function rankedCounts(records: readonly StatFlag[], dimension: RankedDimension): Counted[] {
  const total = records.length;
  switch (dimension) {
    case "tag":
      return rank(countTags(records), total);
    case "outcome":
      return rank(countBy(records, (r) => r.outcome), total);
    case "county":
      return rank(countBy(records, (r) => r.county), total);
    case "caseType":
      return rank(countBy(records, (r) => r.caseType), total);
    case "form":
      return rank(countBy(records, (r) => r.form), total);
  }
}

function rankedSummary(dimension: RankedDimension, top: Counted, total: number): string {
  const of = `${num(top.count)} of ${filings(total)} (${top.share}%)`;
  switch (dimension) {
    case "tag":
      return `${top.label} is the most common problem: ${of}.`;
    case "outcome":
      return `${top.label} is the most common outcome: ${of}.`;
    case "county":
      return `${top.label} County has the most: ${of}.`;
    case "caseType":
      return `${top.label} has the most of any case type: ${of}.`;
    case "form":
      return `${top.label} has the most of any form: ${of}.`;
  }
}

function changeLabel(changePct: number | null): string {
  if (changePct === null) return "n/a";
  return `${changePct > 0 ? "+" : ""}${changePct}%`;
}

function beforeAfterSummary(result: BeforeAfter): string {
  const months = (n: number) => `${n} full ${n === 1 ? "month" : "months"}`;
  if (result.missing === "no_full_months_before") return "There are no full months of data before this change, so there is nothing to compare with yet.";
  if (result.missing === "no_full_months_after") return "There is no full month of data after this change yet.";
  const lead = `Before the change: ${result.before.perMonth} per month over ${months(result.before.months)}. After: ${result.after.perMonth} per month over ${months(result.after.months)}.`;
  if (result.changePct === null) return `${lead} There were none before the change, so a percentage cannot be given.`;
  if (result.changePct === 0) return `${lead} No change in filings with ${result.tag}.`;
  return `${lead} That is ${Math.abs(result.changePct)}% ${result.changePct < 0 ? "fewer" : "more"} filings with ${result.tag}.`;
}

/**
 * The single place panel numbers are computed.
 * `records` are the flags the viewer may see (already scoped by the server), `events` the change events,
 * `todayIso` the app's today. `viewer.county` is set for a person who sees one county only (a clerk); it
 * changes the wording of the scope caption and nothing else. Pure and deterministic.
 */
export function computePanel(
  spec: PanelSpec,
  records: readonly StatFlag[],
  events: readonly ChangeEvent[],
  todayIso: string,
  viewer: { county: County | null } = { county: null },
): PanelData {
  const scopeOf = (filters: Filters) => describeFilters(filters, viewer.county);
  switch (spec.type) {
    case "kpi": {
      const rows = applyFilters(records, spec.params);
      const k = kpis(rows);
      const months = monthWindow(records, spec.params, todayIso);
      const series = (subset: readonly StatFlag[], tag?: FlagTag) =>
        months.length > 1 ? monthlySeries(subset, months, tag).map((p) => p.count) : null;
      const tiles: KpiTile[] = [
        { key: "total", label: "Flagged filings", value: num(k.total), detail: monthRange(spec.params) ?? "in all months", isText: false, trend: series(rows) },
        {
          key: "top_tag",
          label: "Most common problem",
          value: k.topTag ? k.topTag.label : "None",
          detail: k.topTag ? `on ${k.topTag.share}% of flagged filings` : "",
          isText: true,
          trend: k.topTag ? series(rows, k.topTag.label) : null,
        },
        {
          key: "top_county",
          label: "County with most",
          value: k.topCounty ? k.topCounty.label : "None",
          detail: k.topCounty ? filings(k.topCounty.count) : "",
          isText: true,
          trend: k.topCounty ? series(rows.filter((r) => r.county === k.topCounty?.label)) : null,
        },
        {
          key: "multi",
          label: "More than one problem",
          value: `${k.multiProblem.share}%`,
          detail: `${num(k.fixedAtCounter)} fixed at the counter`,
          isText: false,
          trend: series(rows.filter((r) => r.tags.length > 1)),
        },
      ];
      const summary = k.topTag
        ? `${filings(k.total)}. The most common problem is ${k.topTag.label}, on ${k.topTag.share}% of them.`
        : NO_MATCH;
      return { type: "kpi", total: k.total, scope: scopeOf(spec.params), summary, tiles, months };
    }

    case "ranked": {
      const { dimension, limit, ...filters } = spec.params;
      const rows = applyFilters(records, filters);
      const all = rankedCounts(rows, dimension);
      const shown = limit ? all.slice(0, limit) : all;
      return {
        type: "ranked",
        total: rows.length,
        scope: scopeOf(filters),
        summary: all.length > 0 ? rankedSummary(dimension, all[0], rows.length) : NO_MATCH,
        dimension,
        dimensionLabel: DIMENSION_LABELS[dimension],
        rows: shown,
        max: Math.max(1, ...shown.map((r) => r.count)),
        hidden: all.length - shown.length,
      };
    }

    case "heat": {
      const { maxTags, ...filters } = spec.params;
      const rows = applyFilters(records, filters);
      // Rows are the counties the viewer has data for (a clerk sees one), or the one county filtered to.
      const present = new Set(records.map((r) => r.county));
      const counties = filters.county ? [filters.county] : COUNTIES.filter((county) => present.has(county));
      const table = countyByProblem(rows, { maxTags: maxTags ?? HEAT_TAGS_DEFAULT, counties });
      let summary = NO_MATCH;
      if (rows.length > 0 && table.tags.length > 0) {
        let best = { county: table.rows[0].county, tag: table.tags[0], count: -1 };
        for (const row of table.rows) {
          row.cells.forEach((count, i) => {
            if (count > best.count) best = { county: row.county, tag: table.tags[i], count };
          });
        }
        summary = `The largest count is ${best.county} County with ${num(best.count)} ${best.count === 1 ? "filing" : "filings"} flagged for ${best.tag}.`;
      }
      return { type: "heat", total: rows.length, scope: scopeOf(filters), summary, ...table };
    }

    case "forms": {
      const rows = applyFilters(records, spec.params);
      const table = byForm(rows);
      const top = table[0];
      const summary = top
        ? `${top.form} has the most: ${filings(top.flagged)}.` + (top.topTag ? ` Its most common problem is ${top.topTag}, on ${top.topShare}% of them.` : "")
        : NO_MATCH;
      return { type: "forms", total: rows.length, scope: scopeOf(spec.params), summary, rows: table };
    }

    case "trend": {
      const { tag, ...rest } = spec.params;
      const rows = applyFilters(records, rest);
      const months = monthWindow(records, spec.params, todayIso);
      const points = trendPoints(rows, months, todayIso, tag);
      const counted = points.reduce((sum, p) => sum + p.count, 0);
      const full = points.filter((p) => !p.inProgress);
      let summary = NO_MATCH;
      if (counted > 0) {
        const what = (count: number) => {
          const noun = count === 1 ? "filing" : "filings";
          return tag ? `${num(count)} ${noun} with ${tag}` : `${num(count)} flagged ${noun}`;
        };
        const pool = full.length > 0 ? full : points;
        const high = pool.reduce((a, b) => (b.count > a.count ? b : a));
        const low = pool.reduce((a, b) => (b.count < a.count ? b : a));
        if (pool.length === 1) summary = `${high.label} has ${what(high.count)}.`;
        else if (high.count === low.count) summary = `Each of the ${pool.length} full months shown has ${what(high.count)}.`;
        else summary = `The highest full month is ${high.label} with ${what(high.count)}. The lowest is ${low.label} with ${num(low.count)}.`;
        if (points.some((p) => p.inProgress)) summary += ` ${monthLabel(monthOf(todayIso))} is still in progress.`;
      }
      // The total is the sum of the months drawn. When the series was cut to its last 36 months, the
      // caption names those months instead of the wider range that was asked for.
      const cut = months[0] !== monthSpan(records, spec.params, todayIso).from;
      return {
        type: "trend",
        total: counted,
        scope: scopeOf(cut ? { ...spec.params, fromMonth: months[0], toMonth: months[months.length - 1] } : spec.params),
        summary,
        tag: tag ?? null,
        points,
        max: Math.max(1, ...points.map((p) => p.count)),
      };
    }

    case "before_after": {
      const event = events.find((e) => e.id === spec.params.eventId) ?? null;
      if (!event) {
        return {
          type: "before_after",
          total: 0,
          scope: "",
          summary: "This change is no longer on the list.",
          event: null,
          eventDateLabel: null,
          tag: spec.params.tag ?? null,
          comparison: null,
          points: [],
          max: 1,
          changeLabel: changeLabel(null),
          caveat: BEFORE_AFTER_CAVEAT,
        };
      }
      const tag = spec.params.tag ?? event.tag;
      const comparison = beforeAfter(records, event, tag, todayIso);
      const points = comparison.series.map((p) => ({
        month: p.month,
        label: monthLabel(p.month),
        count: p.count,
        inProgress: p.phase === "in_progress",
        phase: p.phase,
      }));
      return {
        type: "before_after",
        total: comparison.series.reduce((sum, p) => sum + p.count, 0),
        scope: `${event.county} County, ${event.caseType}, ${tag}`,
        summary: beforeAfterSummary(comparison),
        event,
        eventDateLabel: formatDate(event.date),
        tag,
        comparison,
        points,
        max: Math.max(1, ...points.map((p) => p.count)),
        changeLabel: changeLabel(comparison.changePct),
        caveat:
          comparison.before.total + comparison.after.total < SMALL_NUMBERS_BELOW
            ? `${BEFORE_AFTER_CAVEAT} ${SMALL_NUMBERS_CAVEAT}`
            : BEFORE_AFTER_CAVEAT,
      };
    }

    case "compare_counties": {
      const { counties, tag, ...rest } = spec.params;
      const rows = applyFilters(records, rest).filter((r) => counties.includes(r.county));
      const table = compareCounties(rows, counties, tag);
      const top = table.reduce((a, b) => (b.total > a.total ? b : a));
      let summary = NO_MATCH;
      if (rows.length > 0) {
        summary = `Of ${joinList(counties)}, ${top.county} County has the most: ${filings(top.total)}.`;
        if (tag) {
          const withTag = table.filter((row) => row.total > 0).reduce((a, b) => ((b.tagShare ?? 0) > (a.tagShare ?? 0) ? b : a));
          summary += ` ${tag} is on ${withTag.tagShare ?? 0}% of ${withTag.county} County's flagged filings, the highest share among them.`;
        }
      }
      return {
        type: "compare_counties",
        total: rows.length,
        scope: describeScope(joinList(counties), { ...rest, tag }),
        summary,
        tag: tag ?? null,
        rows: table,
        max: Math.max(1, ...table.map((row) => row.total)),
      };
    }

    case "needs_review": {
      const rows = applyFilters(records, spec.params);
      const waiting = rows.filter((r) => r.tags.includes(NEEDS_REVIEW));
      const months = monthWindow(records, spec.params, todayIso);
      const count = waiting.length;
      return {
        type: "needs_review",
        total: rows.length,
        scope: scopeOf(spec.params),
        summary:
          count === 0
            ? "No imported rows are waiting for review."
            : `${num(count)} imported ${count === 1 ? "row needs" : "rows need"} a person to choose the problem (${pct(count, rows.length)}% of ${filings(rows.length)}).`,
        count,
        share: pct(count, rows.length),
        byCounty: rank(countBy(waiting, (r) => r.county), count),
        points: trendPoints(waiting, months, todayIso),
      };
    }
  }
}

// ---------- Example folders ----------

interface ExampleFolder extends Folder {
  /** The one county the folder is about, or null when it spans counties. */
  county: County | null;
}

const example = (id: string, draft: PanelDraft): PanelSpec => createPanel(draft, id, SAMPLE_EVENTS);

const EXAMPLES: ExampleFolder[] = [
  {
    id: "example-marion-small-claims",
    name: "Marion small claims",
    county: "Marion",
    panels: [
      example("ex1-kpi", { type: "kpi", params: { county: "Marion", caseType: "Small claims" } }),
      example("ex1-ranked", { type: "ranked", params: { county: "Marion", caseType: "Small claims", dimension: "tag" } }),
      example("ex1-before-after", { type: "before_after", params: { eventId: "sc-form" } }),
      example("ex1-trend", { type: "trend", params: { county: "Marion", caseType: "Small claims", tag: "Missing signature" } }),
    ],
  },
  {
    id: "example-lake-protective-orders",
    name: "Lake protective orders",
    county: "Lake",
    panels: [
      example("ex2-ranked", { type: "ranked", params: { county: "Lake", caseType: "Protective order", dimension: "tag" } }),
      example("ex2-before-after", { type: "before_after", params: { eventId: "po-guide" } }),
      example("ex2-forms", { type: "forms", params: { county: "Lake", caseType: "Protective order" } }),
    ],
  },
  {
    id: "example-county-comparison",
    name: "County comparison",
    county: null,
    panels: [
      example("ex3-compare", { type: "compare_counties", params: { counties: ["Marion", "Lake", "Allen"], tag: "Wrong form" } }),
      example("ex3-heat", { type: "heat", params: {} }),
      example("ex3-before-after", { type: "before_after", params: { eventId: "fam-kiosk" } }),
      example("ex3-outcomes", { type: "ranked", params: { dimension: "outcome" } }),
    ],
  },
];

/** The three example folders that ship with the sample data. They refer to the sample change events by id. */
export const EXAMPLE_FOLDERS: Folder[] = EXAMPLES.map(({ id, name, panels }) => ({ id, name, panels }));

/**
 * The example folders a user starts with: all three for leaders and admins, and for a clerk the ones
 * about their own county (the others would be empty, since a clerk sees one county).
 */
export function exampleFoldersFor(user: { role: Role; county: County | null }): Folder[] {
  return EXAMPLES.filter((folder) => user.role !== "clerk" || folder.county === user.county).map(({ id, name, panels }) => ({ id, name, panels }));
}
