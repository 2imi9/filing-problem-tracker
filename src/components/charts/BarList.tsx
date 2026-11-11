import styles from "./charts.module.css";

export interface BarRow {
  key: string;
  label: string;
  /** Sets the bar's length against `max`. */
  value: number;
  /** The figure printed at the end of the bar. */
  primary: string;
  /** A second, quieter figure such as a share. */
  secondary?: string;
  /** A line of text under the label. */
  detail?: string;
}

interface BarListProps {
  rows: readonly BarRow[];
  /** The value a full-length bar stands for. */
  max: number;
  /** Names the list for screen readers. */
  label: string;
}

/**
 * A ranked list of horizontal bars. Every bar has its label and its value printed beside it, so nothing
 * depends on the bar itself; the bars are hidden from screen readers and the list reads as text.
 */
export function BarList({ rows, max, label }: BarListProps) {
  return (
    <ol className={styles.bars} aria-label={label}>
      {rows.map((row) => {
        const share = max > 0 ? Math.min(100, Math.max(0, (row.value / max) * 100)) : 0;
        return (
          <li key={row.key} className={styles.barRow}>
            <span className={styles.barLabel}>{row.label}</span>
            {/* Sized in percent, so the bar needs no inline style and its corners stay 2px at any width. */}
            <svg className={styles.barTrack} width="100%" height="18" aria-hidden="true" focusable="false">
              <rect className={styles.barBack} x="0" y="0" width="100%" height="18" rx="2" />
              <rect className={styles.barFill} x="0" y="0" width={`${share}%`} height="18" rx="2" />
            </svg>
            <span className={styles.barValue}>
              <span className="num">{row.primary}</span>
              {row.secondary ? <span className={`num ${styles.barShare}`}>{row.secondary}</span> : null}
            </span>
            {row.detail ? <span className={styles.barDetail}>{row.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
