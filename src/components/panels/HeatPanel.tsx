import type { HeatPanelData } from "@/lib/panels";
import { HeatTable } from "@/components/charts/HeatTable";

/** Counties against the most common problems. Every cell prints its count; shading is a second cue. */
export function HeatPanel({ data }: { data: HeatPanelData }) {
  if (data.total === 0 || data.tags.length === 0) return null;
  return (
    <HeatTable
      caption="Flagged filings with each problem, by county"
      rowHeading="County"
      columns={data.tags}
      rows={data.rows.map((row) => ({ label: row.county, cells: row.cells, total: row.total }))}
      totalHeading="All flagged filings"
      max={data.max}
    />
  );
}
