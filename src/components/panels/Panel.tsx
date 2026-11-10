"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ChangeEvent, County } from "@/lib/domain";
import { computePanel } from "@/lib/panels";
import type { PanelSpec } from "@/lib/panels";
import type { StatFlag } from "@/lib/stats";
import { Button } from "@/components/ui";
import { PanelFrame } from "./PanelFrame";
import type { PanelLook } from "./PanelFrame";
import { PanelView } from "./PanelView";
import type { PanelViewMode } from "./PanelView";
import { hasTableView } from "./panelTables";

export interface PanelProps {
  spec: PanelSpec;
  /** The flags the viewer may see. The panel's numbers are computed from these, here in the browser. */
  records: readonly StatFlag[];
  events: readonly ChangeEvent[];
  /** The app's today, from the server. */
  todayIso: string;
  /** The one county the viewer can see (a clerk's own), so the scope caption does not say "All counties". */
  viewerCounty?: County | null;
  headingLevel?: 2 | 3;
  lead?: ReactNode;
  /** Buttons at the right of the heading row. The table toggle is not one of them: it sits with the summary sentence. */
  actions?: ReactNode;
  toolbar?: ReactNode;
  note?: ReactNode;
  minimized?: boolean;
  /** How the panel sits on the page. Default "section". "bare" has no heading row, so a panel with a table view stays a section. */
  look?: PanelLook;
  /** A smaller heading and tighter spacing, for the workspace grid. */
  dense?: boolean;
}

/**
 * One panel: a PanelSpec turned into numbers by computePanel and drawn by the renderer for its type.
 * The dashboard and the workspace both use this component, so they cannot disagree.
 */
export function Panel({ spec, records, events, todayIso, viewerCounty = null, headingLevel, lead, actions, toolbar, note, minimized = false, look = "section", dense = false }: PanelProps) {
  const data = useMemo(() => computePanel(spec, records, events, todayIso, { county: viewerCounty }), [spec, records, events, todayIso, viewerCounty]);
  const [view, setView] = useState<PanelViewMode>("chart");
  const canTable = hasTableView(data);
  const shown: PanelViewMode = canTable ? view : "chart";

  return (
    <PanelFrame
      title={spec.title}
      headingLevel={headingLevel}
      summary={data.summary}
      scope={data.scope}
      lead={lead}
      toolbar={toolbar}
      note={note}
      minimized={minimized}
      look={look === "bare" && canTable ? "section" : look}
      dense={dense}
      actions={actions}
      viewSwitch={
        canTable ? (
          // The label says what the button will do next, so its state never depends on color.
          <Button
            variant="ghost"
            size="sm"
            icon={shown === "table" ? "chart" : "table"}
            aria-label={`${shown === "table" ? "View as chart" : "View as table"}: ${spec.title}`}
            onClick={() => setView(shown === "table" ? "chart" : "table")}
          >
            {shown === "table" ? "View as chart" : "View as table"}
          </Button>
        ) : null
      }
    >
      <PanelView data={data} view={shown} todayIso={todayIso} />
    </PanelFrame>
  );
}
