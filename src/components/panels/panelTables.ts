// The "View as table" alternative for the panels that draw a chart: the same PanelData, as rows.

import type { PanelData, TrendPoint } from "@/lib/panels";
import type { MonthPhase } from "@/lib/stats";

export interface TableColumn {
  label: string;
  numeric: boolean;
}

export interface TableModel {
  /** Says what the rows are. Read out by screen readers as the table's name. */
  caption: string;
  columns: TableColumn[];
  /** One list of cells per row, in column order. The first cell is the row's heading. */
  rows: string[][];
}

const num = (value: number) => value.toLocaleString("en-US");
const text = (label: string): TableColumn => ({ label, numeric: false });
const figure = (label: string): TableColumn => ({ label, numeric: true });

export const PHASE_LABELS: Record<MonthPhase, string> = {
  before: "Before the change",
  change: "Month of the change, left out",
  after: "After the change",
  in_progress: "Not over yet, left out",
};

function monthRows(points: readonly TrendPoint[]): string[][] {
  return points.map((point) => [point.label, num(point.count), point.inProgress ? "In progress" : "Full month"]);
}

/** True when a panel of this kind has a table view to switch to. */
export function hasTableView(data: PanelData): boolean {
  return panelTables(data).length > 0;
}

/**
 * The tables behind a chart panel. Empty for panels that are already a table (county by problem, forms)
 * or plain figures (key numbers), and for a panel with nothing to show.
 */
export function panelTables(data: PanelData): TableModel[] {
  switch (data.type) {
    case "kpi":
    case "heat":
    case "forms":
      return [];
    case "ranked":
      if (data.rows.length === 0) return [];
      return [
        {
          caption: `Flagged filings by ${data.dimensionLabel.toLowerCase()}`,
          columns: [text(data.dimensionLabel), figure("Flagged filings"), figure("Share")],
          rows: data.rows.map((row) => [row.label, num(row.count), `${row.share}%`]),
        },
      ];
    case "trend": {
      if (data.total === 0) return [];
      const counted = data.tag ? `Filings with ${data.tag}` : "Flagged filings";
      return [{ caption: `${counted} by month`, columns: [text("Month"), figure(counted), text("Month status")], rows: monthRows(data.points) }];
    }
    case "before_after": {
      if (!data.comparison || data.total === 0) return [];
      const counted = `Filings with ${data.comparison.tag}`;
      return [
        {
          caption: `${counted} by month, before and after the change`,
          columns: [text("Month"), figure(counted), text("Counted as")],
          rows: data.points.map((point) => [point.label, num(point.count), PHASE_LABELS[point.phase]]),
        },
      ];
    }
    case "compare_counties": {
      if (data.total === 0) return [];
      const columns = [text("County"), figure("Flagged filings"), text("Most common problem"), figure("Share with it")];
      if (data.tag) columns.push(figure(`With ${data.tag}`), figure("Share"));
      return [
        {
          caption: "Counties side by side",
          columns,
          rows: data.rows.map((row) => {
            const cells = [row.county, num(row.total), row.topTag ?? "None", row.topTag ? `${row.topTagShare}%` : ""];
            if (data.tag) cells.push(num(row.tagCount ?? 0), `${row.tagShare ?? 0}%`);
            return cells;
          }),
        },
      ];
    }
    case "needs_review": {
      if (data.count === 0) return [];
      return [
        {
          caption: "Rows that need review, by county",
          columns: [text("County"), figure("Rows"), figure("Share")],
          rows: data.byCounty.map((row) => [row.label, num(row.count), `${row.share}%`]),
        },
        {
          caption: "Rows that need review, by month filed",
          columns: [text("Month"), figure("Rows"), text("Month status")],
          rows: monthRows(data.points),
        },
      ];
    }
  }
}
