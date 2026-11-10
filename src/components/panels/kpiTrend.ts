// What a key-number tile prints next to its sparkline: the last full months of the tile's own monthly
// series, and the latest full month against the one before it. Both come straight from the series
// computePanel returned, so the dashboard and the workspace always agree.

import { monthLabel } from "@/lib/time";

/** How many months the sparkline covers, at most. */
export const SPARK_MONTHS = 6;

export interface KpiTrend {
  /** The last full months, oldest first, with their counts. At least two. */
  months: string[];
  values: number[];
  /** "Apr 2026 to Sep 2026" */
  rangeLabel: string;
  /** The latest full month against the one before it, in words. */
  changeLabel: string;
  direction: "up" | "down" | "flat";
}

const num = (value: number) => value.toLocaleString("en-US");

/**
 * `trend` holds one count per month in `months`. The month of today (`currentMonth`) is not over, so it
 * is left out. Null when fewer than two full months remain.
 */
export function kpiTrend(trend: readonly number[] | null, months: readonly string[], currentMonth: string): KpiTrend | null {
  if (!trend || trend.length !== months.length) return null;
  const full = months.map((month, i) => ({ month, count: trend[i] })).filter((point) => point.month < currentMonth);
  if (full.length < 2) return null;
  const shown = full.slice(-SPARK_MONTHS);
  const latest = shown[shown.length - 1];
  const previous = shown[shown.length - 2];
  const lead = `${monthLabel(latest.month)}: ${num(latest.count)}`;
  let changeLabel: string;
  let direction: KpiTrend["direction"];
  if (latest.count === previous.count) {
    direction = "flat";
    changeLabel = `${lead}, the same as ${monthLabel(previous.month)}`;
  } else {
    direction = latest.count > previous.count ? "up" : "down";
    const word = direction === "up" ? "up" : "down";
    changeLabel =
      previous.count === 0
        ? `${lead}, up from 0 in ${monthLabel(previous.month)}`
        : `${lead}, ${word} ${Math.abs(Math.round(((latest.count - previous.count) / previous.count) * 100))}% from ${num(previous.count)} in ${monthLabel(previous.month)}`;
  }
  return {
    months: shown.map((point) => point.month),
    values: shown.map((point) => point.count),
    rangeLabel: `${monthLabel(shown[0].month)} to ${monthLabel(latest.month)}`,
    changeLabel,
    direction,
  };
}
