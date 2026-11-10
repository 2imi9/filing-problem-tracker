"use client";

import type { NeedsReviewPanelData } from "@/lib/panels";
import { BarList } from "@/components/charts/BarList";
import { TrendLine } from "@/components/charts/TrendLine";
import styles from "./panels.module.css";

/** Imported rows that no rule could sort: how many, where, and the months they were filed in. */
export function NeedsReviewPanel({ data }: { data: NeedsReviewPanelData }) {
  return (
    <>
      <div className={styles.figureBlock}>
        <p className="label-sm">Rows that need review</p>
        <p className={styles.figure}>{data.count.toLocaleString("en-US")}</p>
        <p className={styles.figureDetail}>
          {data.share}% of {data.total.toLocaleString("en-US")} flagged {data.total === 1 ? "filing" : "filings"}
        </p>
      </div>
      {data.count > 0 ? (
        <>
          <BarList
            label="Rows that need review, by county"
            max={Math.max(1, ...data.byCounty.map((row) => row.count))}
            rows={data.byCounty.map((row) => ({
              key: row.label,
              label: `${row.label} County`,
              value: row.count,
              primary: row.count.toLocaleString("en-US"),
              secondary: `${row.share}%`,
            }))}
          />
          <TrendLine
            compact
            points={data.points.map((point) => ({ month: point.month, count: point.count, open: point.inProgress }))}
            max={Math.max(1, ...data.points.map((point) => point.count))}
            summary={data.summary}
            seriesLabel="Rows that need review, by month filed"
            openLabel="Month in progress"
          />
        </>
      ) : null}
    </>
  );
}
