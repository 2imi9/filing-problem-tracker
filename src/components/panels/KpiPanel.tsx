import type { KpiPanelData, KpiTile } from "@/lib/panels";
import { monthOf } from "@/lib/time";
import { Sparkline } from "@/components/charts/Sparkline";
import { Icon } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { kpiTrend } from "./kpiTrend";
import type { KpiTrend } from "./kpiTrend";
import styles from "./panels.module.css";

/** What each tile's monthly series counts. */
const SERIES_NAMES: Record<KpiTile["key"], string> = {
  total: "Flagged filings by month",
  top_tag: "Filings with this problem by month",
  top_county: "Flagged filings in this county by month",
  multi: "Filings with more than one problem by month",
};

const DIRECTION_ICONS: Record<KpiTrend["direction"], IconName> = { up: "arrowUp", down: "arrowDown", flat: "minus" };

/**
 * Headline numbers in one row, split by thin dividers. Each: a small label, the figure, a caption, and
 * the last full months as a sparkline with the latest change in words. The figures sit on one baseline.
 */
export function KpiPanel({ data, todayIso }: { data: KpiPanelData; todayIso: string }) {
  const currentMonth = monthOf(todayIso);
  return (
    <ul className={styles.kpis}>
      {data.tiles.map((tile) => {
        const trend = kpiTrend(tile.trend, data.months, currentMonth);
        return (
          <li key={tile.key} className={styles.kpi}>
            <p className={`label-sm ${styles.kpiLabel}`}>{tile.label}</p>
            <p className={`${styles.kpiValue} ${tile.isText ? styles.kpiText : styles.kpiNumber}`}>{tile.value}</p>
            {tile.detail ? <p className={styles.kpiDetail}>{tile.detail}</p> : null}
            {trend ? (
              <div className={styles.kpiTrend}>
                <Sparkline
                  values={trend.values}
                  label={`${SERIES_NAMES[tile.key]}, ${trend.rangeLabel}: ${trend.values.map((value) => value.toLocaleString("en-US")).join(", ")}.`}
                />
                <p className={styles.kpiChange}>
                  <Icon name={DIRECTION_ICONS[trend.direction]} size={14} />
                  <span>{trend.changeLabel}</span>
                </p>
                {/* The sparkline's own name says the same; in view, the months in the line above are enough. */}
                <p className="visually-hidden">
                  {SERIES_NAMES[tile.key]}, {trend.rangeLabel}
                </p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
