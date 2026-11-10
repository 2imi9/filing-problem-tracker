"use client";

import type { TrendPanelData } from "@/lib/panels";
import { TrendLine } from "@/components/charts/TrendLine";

/** Monthly counts as a line with a marker on every month. The month in progress is an open ring. */
export function TrendPanel({ data }: { data: TrendPanelData }) {
  if (data.total === 0) return null;
  return (
    <TrendLine
      points={data.points.map((point) => ({ month: point.month, count: point.count, open: point.inProgress }))}
      max={data.max}
      summary={data.summary}
      seriesLabel={data.tag ? `Filings with ${data.tag}, per month` : "Flagged filings per month"}
      openLabel="Month in progress"
    />
  );
}
