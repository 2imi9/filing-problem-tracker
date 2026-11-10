"use client";

import type { PanelData } from "@/lib/panels";
import { DataTable } from "@/components/charts/DataTable";
import { BeforeAfterPanel } from "./BeforeAfterPanel";
import { CompareCountiesPanel } from "./CompareCountiesPanel";
import { FormsPanel } from "./FormsPanel";
import { HeatPanel } from "./HeatPanel";
import { KpiPanel } from "./KpiPanel";
import { NeedsReviewPanel } from "./NeedsReviewPanel";
import { RankedPanel } from "./RankedPanel";
import { TrendPanel } from "./TrendPanel";
import { panelTables } from "./panelTables";
import styles from "./panels.module.css";

export type PanelViewMode = "chart" | "table";

interface PanelViewProps {
  data: PanelData;
  /** "table" shows the numbers behind a chart as plain tables. */
  view: PanelViewMode;
  /** The app's today. The key numbers use it to leave the month in progress out of their trend. */
  todayIso: string;
}

/** Draws PanelData. It computes nothing: every number here came from computePanel. */
export function PanelView({ data, view, todayIso }: PanelViewProps) {
  if (view === "table") {
    const tables = panelTables(data);
    if (tables.length > 0) {
      return (
        <div className={styles.tables}>
          {tables.map((table) => (
            <DataTable key={table.caption} caption={table.caption} columns={table.columns} rows={table.rows} />
          ))}
        </div>
      );
    }
  }
  switch (data.type) {
    case "kpi":
      return <KpiPanel data={data} todayIso={todayIso} />;
    case "ranked":
      return <RankedPanel data={data} />;
    case "heat":
      return <HeatPanel data={data} />;
    case "forms":
      return <FormsPanel data={data} />;
    case "trend":
      return <TrendPanel data={data} />;
    case "before_after":
      return <BeforeAfterPanel data={data} />;
    case "compare_counties":
      return <CompareCountiesPanel data={data} />;
    case "needs_review":
      return <NeedsReviewPanel data={data} />;
  }
}
