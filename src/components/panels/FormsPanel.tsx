"use client";

import { useMemo, useState } from "react";
import type { FocusEvent } from "react";
import type { FormsPanelData } from "@/lib/panels";
import type { FormRow } from "@/lib/stats";
import { Icon } from "@/components/ui";
import styles from "./panels.module.css";

type SortKey = "form" | "caseType" | "flagged" | "topTag" | "topShare";
type SortDirection = "ascending" | "descending";

interface Column {
  key: SortKey;
  label: string;
  numeric: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: "form", label: "Form", numeric: false },
  { key: "caseType", label: "Case type", numeric: false },
  { key: "flagged", label: "Flagged filings", numeric: true },
  { key: "topTag", label: "Most common problem", numeric: false },
  { key: "topShare", label: "Share with it", numeric: true },
];

function compare(a: FormRow, b: FormRow, key: SortKey): number {
  switch (key) {
    case "form":
      return a.form.localeCompare(b.form);
    case "caseType":
      return a.caseType.localeCompare(b.caseType) || a.form.localeCompare(b.form);
    case "flagged":
      return a.flagged - b.flagged || b.form.localeCompare(a.form);
    case "topTag":
      return (a.topTag ?? "").localeCompare(b.topTag ?? "") || a.form.localeCompare(b.form);
    case "topShare":
      return a.topShare - b.topShare || b.form.localeCompare(a.form);
  }
}

/**
 * On a phone the table is wider than its box and scrolls sideways. A browser brings a heading button
 * that is out of view into view when it takes keyboard focus, but leaves one that is half in view where
 * it is, with part of the button and of its focus ring cut off. This brings it fully into the box.
 * Keyboard focus only: a button must not move under the pointer between press and release.
 */
function revealFocused(event: FocusEvent<HTMLElement>): void {
  const target = event.target;
  if (target !== event.currentTarget && target.matches("button:focus-visible")) target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** One row per form. A column heading sorts by that column; choosing it again reverses the order. */
export function FormsPanel({ data }: { data: FormsPanelData }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "flagged", direction: "descending" });
  const rows = useMemo(() => {
    const sorted = [...data.rows].sort((a, b) => compare(a, b, sort.key));
    return sort.direction === "descending" ? sorted.reverse() : sorted;
  }, [data.rows, sort]);

  if (data.rows.length === 0) return null;

  const choose = (column: Column) => {
    setSort((current) =>
      current.key === column.key
        ? { key: column.key, direction: current.direction === "ascending" ? "descending" : "ascending" }
        : { key: column.key, direction: column.numeric ? "descending" : "ascending" },
    );
  };

  return (
    <div className="table-scroll" tabIndex={0} role="group" aria-label="Flagged filings by form" onFocus={revealFocused}>
      <table className={`data-table ${styles.formsTable}`}>
        <caption className="visually-hidden">Flagged filings by form. Column headings are buttons that sort the table.</caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <th key={column.key} scope="col" aria-sort={active ? sort.direction : "none"} className={column.numeric ? "num" : undefined}>
                  <button type="button" className={styles.sortButton} data-active={active} onClick={() => choose(column)}>
                    <span>{column.label}</span>
                    <Icon name={active ? (sort.direction === "ascending" ? "arrowUp" : "arrowDown") : "chevronDown"} size={14} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.form}>
              <th scope="row">{row.form}</th>
              <td>{row.caseType}</td>
              <td className="num">{row.flagged.toLocaleString("en-US")}</td>
              <td>{row.topTag ?? "None"}</td>
              <td className="num">{row.topTag ? `${row.topShare}%` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
