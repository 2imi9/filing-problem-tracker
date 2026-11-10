import styles from "./charts.module.css";

interface DataTableProps {
  caption: string;
  columns: readonly { label: string; numeric: boolean }[];
  /** One list of cells per row, in column order. The first cell is the row's heading. */
  rows: readonly (readonly string[])[];
}

/** The numbers behind a chart, as a plain table. */
export function DataTable({ caption, columns, rows }: DataTableProps) {
  return (
    <div className="table-scroll" tabIndex={0} role="group" aria-label={caption}>
      <table className={`data-table ${styles.plainTable}`}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} scope="col" className={column.numeric ? "num" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells) => (
            <tr key={cells[0]}>
              {cells.map((cell, i) =>
                i === 0 ? (
                  <th key={columns[i].label} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={columns[i].label} className={columns[i].numeric ? "num" : undefined}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
