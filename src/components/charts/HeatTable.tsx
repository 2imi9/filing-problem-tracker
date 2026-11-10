import { heatStep } from "./geometry";
import styles from "./charts.module.css";

interface HeatTableProps {
  /** Names the table: what the cells count. */
  caption: string;
  rowHeading: string;
  columns: readonly string[];
  rows: readonly { label: string; cells: readonly number[]; total: number }[];
  totalHeading: string;
  /** The largest cell, for shading. */
  max: number;
}

const STEPS = [0, 1, 2, 3, 4] as const;

/**
 * A table whose cells are shaded by how large the number is. Every cell prints its number, so the
 * shading only helps the eye find the large ones. A legend explains it.
 */
export function HeatTable({ caption, rowHeading, columns, rows, totalHeading, max }: HeatTableProps) {
  return (
    <div className={styles.heatWrap}>
      {/* Focusable so the table can be scrolled sideways from the keyboard. A group, not a landmark: a page can hold many. */}
      <div className="table-scroll" tabIndex={0} role="group" aria-label={caption}>
        <table className={`data-table ${styles.heat}`}>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{rowHeading}</th>
              {columns.map((column) => (
                <th key={column} scope="col" className={styles.heatHead}>
                  {column}
                </th>
              ))}
              <th scope="col" className={styles.heatHead}>
                {totalHeading}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.cells.map((value, i) => (
                  <td key={columns[i]} className={`num ${styles.heatCell}`} data-step={heatStep(value, max)}>
                    {value.toLocaleString("en-US")}
                  </td>
                ))}
                <td className="num">{row.total.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.legend}>
        <span className={styles.legendScale} aria-hidden="true">
          <span>Fewer</span>
          {STEPS.map((step) => (
            <span key={step} className={styles.legendSwatch} data-step={step} />
          ))}
          <span>More</span>
        </span>
        <span>Each cell prints its count. A darker cell is a larger count; the largest here is {max.toLocaleString("en-US")}.</span>
      </p>
    </div>
  );
}
