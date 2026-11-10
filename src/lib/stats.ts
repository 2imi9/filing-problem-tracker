// Pure functions over flagged filings. This is the only place numbers are worked out, so the dashboard,
// the workspace, the AI summary and the MCP tools can never disagree.
// No dates from the system clock: "today" is always a parameter.

import { COUNTIES, OUTCOMES } from "./domain";
import type { CaseType, ChangeEvent, County, FlagTag, Form, LeanFlag, Outcome, Tag } from "./domain";
import type { Filters } from "./schemas";
import { addMonths, monthOf, monthsBetween } from "./time";

/** The fields the statistics read. A LeanFlag (or a FlagRecord) can be passed as is. */
export type StatFlag = Pick<LeanFlag, "date" | "county" | "caseType" | "form" | "tags" | "outcome">;

/** A label with its count. `share` is a whole-number percentage of the filings counted. */
export interface Counted<L extends string = string> {
  label: L;
  count: number;
  share: number;
}

export type Counts<L extends string = string> = Partial<Record<L, number>>;

export interface MonthCount {
  /** YYYY-MM */
  month: string;
  count: number;
}

/** Whole-number percentage. Zero when the whole is zero. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Keeps the records that match every filter that is set. A reversed month range is read the right way round. */
export function applyFilters<T extends StatFlag>(records: readonly T[], filters: Filters): T[] {
  let from = filters.fromMonth;
  let to = filters.toMonth;
  if (from && to && from > to) [from, to] = [to, from];
  return records.filter((r) => {
    const month = monthOf(r.date);
    return (
      (!filters.county || r.county === filters.county) &&
      (!filters.caseType || r.caseType === filters.caseType) &&
      (!filters.form || r.form === filters.form) &&
      (!filters.tag || r.tags.includes(filters.tag)) &&
      (!from || month >= from) &&
      (!to || month <= to)
    );
  });
}

/** How many filings carry each problem. A filing with two problems counts once under each. */
export function countTags(records: readonly StatFlag[]): Counts<FlagTag> {
  const counts: Counts<FlagTag> = {};
  for (const r of records) {
    for (const tag of r.tags) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

/** How many records fall under each value of `key`. */
export function countBy<L extends string>(records: readonly StatFlag[], key: (record: StatFlag) => L): Counts<L> {
  const counts: Counts<L> = {};
  for (const r of records) {
    const label = key(r);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

/**
 * Sorts counts from most to least. Ties are ordered by label so the result is stable.
 * `total` is the number of filings the shares are a percentage of.
 */
export function rank<L extends string>(counts: Counts<L>, total: number): Counted<L>[] {
  const entries = Object.entries(counts) as [L, number][];
  return entries
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count, share: pct(count, total) }));
}

export interface Kpis {
  /** Flagged filings. */
  total: number;
  /** The most common problem, with the share of filings that have it. */
  topTag: Counted<FlagTag> | null;
  /** The county with the most flagged filings. */
  topCounty: Counted<County> | null;
  /** Filings with more than one problem. */
  multiProblem: { count: number; share: number };
  fixedAtCounter: number;
  /** Outcomes in their reference order, zero counts left out. */
  outcomes: Counted<Outcome>[];
}

export function kpis(records: readonly StatFlag[]): Kpis {
  const total = records.length;
  const outcomeCounts = countBy(records, (r) => r.outcome);
  const multi = records.filter((r) => r.tags.length > 1).length;
  return {
    total,
    topTag: rank(countTags(records), total)[0] ?? null,
    topCounty: rank(countBy(records, (r) => r.county), total)[0] ?? null,
    multiProblem: { count: multi, share: pct(multi, total) },
    fixedAtCounter: outcomeCounts["Fixed at counter"] ?? 0,
    outcomes: OUTCOMES.filter((o) => (outcomeCounts[o] ?? 0) > 0).map((o) => ({
      label: o,
      count: outcomeCounts[o] ?? 0,
      share: pct(outcomeCounts[o] ?? 0, total),
    })),
  };
}

export interface HeatTable {
  /** Column headers: the most common problems, most common first. */
  tags: FlagTag[];
  rows: { county: County; cells: number[]; total: number }[];
  /** The largest cell, at least 1, for shading. */
  max: number;
}

/**
 * County by problem. Columns are the `maxTags` most common problems in the records. Rows are `counties`
 * in the order given (default: every county, in reference order), including counties with no filings.
 */
export function countyByProblem(
  records: readonly StatFlag[],
  options: { maxTags?: number; counties?: readonly County[] } = {},
): HeatTable {
  const tags = rank(countTags(records), records.length)
    .slice(0, options.maxTags ?? 6)
    .map((entry) => entry.label);
  let max = 1;
  const rows = (options.counties ?? COUNTIES).map((county) => {
    const inCounty = records.filter((r) => r.county === county);
    const counts = countTags(inCounty);
    const cells = tags.map((tag) => counts[tag] ?? 0);
    max = Math.max(max, ...cells);
    return { county, cells, total: inCounty.length };
  });
  return { tags, rows, max };
}

export interface FormRow {
  form: Form;
  caseType: CaseType;
  flagged: number;
  topTag: FlagTag | null;
  topTagCount: number;
  /** Share of this form's flagged filings that have the top problem. */
  topShare: number;
}

/** One row per form, most flagged first. */
export function byForm(records: readonly StatFlag[]): FormRow[] {
  const groups = new Map<Form, StatFlag[]>();
  for (const r of records) {
    const group = groups.get(r.form);
    if (group) group.push(r);
    else groups.set(r.form, [r]);
  }
  return [...groups.entries()]
    .map(([form, group]) => {
      const top = rank(countTags(group), group.length)[0] ?? null;
      return {
        form,
        caseType: group[0].caseType,
        flagged: group.length,
        topTag: top ? top.label : null,
        topTagCount: top ? top.count : 0,
        topShare: top ? top.share : 0,
      };
    })
    .sort((a, b) => b.flagged - a.flagged || a.form.localeCompare(b.form));
}

/** Filings per month for the months given. With a tag, only filings that have that problem. */
export function monthlySeries(records: readonly StatFlag[], months: readonly string[], tag?: FlagTag): MonthCount[] {
  const counts = new Map<string, number>(months.map((month) => [month, 0]));
  for (const r of records) {
    const month = monthOf(r.date);
    const current = counts.get(month);
    if (current !== undefined && (!tag || r.tags.includes(tag))) counts.set(month, current + 1);
  }
  return months.map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

/** How one month is treated in a before/after comparison. */
export type MonthPhase = "before" | "change" | "after" | "in_progress";

export interface PhaseAverage {
  /** Full months counted. */
  months: number;
  /** Filings with the problem in those months. */
  total: number;
  /** Average per month, to one decimal place. */
  perMonth: number;
}

export interface BeforeAfter {
  eventId: string;
  tag: Tag;
  county: County;
  caseType: CaseType;
  /** Every month shown, in order, with its count and how it was treated. */
  series: (MonthCount & { phase: MonthPhase })[];
  before: PhaseAverage;
  after: PhaseAverage;
  /** Change in the monthly average, as a whole-number percentage. Null when it cannot be worked out. */
  changePct: number | null;
  /** Why `changePct` is null, or null when there is a figure. */
  missing: "no_full_months_before" | "no_full_months_after" | "none_before" | null;
  direction: "down" | "up" | "flat" | "unknown";
}

/** Months compared on each side of a change, at most. */
export const BEFORE_AFTER_WINDOW = 12;

/**
 * Filings with `tag` in the change's county and case type, month by month, before and after the change.
 * Only full months are averaged. Left out: the month in progress (the month of `todayIso`), and the month
 * of the change itself unless the change took effect on the 1st.
 */
export function beforeAfter(records: readonly StatFlag[], event: ChangeEvent, tag: Tag, todayIso: string): BeforeAfter {
  const scoped = records.filter((r) => r.county === event.county && r.caseType === event.caseType);
  const eventMonth = monthOf(event.date);
  const currentMonth = monthOf(todayIso);
  const startsOnFirst = event.date.endsWith("-01");

  // The window opens with the first month the tracker has any data for, not the first month this county
  // and case type happened to have a filing, so quiet months before the change count as zero.
  let first = records.reduce((min, r) => (monthOf(r.date) < min ? monthOf(r.date) : min), eventMonth);
  const earliest = addMonths(eventMonth, -BEFORE_AFTER_WINDOW);
  if (first < earliest) first = earliest;
  let last = currentMonth < eventMonth ? eventMonth : currentMonth;
  const latest = addMonths(eventMonth, BEFORE_AFTER_WINDOW);
  if (last > latest) last = latest;

  const series = monthlySeries(scoped, monthsBetween(first, last), tag).map((point) => {
    let phase: MonthPhase;
    if (point.month >= currentMonth) phase = "in_progress";
    else if (point.month < eventMonth) phase = "before";
    else if (point.month === eventMonth && !startsOnFirst) phase = "change";
    else phase = "after";
    return { ...point, phase };
  });

  const average = (phase: MonthPhase): PhaseAverage => {
    const points = series.filter((point) => point.phase === phase);
    const total = points.reduce((sum, point) => sum + point.count, 0);
    return { months: points.length, total, perMonth: points.length ? round1(total / points.length) : 0 };
  };
  const before = average("before");
  const after = average("after");

  let changePct: number | null = null;
  let missing: BeforeAfter["missing"] = null;
  if (before.months === 0) missing = "no_full_months_before";
  else if (after.months === 0) missing = "no_full_months_after";
  else if (before.total === 0) missing = "none_before";
  else {
    const b = before.total / before.months;
    const a = after.total / after.months;
    changePct = Math.round(((a - b) / b) * 100);
  }
  const direction = changePct === null ? "unknown" : changePct < 0 ? "down" : changePct > 0 ? "up" : "flat";

  return { eventId: event.id, tag, county: event.county, caseType: event.caseType, series, before, after, changePct, missing, direction };
}

export interface CountyComparison {
  county: County;
  /** Flagged filings in the county. */
  total: number;
  topTag: FlagTag | null;
  topTagCount: number;
  topTagShare: number;
  /** Filings with the chosen problem, or null when no problem was chosen. */
  tagCount: number | null;
  /** Share of the county's flagged filings that have the chosen problem. */
  tagShare: number | null;
}

/** The counties side by side, in the order given. */
export function compareCounties(records: readonly StatFlag[], counties: readonly County[], tag?: FlagTag): CountyComparison[] {
  return counties.map((county) => {
    const inCounty = records.filter((r) => r.county === county);
    const top = rank(countTags(inCounty), inCounty.length)[0] ?? null;
    const tagCount = tag ? inCounty.filter((r) => r.tags.includes(tag)).length : null;
    return {
      county,
      total: inCounty.length,
      topTag: top ? top.label : null,
      topTagCount: top ? top.count : 0,
      topTagShare: top ? top.share : 0,
      tagCount,
      tagShare: tagCount === null ? null : pct(tagCount, inCounty.length),
    };
  });
}

/**
 * The `points` attribute of an SVG polyline that draws the values left to right in a box of
 * `width` by `height`. The scale starts at zero. Empty string for fewer than two values.
 */
export function sparkline(values: readonly number[], width = 96, height = 24, pad = 2): string {
  if (values.length < 2) return "";
  const max = Math.max(1, ...values);
  const step = (width - pad * 2) / (values.length - 1);
  return values
    .map((value, i) => {
      const x = pad + i * step;
      const y = pad + (height - pad * 2) * (1 - Math.max(0, value) / max);
      return `${round1(x)},${round1(y)}`;
    })
    .join(" ");
}
