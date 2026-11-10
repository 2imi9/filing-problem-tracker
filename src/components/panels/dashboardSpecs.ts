// The dashboard is a fixed list of PanelSpecs built from its filter bar. The same specs, run through
// computePanel and the same renderers as the workspace, so the two can never show different numbers.

import type { ChangeEvent, Tag } from "@/lib/domain";
import type { PanelSpec } from "@/lib/panels";
import { HEAT_TAGS_DEFAULT } from "@/lib/schemas";
import type { Filters } from "@/lib/schemas";

/** The dashboard's filter bar: county, case type and a month range. */
export type DashboardFilters = Pick<Filters, "county" | "caseType" | "fromMonth" | "toMonth">;

export interface DashboardSelection {
  filters: DashboardFilters;
  /** The change picked in the before/after panel, or null to use the first one on the list. */
  eventId: string | null;
  /** The problem followed in the before/after panel, or null to use the change's own. */
  tag: Tag | null;
}

export interface DashboardPanels {
  kpi: PanelSpec;
  problems: PanelSpec;
  outcomes: PanelSpec;
  heat: PanelSpec;
  forms: PanelSpec;
  /** Null when no change has been recorded. */
  beforeAfter: PanelSpec | null;
  /** The change the before/after panel measures. */
  event: ChangeEvent | null;
}

/** Drops unset filters and reads a reversed month range the right way round. */
export function normalizeDashboardFilters(filters: DashboardFilters): DashboardFilters {
  const out: DashboardFilters = {};
  if (filters.county) out.county = filters.county;
  if (filters.caseType) out.caseType = filters.caseType;
  let from = filters.fromMonth;
  let to = filters.toMonth;
  if (from && to && from > to) [from, to] = [to, from];
  if (from) out.fromMonth = from;
  if (to) out.toMonth = to;
  return out;
}

export function dashboardPanels(selection: DashboardSelection, events: readonly ChangeEvent[]): DashboardPanels {
  const filters = normalizeDashboardFilters(selection.filters);
  const event = events.find((e) => e.id === selection.eventId) ?? events[0] ?? null;
  return {
    kpi: { id: "dash-kpi", type: "kpi", title: "Key numbers", size: "l", params: filters },
    problems: { id: "dash-problems", type: "ranked", title: "Most common problems", size: "w", params: { ...filters, dimension: "tag" } },
    outcomes: {
      id: "dash-outcomes",
      type: "ranked",
      title: "What happened to flagged filings",
      size: "s",
      params: { ...filters, dimension: "outcome" },
    },
    heat: { id: "dash-heat", type: "heat", title: "Problems by county", size: "l", params: { ...filters, maxTags: HEAT_TAGS_DEFAULT } },
    forms: { id: "dash-forms", type: "forms", title: "Problems by form", size: "l", params: filters },
    beforeAfter: event
      ? {
          id: "dash-before-after",
          type: "before_after",
          title: "Before and after a change",
          size: "l",
          params: { eventId: event.id, ...(selection.tag && selection.tag !== event.tag ? { tag: selection.tag } : {}) },
        }
      : null,
    event,
  };
}
