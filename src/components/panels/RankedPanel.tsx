import type { RankedPanelData } from "@/lib/panels";
import { BarList } from "@/components/charts/BarList";
import styles from "./panels.module.css";

/** A sorted bar list of one dimension, most first, with the count and the share printed on every row. */
export function RankedPanel({ data }: { data: RankedPanelData }) {
  if (data.rows.length === 0) return null;
  return (
    <>
      <BarList
        label={`Flagged filings by ${data.dimensionLabel.toLowerCase()}, most first`}
        max={data.max}
        rows={data.rows.map((row) => ({
          key: row.label,
          label: row.label,
          value: row.count,
          primary: row.count.toLocaleString("en-US"),
          secondary: `${row.share}%`,
        }))}
      />
      {data.hidden > 0 ? (
        <p className={styles.hint}>
          {data.hidden} more {data.hidden === 1 ? "is" : "are"} not shown.
        </p>
      ) : null}
      {data.dimension === "tag" ? <p className={styles.hint}>A filing with two problems is counted under both, so the shares can add up to more than 100%.</p> : null}
      {data.dimension === "outcome" ? (
        <p className={styles.hint}>&quot;Fixed at counter&quot; means the clerk helped the filer fix it the same day.</p>
      ) : null}
    </>
  );
}
