"use client";

import type { BeforeAfterPanelData } from "@/lib/panels";
import type { BeforeAfter, PhaseAverage } from "@/lib/stats";
import { TrendLine } from "@/components/charts/TrendLine";
import styles from "./panels.module.css";

const perMonth = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function averageDetail(average: PhaseAverage): string {
  if (average.months === 0) return "no full months";
  return `${average.total.toLocaleString("en-US")} over ${average.months} full ${average.months === 1 ? "month" : "months"}`;
}

function changeDetail(comparison: BeforeAfter): string {
  switch (comparison.missing) {
    case "no_full_months_before":
      return "No full month before the change";
    case "no_full_months_after":
      return "No full month after the change yet";
    case "none_before":
      return "None before the change, so no percentage";
    default:
      return comparison.direction === "down" ? "fewer per month" : comparison.direction === "up" ? "more per month" : "no change per month";
  }
}

/**
 * Before and after one change: the monthly average on each side (full months only), the change between
 * them, and the months as a line with a dashed marker on the day the change took effect.
 */
export function BeforeAfterPanel({ data }: { data: BeforeAfterPanelData }) {
  const { event, comparison } = data;
  if (!event || !comparison) return null;
  return (
    <>
      {event.description ? <p className={styles.hint}>{event.description}</p> : null}
      <dl className={styles.compare}>
        <div className={styles.compareItem}>
          <dt className="label-sm">Before {data.eventDateLabel}</dt>
          <dd className={styles.compareValue}>{perMonth(comparison.before.perMonth)}</dd>
          <dd className={styles.compareDetail}>per month, {averageDetail(comparison.before)}</dd>
        </div>
        <div className={styles.compareItem}>
          <dt className="label-sm">After</dt>
          <dd className={styles.compareValue}>{perMonth(comparison.after.perMonth)}</dd>
          <dd className={styles.compareDetail}>per month, {averageDetail(comparison.after)}</dd>
        </div>
        <div className={styles.compareItem}>
          <dt className="label-sm">Change</dt>
          {/* The sign and the words under it say the direction; the color only repeats it. */}
          <dd className={styles.compareValue} data-direction={comparison.direction}>
            {data.changeLabel}
          </dd>
          <dd className={styles.compareDetail}>{changeDetail(comparison)}</dd>
        </div>
      </dl>
      {data.total > 0 ? (
        <TrendLine
          points={data.points.map((point) => ({
            month: point.month,
            count: point.count,
            open: point.phase === "change" || point.phase === "in_progress",
          }))}
          max={data.max}
          summary={data.summary}
          seriesLabel={`Filings with ${comparison.tag}, per month`}
          openLabel="Month left out of the averages"
          marker={{ date: event.date, label: "Change", title: data.eventDateLabel ?? event.date }}
        />
      ) : null}
      <div className={styles.hints}>
        <p className={styles.hint}>{data.caveat}</p>
        <p className={styles.hint}>These are counts of flagged filings, not a share of all filings, so a busy month can look worse than it was.</p>
      </div>
    </>
  );
}
