// Renders the shared panel components to HTML on the sample data. No browser: this checks that every
// panel type draws, that the numbers printed are the ones computePanel returned, and that each chart
// carries its text alternative.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PANEL_TYPES, computePanel, createPanel } from "@/lib/panels";
import type { PanelData, PanelDraft, PanelSpec } from "@/lib/panels";
import { SAMPLE_EVENTS, SAMPLE_TODAY, makeSampleRecords } from "@/lib/sample";
import { Panel } from "@/components/panels/Panel";
import { PanelView } from "@/components/panels/PanelView";
import { dashboardPanels } from "@/components/panels/dashboardSpecs";
import { panelTables } from "@/components/panels/panelTables";

const RECORDS = makeSampleRecords();

const DRAFTS: Record<(typeof PANEL_TYPES)[number], PanelDraft> = {
  kpi: { type: "kpi", params: {} },
  ranked: { type: "ranked", params: { dimension: "tag" } },
  heat: { type: "heat", params: {} },
  forms: { type: "forms", params: {} },
  trend: { type: "trend", params: { tag: "Missing signature" } },
  before_after: { type: "before_after", params: { eventId: "sc-form" } },
  compare_counties: { type: "compare_counties", params: { counties: ["Marion", "Lake", "Allen"], tag: "Wrong form" } },
  needs_review: { type: "needs_review", params: {} },
};

const spec = (draft: PanelDraft): PanelSpec => createPanel(draft, `t-${draft.type}`, SAMPLE_EVENTS);
const data = (panel: PanelSpec, records = RECORDS): PanelData => computePanel(panel, records, SAMPLE_EVENTS, SAMPLE_TODAY);
const view = (panel: PanelSpec, mode: "chart" | "table" = "chart", records = RECORDS) =>
  renderToStaticMarkup(createElement(PanelView, { data: data(panel, records), view: mode, todayIso: SAMPLE_TODAY }));
const whole = (panel: PanelSpec, records = RECORDS) =>
  renderToStaticMarkup(createElement(Panel, { spec: panel, records, events: SAMPLE_EVENTS, todayIso: SAMPLE_TODAY }));
/** The text a reader gets, with tags removed and entities decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("panel renderers", () => {
  it.each(PANEL_TYPES)("%s draws inside its frame with title, summary and scope", (type) => {
    const panel = spec(DRAFTS[type]);
    const html = whole(panel);
    const computed = data(panel);
    expect(html).toContain("<article");
    expect(html).toMatch(/<h2[^>]*>/);
    expect(text(html)).toContain(panel.title);
    expect(text(html)).toContain(computed.summary);
    expect(text(html)).toContain(computed.scope);
  });

  it.each(PANEL_TYPES)("%s draws nothing but its summary when nothing matches", (type) => {
    const html = whole(spec(DRAFTS[type]), []);
    expect(html).toContain("<article");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("View as table");
  });

  it("key numbers: four tiles, each with its figure and a sparkline of full months", () => {
    const panel = spec(DRAFTS.kpi);
    const computed = data(panel);
    if (computed.type !== "kpi") throw new Error("expected kpi");
    const html = view(panel);
    expect(html.match(/<li[ >]/g)).toHaveLength(4);
    for (const tile of computed.tiles) {
      expect(text(html)).toContain(tile.label);
      expect(text(html)).toContain(tile.value);
    }
    expect(text(html)).toContain("900");
    expect(html.match(/role="img"/g)).toHaveLength(4);
    // October is the month in progress on the sample's today, so the trend stops at September.
    expect(text(html)).toContain("Apr 2026 to Sep 2026");
    expect(text(html)).not.toContain("Oct 2026:");
  });

  it("ranked: every bar has its label, count and share as text", () => {
    const panel = spec(DRAFTS.ranked);
    const computed = data(panel);
    if (computed.type !== "ranked") throw new Error("expected ranked");
    const html = view(panel);
    expect(html.match(/<li[ >]/g)).toHaveLength(computed.rows.length);
    expect(computed.rows[0]).toMatchObject({ label: "Missing required details", count: 284 });
    for (const row of computed.rows) {
      expect(text(html)).toContain(row.label);
      expect(text(html)).toContain(`${row.count} ${row.share}%`);
    }
    expect(html).toContain('aria-hidden="true"');
  });

  it("heat: a real table with the count in every cell and a legend", () => {
    const panel = spec(DRAFTS.heat);
    const computed = data(panel);
    if (computed.type !== "heat") throw new Error("expected heat");
    const html = view(panel);
    expect(html.match(/<th scope="col"/g)).toHaveLength(computed.tags.length + 2);
    expect(html.match(/<th scope="row"/g)).toHaveLength(computed.rows.length);
    expect(html.match(/data-step="[0-4]"/g)?.length).toBe(computed.rows.length * computed.tags.length + 5);
    expect(html).toContain(`data-step="4">${computed.max}<`);
    expect(text(html)).toContain("Fewer");
    expect(text(html)).toContain(`the largest here is ${computed.max}`);
  });

  it("forms: sortable headings that say how the table is sorted", () => {
    const html = view(spec(DRAFTS.forms));
    expect(html.match(/aria-sort="none"/g)).toHaveLength(4);
    expect(html.match(/aria-sort="descending"/g)).toHaveLength(1);
    expect(html).toMatch(/<th scope="col" aria-sort="descending" class="num"><button type="button"[^>]*><span>Flagged filings<\/span>/);
    expect(html.match(/<tbody>.*<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(9);
  });

  it("trend: an image with the summary as its name, and a legend for the open month", () => {
    const panel = spec(DRAFTS.trend);
    const computed = data(panel);
    const html = view(panel);
    expect(html).toContain(`role="img" aria-label="${computed.summary}"`);
    expect(html.match(/<circle/g)?.length).toBeGreaterThanOrEqual(10);
    expect(text(html)).toContain("Filings with Missing signature, per month");
    expect(text(html)).toContain("Month in progress");
  });

  it("before and after: both averages, the change, the marker and the caveat", () => {
    const panel = spec(DRAFTS.before_after);
    const computed = data(panel);
    if (computed.type !== "before_after" || !computed.comparison) throw new Error("expected a comparison");
    const html = view(panel);
    const words = text(html);
    expect(words).toContain("Before Jun 1, 2026");
    expect(words).toContain("4.0 per month");
    expect(words).toContain("1.0 per month");
    expect(words).toContain("-75%");
    expect(words).toContain("fewer per month");
    expect(words).toContain("Date of the change");
    expect(words).toContain(computed.caveat);
    expect(html).toContain('data-direction="down"');
    expect(words).toContain(`${computed.comparison.before.total} over ${computed.comparison.before.months} full months`);
  });

  it("before and after: a change in the middle of a month leaves that month out, and says so", () => {
    const html = view(spec({ type: "before_after", params: { eventId: "po-guide" } }));
    expect(text(html)).toContain("Month left out of the averages");
    expect(text(html)).toContain("Before Jul 15, 2026");
  });

  it("before and after: a change that is gone shows only the summary", () => {
    const panel = spec({ type: "before_after", params: { eventId: "deleted" } });
    expect(view(panel)).toBe("");
    expect(text(whole(panel))).toContain("This change is no longer on the list.");
  });

  it("compare counties: one bar per county with the chosen problem in words", () => {
    const html = view(spec(DRAFTS.compare_counties));
    expect(html.match(/<li[ >]/g)).toHaveLength(3);
    expect(text(html)).toMatch(/Marion County \d+ Wrong form: \d+ \(\d+%\)\. Most common: /);
  });

  it("needs review: the count, and no chart when nothing is waiting", () => {
    const html = view(spec(DRAFTS.needs_review));
    expect(text(html)).toContain("Rows that need review 0");
    expect(html).not.toContain("<svg");
  });
});

describe("the table view", () => {
  it("is offered on chart panels only", () => {
    const offered = PANEL_TYPES.filter((type) => whole(spec(DRAFTS[type])).includes("View as table"));
    expect(offered).toEqual(["ranked", "trend", "before_after", "compare_counties"]);
  });

  it("prints the same numbers as the chart", () => {
    for (const type of ["ranked", "trend", "before_after", "compare_counties"] as const) {
      const panel = spec(DRAFTS[type]);
      const html = view(panel, "table");
      const tables = panelTables(data(panel));
      expect(html.match(/<table/g)).toHaveLength(tables.length);
      expect(html).not.toContain("<svg");
      for (const table of tables) {
        expect(text(html)).toContain(table.caption);
        for (const row of table.rows) expect(text(html)).toContain(row.join(" ").replace(/\s+/g, " "));
      }
    }
  });

  it("falls back to the panel itself when there is no table to show", () => {
    const panel = spec(DRAFTS.kpi);
    expect(view(panel, "table")).toBe(view(panel, "chart"));
  });
});

describe("the dashboard and the workspace", () => {
  it("draw the same panel the same way", () => {
    const filters = { county: "Marion", caseType: "Small claims" } as const;
    const dashboard = dashboardPanels({ filters, eventId: null, tag: null }, SAMPLE_EVENTS);
    const workspace = createPanel({ type: "ranked", params: { ...filters, dimension: "tag" } }, "w", SAMPLE_EVENTS);
    expect(view(dashboard.problems)).toBe(view(workspace));
    const workspaceKpi = createPanel({ type: "kpi", params: filters }, "w2", SAMPLE_EVENTS);
    expect(view(dashboard.kpi)).toBe(view(workspaceKpi));
  });

  it("show a clerk's single county without breaking", () => {
    const lake = RECORDS.filter((record) => record.county === "Lake");
    for (const type of PANEL_TYPES) {
      if (type === "compare_counties") continue;
      expect(whole(spec(DRAFTS[type]), lake)).toContain("<article");
    }
    const heat = view(spec(DRAFTS.heat), "chart", lake);
    expect(heat.match(/<th scope="row"/g)).toHaveLength(1);
  });
});

describe("workspace components", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const counties = ["Marion", "Lake", "Allen"] as const;
  const noop = () => undefined;
  const ok = async () => null;

  it("a workspace panel has every control, each named for its panel", async () => {
    const { WorkspacePanel } = await import("@/components/workspace/WorkspacePanel");
    const panel = createPanel({ type: "ranked", params: { dimension: "tag", county: "Marion", limit: 5 } }, "w1", SAMPLE_EVENTS);
    const html = renderToStaticMarkup(
      createElement(WorkspacePanel, {
        spec: panel,
        index: 0,
        count: 3,
        records: RECORDS,
        events: SAMPLE_EVENTS,
        offeredEvents: SAMPLE_EVENTS,
        todayIso: SAMPLE_TODAY,
        viewerCounty: null,
        counties,
        months,
        minimized: false,
        full: false,
        drag: { dragging: false, onPointerDown: noop },
        onChange: noop,
        onMove: noop,
        onResize: noop,
        onMinimize: noop,
        onDuplicate: noop,
        onClose: noop,
      }),
    );
    const title = "Most common problems: Marion";
    expect(panel.title).toBe(title);
    for (const name of [`Move earlier: ${title}`, `Move later: ${title}`, `Minimize ${title}`, `Duplicate ${title}`, `Close ${title}`, `View as table: ${title}`, `Edit filters: ${title}`]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html).toMatch(/aria-label="Reorder Most common problems: Marion\. Drag, or press the arrow keys\. Position 1 of 3\."/);
    // First in the grid: it cannot move earlier, and says so without dropping out of the tab order.
    expect(html).toMatch(/data-control="earlier" aria-disabled="true"/);
    expect(html).not.toMatch(/data-control="later" aria-disabled="true"/);
    // Chips: the fixed one is plain text, the others are buttons that remove them.
    expect(text(html)).toContain("By problem");
    expect(text(html)).toContain("Top 5 Remove filter");
    expect(text(html)).toContain("Marion County Remove filter");
    expect(html).toContain("<option value=\"s\" selected=\"\">Small</option>");
  });

  it("a minimized panel keeps its heading row and hides the rest", async () => {
    const { WorkspacePanel } = await import("@/components/workspace/WorkspacePanel");
    const panel = createPanel({ type: "trend", params: {} }, "w2", SAMPLE_EVENTS);
    const html = renderToStaticMarkup(
      createElement(WorkspacePanel, {
        spec: panel,
        index: 2,
        count: 3,
        records: RECORDS,
        events: SAMPLE_EVENTS,
        offeredEvents: SAMPLE_EVENTS,
        todayIso: SAMPLE_TODAY,
        viewerCounty: null,
        counties,
        months,
        minimized: true,
        full: true,
        drag: { dragging: false, onPointerDown: noop },
        onChange: noop,
        onMove: noop,
        onResize: noop,
        onMinimize: noop,
        onDuplicate: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain(`aria-label="Show ${panel.title}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-label="Close ${panel.title}"`);
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("View as table");
    expect(html).not.toContain("Move earlier");
  });

  it.each(PANEL_TYPES)("the filter editor draws for a %s panel with a label on every control", async (type) => {
    const { FilterChipEditor } = await import("@/components/workspace/FilterChipEditor");
    const html = renderToStaticMarkup(
      createElement(FilterChipEditor, {
        spec: spec(DRAFTS[type]),
        events: SAMPLE_EVENTS,
        offeredEvents: SAMPLE_EVENTS,
        counties,
        months,
        onChange: noop,
        onDone: noop,
      }),
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    const controls = [...html.matchAll(/<(?:select|input)[^>]* id="([^"]+)"/g)].map((match) => match[1]);
    expect(controls.length).toBeGreaterThan(0);
    for (const id of controls) expect(html).toContain(`for="${id}"`);
    if (type === "before_after") {
      expect(text(html)).toContain("Change to check");
      expect(text(html)).not.toContain("Case type");
    }
    if (type === "compare_counties") expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    if (type === "needs_review") expect(text(html)).not.toContain("All problems");
  });

  it("the command bar is large with three example requests when empty, and compact when docked", async () => {
    const { CommandBar } = await import("@/components/workspace/CommandBar");
    const examples = ["One", "Two", "Three"];
    const submit = async () => ({ ok: true, message: null });
    const hero = renderToStaticMarkup(createElement(CommandBar, { mode: "hero", examples, onSubmit: submit }));
    const docked = renderToStaticMarkup(createElement(CommandBar, { mode: "docked", examples, onSubmit: submit }));
    for (const html of [hero, docked]) {
      expect(html).toContain('<label for="workspace-request"');
      expect(html).toContain('type="submit"');
      expect(text(html)).toContain("Open panels");
    }
    expect(hero.match(/<li>/g)).toHaveLength(3);
    expect(docked).not.toContain("<li>");
  });

  it("the folder rail lists folders, marks examples, and offers rename and delete on saved ones only", async () => {
    const { FolderRail } = await import("@/components/workspace/FolderRail");
    const folders = [
      { id: "f1", name: "Marion review", panels: [spec(DRAFTS.kpi)], example: false },
      { id: "example-county-comparison", name: "County comparison", panels: [spec(DRAFTS.heat), spec(DRAFTS.forms)], example: true },
    ];
    const html = renderToStaticMarkup(
      createElement(FolderRail, { folders, ready: true, loadError: null, openCount: 2, onOpen: noop, onSave: ok, onRename: ok, onDelete: ok }),
    );
    expect(html).toMatch(/<section[^>]* aria-labelledby=/);
    expect(text(html)).toContain("Save current as folder");
    expect(text(html)).toContain("Open folder Marion review 1 panel");
    expect(text(html)).toContain("Open folder County comparison 2 panels");
    expect(html).toContain('aria-label="Rename folder Marion review"');
    expect(html).toContain('aria-label="Delete folder Marion review"');
    expect(html).not.toContain('aria-label="Rename folder County comparison"');
    expect(text(html)).toContain("2 panels, example");
  });

  it("the folder rail cannot save an empty workspace", async () => {
    const { FolderRail } = await import("@/components/workspace/FolderRail");
    const html = renderToStaticMarkup(
      createElement(FolderRail, { folders: [], ready: true, loadError: null, openCount: 0, onOpen: noop, onSave: ok, onRename: ok, onDelete: ok }),
    );
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>(<svg.*?<\/svg>)?<span>Save current as folder/);
    expect(text(html)).toContain("Open a panel first");
    expect(text(html)).toContain("No folders yet.");
  });

  it("the grid is a list that carries each panel's size", async () => {
    const { Grid } = await import("@/components/workspace/Grid");
    const panels = [spec(DRAFTS.kpi), spec(DRAFTS.ranked), spec(DRAFTS.heat)];
    const html = renderToStaticMarkup(
      createElement(Grid, {
        panels,
        fresh: new Set([panels[1].id]),
        onReorder: noop,
        onDragEnd: noop,
        renderPanel: (panel: PanelSpec) => panel.title,
      }),
    );
    expect(html).toContain('<ol class="');
    expect(html).toContain('aria-label="Open panels"');
    expect(html.match(/data-size="[swl]"/g)).toEqual(['data-size="w"', 'data-size="s"', 'data-size="l"']);
    expect(html.match(/data-fresh="true"/g)).toHaveLength(1);
  });

  it("the add panel menu starts closed", async () => {
    const { AddPanelMenu } = await import("@/components/workspace/AddPanelMenu");
    const html = renderToStaticMarkup(createElement(AddPanelMenu, { options: [], full: false, onAdd: noop }));
    expect(html).toContain('aria-expanded="false"');
    expect(text(html)).toContain("Add panel");
  });
});
