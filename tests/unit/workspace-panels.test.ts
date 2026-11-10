import { describe, expect, it } from "vitest";
import { PanelSpec, computePanel, createPanel } from "@/lib/panels";
import type { PanelData, PanelDraft } from "@/lib/panels";
import { SAMPLE_EVENTS, SAMPLE_TODAY, makeSampleRecords } from "@/lib/sample";
import { applyFilters } from "@/lib/stats";
import { dashboardPanels, normalizeDashboardFilters } from "@/components/panels/dashboardSpecs";
import { kpiTrend } from "@/components/panels/kpiTrend";
import { PHASE_LABELS, hasTableView, panelTables } from "@/components/panels/panelTables";
import { parseSummaryReply, summaryRequest } from "@/components/panels/summaryReply";
import { EVENT_APRIL_1, EVENT_MARCH_15, FIXTURE, FIXTURE_TODAY } from "./fixture";

const EVENTS = [EVENT_APRIL_1, EVENT_MARCH_15];

function compute(draft: PanelDraft): PanelData {
  return computePanel(createPanel(draft, "p", EVENTS), FIXTURE, EVENTS, FIXTURE_TODAY);
}

describe("kpiTrend", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

  it("leaves out the month in progress and keeps the last six full months", () => {
    const trend = kpiTrend([5, 6, 7, 8, 9, 10, 12, 3], months, "2026-08");
    expect(trend).toEqual({
      months: ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"],
      values: [6, 7, 8, 9, 10, 12],
      rangeLabel: "Feb 2026 to Jul 2026",
      changeLabel: "Jul 2026: 12, up 20% from 10 in Jun 2026",
      direction: "up",
    });
  });

  it("uses every month when the window ended before the current month", () => {
    const trend = kpiTrend([4, 2], ["2026-01", "2026-02"], "2026-08");
    expect(trend?.values).toEqual([4, 2]);
    expect(trend?.changeLabel).toBe("Feb 2026: 2, down 50% from 4 in Jan 2026");
    expect(trend?.direction).toBe("down");
  });

  it("says so when nothing changed, and does not divide by zero", () => {
    expect(kpiTrend([3, 3], ["2026-01", "2026-02"], "2026-08")?.changeLabel).toBe("Feb 2026: 3, the same as Jan 2026");
    expect(kpiTrend([3, 3], ["2026-01", "2026-02"], "2026-08")?.direction).toBe("flat");
    expect(kpiTrend([0, 4], ["2026-01", "2026-02"], "2026-08")?.changeLabel).toBe("Feb 2026: 4, up from 0 in Jan 2026");
    expect(kpiTrend([1200, 1500], ["2026-01", "2026-02"], "2026-08")?.changeLabel).toBe("Feb 2026: 1,500, up 25% from 1,200 in Jan 2026");
  });

  it("is null when there is nothing to compare", () => {
    expect(kpiTrend(null, months, "2026-08")).toBeNull();
    expect(kpiTrend([5, 6], ["2026-07", "2026-08"], "2026-08")).toBeNull();
    expect(kpiTrend([5], ["2026-01"], "2026-08")).toBeNull();
    expect(kpiTrend([5, 6, 7], ["2026-01", "2026-02"], "2026-08")).toBeNull();
  });

  it("matches the key numbers of the sample data", () => {
    const records = makeSampleRecords();
    const data = computePanel(createPanel({ type: "kpi", params: {} }, "k"), records, SAMPLE_EVENTS, SAMPLE_TODAY);
    if (data.type !== "kpi") throw new Error("expected kpi");
    const total = data.tiles[0];
    const trend = kpiTrend(total.trend, data.months, "2026-10");
    expect(trend?.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(trend?.values).toEqual(trend?.months.map((month) => applyFilters(records, { fromMonth: month, toMonth: month }).length));
  });
});

describe("panelTables", () => {
  it("has no table view for panels that are already tables or plain figures", () => {
    for (const draft of [
      { type: "kpi", params: {} },
      { type: "heat", params: {} },
      { type: "forms", params: {} },
    ] satisfies PanelDraft[]) {
      expect(panelTables(compute(draft))).toEqual([]);
      expect(hasTableView(compute(draft))).toBe(false);
    }
  });

  it("ranked: one row per bar with count and share", () => {
    const [table] = panelTables(compute({ type: "ranked", params: { dimension: "outcome" } }));
    expect(table.caption).toBe("Flagged filings by outcome");
    expect(table.columns.map((c) => c.label)).toEqual(["Outcome", "Flagged filings", "Share"]);
    expect(table.columns.map((c) => c.numeric)).toEqual([false, true, true]);
    expect(table.rows).toEqual([
      ["Rejected", "6", "60%"],
      ["Fixed at counter", "2", "20%"],
      ["Returned to fix", "2", "20%"],
    ]);
  });

  it("trend: one row per month, with the month in progress marked", () => {
    const [table] = panelTables(compute({ type: "trend", params: { tag: "Missing signature" } }));
    expect(table.caption).toBe("Filings with Missing signature by month");
    expect(table.rows[0]).toEqual(["Jan 2026", "2", "Full month"]);
    expect(table.rows[table.rows.length - 1][2]).toBe("In progress");
    const data = compute({ type: "trend", params: {} });
    if (data.type !== "trend") throw new Error("expected trend");
    expect(panelTables(data)[0].rows.map((row) => row[1])).toEqual(data.points.map((p) => String(p.count)));
  });

  it("before and after: says how each month was counted", () => {
    const data = compute({ type: "before_after", params: { eventId: EVENT_MARCH_15.id } });
    if (data.type !== "before_after") throw new Error("expected before_after");
    const [table] = panelTables(data);
    expect(table.columns.map((c) => c.label)).toEqual(["Month", `Filings with ${data.tag}`, "Counted as"]);
    expect(table.rows).toHaveLength(data.points.length);
    expect(table.rows.map((row) => row[2])).toEqual(data.points.map((p) => PHASE_LABELS[p.phase]));
    expect(table.rows.some((row) => row[2] === "Month of the change, left out")).toBe(true);
  });

  it("before and after: nothing when the change is gone", () => {
    expect(panelTables(compute({ type: "before_after", params: { eventId: "deleted" } }))).toEqual([]);
  });

  it("compare counties: adds the chosen problem's columns only when one is chosen", () => {
    const [plain] = panelTables(compute({ type: "compare_counties", params: { counties: ["Marion", "Lake"] } }));
    expect(plain.columns).toHaveLength(4);
    expect(plain.rows[0].slice(0, 2)).toEqual(["Marion", "7"]);
    const [withTag] = panelTables(compute({ type: "compare_counties", params: { counties: ["Marion", "Lake"], tag: "Wrong form" } }));
    expect(withTag.columns.map((c) => c.label).slice(4)).toEqual(["With Wrong form", "Share"]);
    expect(withTag.rows.every((row) => row.length === 6)).toBe(true);
    expect(withTag.rows[1]).toEqual(["Lake", "2", expect.any(String), "50%", "1", "50%"]);
  });

  it("needs review: by county and by month, or nothing when none are waiting", () => {
    const tables = panelTables(compute({ type: "needs_review", params: {} }));
    expect(tables.map((t) => t.caption)).toEqual(["Rows that need review, by county", "Rows that need review, by month filed"]);
    expect(tables[0].rows).toEqual([["Allen", "1", "100%"]]);
    expect(panelTables(compute({ type: "needs_review", params: { county: "Marion" } }))).toEqual([]);
  });

  it("gives no table when nothing matches the filters", () => {
    expect(panelTables(compute({ type: "ranked", params: { dimension: "tag", county: "Monroe" } }))).toEqual([]);
    expect(panelTables(compute({ type: "trend", params: { county: "Monroe" } }))).toEqual([]);
    expect(panelTables(compute({ type: "compare_counties", params: { counties: ["Monroe", "Tippecanoe"] } }))).toEqual([]);
  });

  it("gives every row as many cells as there are columns, with a unique first cell", () => {
    const records = makeSampleRecords();
    const drafts: PanelDraft[] = [
      { type: "ranked", params: { dimension: "form" } },
      { type: "trend", params: {} },
      { type: "before_after", params: { eventId: "po-guide" } },
      { type: "compare_counties", params: { counties: ["Marion", "Lake", "Allen"], tag: "Wrong form" } },
    ];
    for (const draft of drafts) {
      const data = computePanel(createPanel(draft, "p", SAMPLE_EVENTS), records, SAMPLE_EVENTS, SAMPLE_TODAY);
      for (const table of panelTables(data)) {
        expect(table.rows.length).toBeGreaterThan(0);
        expect(table.rows.every((row) => row.length === table.columns.length)).toBe(true);
        expect(new Set(table.rows.map((row) => row[0])).size).toBe(table.rows.length);
        expect(new Set(table.columns.map((column) => column.label)).size).toBe(table.columns.length);
      }
    }
  });
});

describe("dashboardPanels", () => {
  it("builds the fixed list of panels from the filter bar", () => {
    const filters = { county: "Marion", caseType: "Small claims", fromMonth: "2026-03", toMonth: "2026-06" } as const;
    const panels = dashboardPanels({ filters, eventId: null, tag: null }, SAMPLE_EVENTS);
    expect(panels.kpi.params).toEqual(filters);
    expect(panels.problems.params).toEqual({ ...filters, dimension: "tag" });
    expect(panels.outcomes.params).toEqual({ ...filters, dimension: "outcome" });
    expect(panels.heat.params).toEqual({ ...filters, maxTags: 6 });
    expect(panels.forms.params).toEqual(filters);
    expect(panels.beforeAfter?.params).toEqual({ eventId: "sc-form" });
    expect(panels.event?.id).toBe("sc-form");
    const all = [panels.kpi, panels.problems, panels.outcomes, panels.heat, panels.forms, panels.beforeAfter];
    for (const spec of all) expect(PanelSpec.safeParse(spec).success).toBe(true);
    expect(new Set(all.map((spec) => spec?.id)).size).toBe(6);
  });

  it("follows the picked change and problem", () => {
    const picked = dashboardPanels({ filters: {}, eventId: "po-guide", tag: "Wrong form" }, SAMPLE_EVENTS);
    expect(picked.beforeAfter?.params).toEqual({ eventId: "po-guide", tag: "Wrong form" });
    const own = dashboardPanels({ filters: {}, eventId: "po-guide", tag: "Missing required details" }, SAMPLE_EVENTS);
    expect(own.beforeAfter?.params).toEqual({ eventId: "po-guide" });
    const unknown = dashboardPanels({ filters: {}, eventId: "deleted", tag: null }, SAMPLE_EVENTS);
    expect(unknown.event?.id).toBe("sc-form");
  });

  it("has no before/after panel when no change is recorded", () => {
    const panels = dashboardPanels({ filters: {}, eventId: null, tag: null }, []);
    expect(panels.beforeAfter).toBeNull();
    expect(panels.event).toBeNull();
  });

  it("reads a reversed month range the right way round and drops unset filters", () => {
    expect(normalizeDashboardFilters({ county: undefined, fromMonth: "2026-06", toMonth: "2026-03" })).toEqual({ fromMonth: "2026-03", toMonth: "2026-06" });
    expect(normalizeDashboardFilters({ caseType: "Family", toMonth: "2026-03" })).toEqual({ caseType: "Family", toMonth: "2026-03" });
    expect(normalizeDashboardFilters({})).toEqual({});
  });

  it("shows the same numbers as the same panels would in the workspace", () => {
    const records = makeSampleRecords();
    const filters = { county: "Marion", caseType: "Small claims" } as const;
    const dashboard = dashboardPanels({ filters, eventId: "sc-form", tag: null }, SAMPLE_EVENTS);
    const fromDashboard = computePanel(dashboard.problems, records, SAMPLE_EVENTS, SAMPLE_TODAY);
    const fromWorkspace = computePanel(createPanel({ type: "ranked", params: { ...filters, dimension: "tag" } }, "w"), records, SAMPLE_EVENTS, SAMPLE_TODAY);
    expect(fromDashboard).toEqual(fromWorkspace);
    if (!dashboard.beforeAfter) throw new Error("expected a before/after panel");
    const change = computePanel(dashboard.beforeAfter, records, SAMPLE_EVENTS, SAMPLE_TODAY);
    expect(change.type === "before_after" && change.changeLabel).toBe("-75%");
  });
});

describe("AI summary request and reply", () => {
  it("sends the filters, and the change and problem only when a change is picked", () => {
    expect(summaryRequest({ county: "Lake" }, "po-guide", "Wrong form")).toEqual({ filters: { county: "Lake" }, eventId: "po-guide", tag: "Wrong form" });
    expect(summaryRequest({}, "po-guide", null)).toEqual({ filters: {}, eventId: "po-guide" });
    expect(summaryRequest({}, null, "Wrong form")).toEqual({ filters: {} });
  });

  it("reads the summary text", () => {
    expect(parseSummaryReply({ source: "ai", summary: "  The sample data shows 900 flagged filings.  " })).toEqual({
      text: "The sample data shows 900 flagged filings.",
      reason: null,
    });
  });

  it("treats anything without text as unavailable", () => {
    expect(parseSummaryReply({ source: "rules", summary: null, reason: "No API key is configured." })).toEqual({ text: null, reason: "No API key is configured." });
    expect(parseSummaryReply({ summary: "" })).toEqual({ text: null, reason: null });
    expect(parseSummaryReply({ available: false, summary: "Text that failed the number check.", notice: "Discarded." })).toEqual({ text: null, reason: "Discarded." });
    expect(parseSummaryReply(null)).toEqual({ text: null, reason: null });
    expect(parseSummaryReply("Summary")).toEqual({ text: null, reason: null });
    expect(parseSummaryReply({ summary: 12 })).toEqual({ text: null, reason: null });
  });
});
