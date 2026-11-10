import type { CompareCountiesPanelData } from "@/lib/panels";
import type { CountyComparison } from "@/lib/stats";
import { BarList } from "@/components/charts/BarList";

function detail(row: CountyComparison, tag: string | null): string {
  if (row.total === 0) return "No flagged filings";
  const parts: string[] = [];
  if (tag) parts.push(`${tag}: ${(row.tagCount ?? 0).toLocaleString("en-US")} (${row.tagShare ?? 0}%)`);
  if (row.topTag) parts.push(`Most common: ${row.topTag} (${row.topTagShare}%)`);
  return parts.join(". ");
}

/** Counties side by side, in the order they were chosen, as bars of flagged filings. */
export function CompareCountiesPanel({ data }: { data: CompareCountiesPanelData }) {
  if (data.total === 0) return null;
  return (
    <BarList
      label="Flagged filings in each county"
      max={data.max}
      rows={data.rows.map((row) => ({
        key: row.county,
        label: `${row.county} County`,
        value: row.total,
        primary: row.total.toLocaleString("en-US"),
        detail: detail(row, data.tag),
      }))}
    />
  );
}
