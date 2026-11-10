import { describe, expect, it } from "vitest";
import { COUNTIES } from "@/lib/domain";
import {
  PANEL_TYPES,
  PANEL_TYPE_LABELS,
  PanelSpec,
  computePanel,
  createPanel,
  defaultSize,
  defaultTitle,
  describeFilters,
  EXAMPLE_FOLDERS,
  exampleFoldersFor,
  filterChips,
  monthChoices,
  monthWindow,
} from "@/lib/panels";
import type { PanelData, PanelDraft } from "@/lib/panels";
import { SAMPLE_EVENTS, SAMPLE_TODAY, makeSampleRecords } from "@/lib/sample";
import { FolderInput } from "@/lib/schemas";
import { applyFilters, beforeAfter, kpis } from "@/lib/stats";
import { EVENT_APRIL_1, EVENT_MARCH_15, FIXTURE, FIXTURE_TODAY } from "./fixture";

const EVENTS = [EVENT_APRIL_1, EVENT_MARCH_15];

function compute<T extends PanelData["type"]>(draft: PanelDraft & { type: T }): Extract<PanelData, { type: T }> {
  const data = computePanel(createPanel(draft, "p"), FIXTURE, EVENTS, FIXTURE_TODAY);
  if (data.type !== draft.type) throw new Error(`expected ${draft.type}, got ${data.type}`);
  return data as Extract<PanelData, { type: T }>;
}

const JAN_TO_JUN = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

describe("computePanel on the hand-made fixture", () => {
  it("kpi", () => {
    const data = compute({ type: "kpi", params: {} });
    expect(data.total).toBe(10);
    expect(data.scope).toBe("All counties, all case types, all months");
    expect(data.summary).toBe("10 flagged filings. The most common problem is Missing signature, on 50% of them.");
    expect(data.months).toEqual(JAN_TO_JUN);
    expect(data.tiles).toEqual([
      { key: "total", label: "Flagged filings", value: "10", detail: "in all months", isText: false, trend: [2, 2, 2, 1, 1, 2] },
      { key: "top_tag", label: "Most common problem", value: "Missing signature", detail: "on 50% of flagged filings", isText: true, trend: [2, 1, 1, 0, 1, 0] },
      { key: "top_county", label: "County with most", value: "Marion", detail: "7 flagged filings", isText: true, trend: [2, 1, 1, 1, 1, 1] },
      { key: "multi", label: "More than one problem", value: "20%", detail: "2 fixed at the counter", isText: false, trend: [1, 0, 1, 0, 0, 0] },
    ]);
  });

  it("kpi with filters, and with nothing matching", () => {
    const lake = compute({ type: "kpi", params: { county: "Lake", fromMonth: "2026-02", toMonth: "2026-03" } });
    expect(lake.total).toBe(2);
    expect(lake.scope).toBe("Lake County, all case types, Feb 2026 to Mar 2026");
    expect(lake.tiles[0]).toMatchObject({ value: "2", detail: "Feb 2026 to Mar 2026", trend: [1, 1] });
    expect(lake.months).toEqual(["2026-02", "2026-03"]);

    const none = compute({ type: "kpi", params: { county: "Monroe" } });
    expect(none.total).toBe(0);
    expect(none.summary).toBe("No flagged filings match these filters.");
    expect(none.tiles.map((t) => t.value)).toEqual(["0", "None", "None", "0%"]);
    expect(none.tiles[1].trend).toBeNull();
    expect(none.tiles[2].trend).toBeNull();
  });

  it("ranked by problem", () => {
    const data = compute({ type: "ranked", params: { dimension: "tag" } });
    expect(data).toMatchObject({ total: 10, dimension: "tag", dimensionLabel: "Problem", max: 5, hidden: 0 });
    expect(data.rows.slice(0, 3)).toEqual([
      { label: "Missing signature", count: 5, share: 50 },
      { label: "Wrong form", count: 3, share: 30 },
      { label: "Missing fee or fee waiver", count: 2, share: 20 },
    ]);
    expect(data.rows).toHaveLength(6);
    expect(data.summary).toBe("Missing signature is the most common problem: 5 of 10 flagged filings (50%).");
  });

  it("ranked by outcome, county, case type and form", () => {
    const outcome = compute({ type: "ranked", params: { dimension: "outcome" } });
    expect(outcome.rows).toEqual([
      { label: "Rejected", count: 6, share: 60 },
      { label: "Fixed at counter", count: 2, share: 20 },
      { label: "Returned to fix", count: 2, share: 20 },
    ]);
    expect(outcome.summary).toBe("Rejected is the most common outcome: 6 of 10 flagged filings (60%).");

    const county = compute({ type: "ranked", params: { dimension: "county" } });
    expect(county.rows.map((r) => [r.label, r.count])).toEqual([["Marion", 7], ["Lake", 2], ["Allen", 1]]);
    expect(county.summary).toBe("Marion County has the most: 7 of 10 flagged filings (70%).");

    const caseType = compute({ type: "ranked", params: { dimension: "caseType" } });
    expect(caseType.rows.map((r) => [r.label, r.count])).toEqual([["Small claims", 7], ["Family", 2], ["Protective order", 1]]);
    expect(caseType.dimensionLabel).toBe("Case type");

    const form = compute({ type: "ranked", params: { dimension: "form" } });
    expect(form.rows[0]).toEqual({ label: "Small claims notice of claim", count: 6, share: 60 });
    expect(form.rows).toHaveLength(5);
  });

  it("ranked applies filters and the limit", () => {
    const data = compute({ type: "ranked", params: { dimension: "tag", county: "Marion", limit: 2 } });
    expect(data.total).toBe(7);
    expect(data.scope).toBe("Marion County, all case types, all months");
    expect(data.rows).toEqual([
      { label: "Missing signature", count: 5, share: 71 },
      { label: "Missing fee or fee waiver", count: 2, share: 29 },
    ]);
    expect(data.hidden).toBe(2);
    expect(data.max).toBe(5);

    const none = compute({ type: "ranked", params: { dimension: "tag", county: "Monroe" } });
    expect(none).toMatchObject({ total: 0, rows: [], max: 1, hidden: 0, summary: "No flagged filings match these filters." });
  });

  it("heat shows only counties the viewer has data for", () => {
    const data = compute({ type: "heat", params: { maxTags: 2 } });
    expect(data.total).toBe(10);
    expect(data.tags).toEqual(["Missing signature", "Wrong form"]);
    expect(data.rows).toEqual([
      { county: "Marion", cells: [5, 2], total: 7 },
      { county: "Lake", cells: [0, 1], total: 2 },
      { county: "Allen", cells: [0, 0], total: 1 },
    ]);
    expect(data.max).toBe(5);
    expect(data.summary).toBe("The largest count is Marion County with 5 filings flagged for Missing signature.");
  });

  it("heat narrows to one county when filtered, and defaults to six columns", () => {
    const lake = compute({ type: "heat", params: { county: "Lake" } });
    expect(lake.rows.map((r) => r.county)).toEqual(["Lake"]);
    expect(lake.tags).toEqual(["Missing required details", "Wrong form"]);
    expect(lake.summary).toBe("The largest count is Lake County with 1 filing flagged for Missing required details.");
    expect(compute({ type: "heat", params: {} }).tags).toHaveLength(6);
    expect(compute({ type: "heat", params: { county: "Monroe" } }).summary).toBe("No flagged filings match these filters.");
  });

  it("forms", () => {
    const data = compute({ type: "forms", params: {} });
    expect(data.total).toBe(10);
    expect(data.rows).toHaveLength(5);
    expect(data.rows[0]).toEqual({
      form: "Small claims notice of claim",
      caseType: "Small claims",
      flagged: 6,
      topTag: "Missing signature",
      topTagCount: 4,
      topShare: 67,
    });
    expect(data.summary).toBe("Small claims notice of claim has the most: 6 flagged filings. Its most common problem is Missing signature, on 67% of them.");
    expect(compute({ type: "forms", params: { caseType: "Family" } }).rows.map((r) => r.form)).toEqual([
      "Petition for dissolution, no children",
      "Petition to modify child support",
    ]);
  });

  it("trend counts filings per month and marks the month in progress", () => {
    const data = compute({ type: "trend", params: {} });
    expect(data.tag).toBeNull();
    expect(data.total).toBe(10);
    expect(data.points.map((p) => p.count)).toEqual([2, 2, 2, 1, 1, 2]);
    expect(data.points.map((p) => p.label)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026"]);
    expect(data.points.map((p) => p.inProgress)).toEqual([false, false, false, false, false, true]);
    expect(data.max).toBe(2);
    expect(data.summary).toBe("The highest full month is Jan 2026 with 2 flagged filings. The lowest is Apr 2026 with 1. Jun 2026 is still in progress.");
  });

  it("trend for one problem counts filings that have it", () => {
    const data = compute({ type: "trend", params: { tag: "Missing signature", county: "Marion" } });
    expect(data.tag).toBe("Missing signature");
    expect(data.points.map((p) => p.count)).toEqual([2, 1, 1, 0, 1, 0]);
    expect(data.total).toBe(5);
    expect(data.scope).toBe("Marion County, all case types, Missing signature, all months");
    expect(data.summary).toBe("The highest full month is Jan 2026 with 2 filings with Missing signature. The lowest is Apr 2026 with 0. Jun 2026 is still in progress.");
  });

  it("trend names the months it covers when it had to leave older ones out", () => {
    // A backlog import: two filings from more than 36 months before today.
    const old = [
      { ...FIXTURE[0], id: "old-1", date: "2022-03-15" },
      { ...FIXTURE[0], id: "old-2", date: "2022-04-02" },
    ];
    const records = [...FIXTURE, ...old];
    const today = FIXTURE_TODAY;
    const kpi = computePanel(createPanel({ type: "kpi", params: {} }, "k", []), records, [], today);
    expect(kpi).toMatchObject({ total: 12, scope: "All counties, all case types, all months" });

    const trend = computePanel(createPanel({ type: "trend", params: {} }, "t", []), records, [], today);
    if (trend.type !== "trend") throw new Error("expected a trend panel");
    expect(trend.points).toHaveLength(36);
    expect(trend.points[0].month).toBe("2023-07");
    // The total is what the months shown add up to, and the caption says which months those are.
    expect(trend.total).toBe(10);
    expect(trend.scope).toBe("All counties, all case types, Jul 2023 to Jun 2026");
    expect(computePanel(createPanel({ type: "trend", params: {} }, "t", []), records, [], today, { county: "Marion" }).scope).toBe("Marion County, all case types, Jul 2023 to Jun 2026");

    // A range that was asked for and is longer than 36 months is cut the same way, and says so.
    const asked = computePanel(createPanel({ type: "trend", params: { fromMonth: "2022-01", toMonth: "2026-06" } }, "t", []), records, [], today);
    expect(asked).toMatchObject({ total: 10, scope: "All counties, all case types, Jul 2023 to Jun 2026" });
    // The old months can be asked for by name, and then they are what is counted.
    const early = computePanel(createPanel({ type: "trend", params: { fromMonth: "2022-03", toMonth: "2022-04" } }, "t", []), records, [], today);
    expect(early).toMatchObject({ total: 2, scope: "All counties, all case types, Mar 2022 to Apr 2022" });
    // Nothing is cut for data that fits: the caption stays as it was.
    expect(compute({ type: "trend", params: {} }).scope).toBe("All counties, all case types, all months");
    expect(compute({ type: "trend", params: { fromMonth: "2026-03" } }).scope).toBe("All counties, all case types, from Mar 2026");
  });

  it("trend follows the month filters and reports nothing to show", () => {
    const window = compute({ type: "trend", params: { fromMonth: "2026-02", toMonth: "2026-03" } });
    expect(window.points.map((p) => [p.month, p.count])).toEqual([["2026-02", 2], ["2026-03", 2]]);
    expect(window.summary).toBe("Each of the 2 full months shown has 2 flagged filings.");
    const single = compute({ type: "trend", params: { fromMonth: "2026-04", toMonth: "2026-04" } });
    expect(single.summary).toBe("Apr 2026 has 1 flagged filing.");
    const none = compute({ type: "trend", params: { county: "Monroe" } });
    expect(none.total).toBe(0);
    expect(none.max).toBe(1);
    expect(none.summary).toBe("No flagged filings match these filters.");
  });

  it("before_after", () => {
    const data = compute({ type: "before_after", params: { eventId: "ev-apr" } });
    expect(data.event).toEqual(EVENT_APRIL_1);
    expect(data.eventDateLabel).toBe("Apr 1, 2026");
    expect(data.tag).toBe("Missing signature");
    expect(data.scope).toBe("Marion County, Small claims, Missing signature");
    expect(data.comparison).toEqual(beforeAfter(FIXTURE, EVENT_APRIL_1, "Missing signature", FIXTURE_TODAY));
    expect(data.points.map((p) => [p.label, p.count, p.phase, p.inProgress])).toEqual([
      ["Jan 2026", 2, "before", false],
      ["Feb 2026", 1, "before", false],
      ["Mar 2026", 1, "before", false],
      ["Apr 2026", 0, "after", false],
      ["May 2026", 1, "after", false],
      ["Jun 2026", 0, "in_progress", true],
    ]);
    expect(data.total).toBe(5);
    expect(data.max).toBe(2);
    expect(data.changeLabel).toBe("-62%");
    expect(data.summary).toBe(
      "Before the change: 1.3 per month over 3 full months. After: 0.5 per month over 2 full months. That is 62% fewer filings with Missing signature.",
    );
    expect(data.caveat).toBe(
      "This shows what happened after the change, not why. Other things may have changed in the same months. The counts are small, so one or two filings move the percentage a lot.",
    );
  });

  it("before_after can measure a different problem, and words an increase", () => {
    const data = compute({ type: "before_after", params: { eventId: "ev-apr", tag: "Missing fee or fee waiver" } });
    expect(data.tag).toBe("Missing fee or fee waiver");
    expect(data.changeLabel).toBe("+50%");
    expect(data.summary).toBe(
      "Before the change: 0.3 per month over 3 full months. After: 0.5 per month over 2 full months. That is 50% more filings with Missing fee or fee waiver.",
    );
  });

  it("before_after explains when there is no figure", () => {
    const noneBefore = compute({ type: "before_after", params: { eventId: "ev-apr", tag: "Wrong county or court" } });
    expect(noneBefore.changeLabel).toBe("n/a");
    expect(noneBefore.summary).toBe(
      "Before the change: 0 per month over 3 full months. After: 0 per month over 2 full months. There were none before the change, so a percentage cannot be given.",
    );

    const recent = computePanel(
      createPanel({ type: "before_after", params: { eventId: "ev-jun" } }, "p"),
      FIXTURE,
      [{ ...EVENT_APRIL_1, id: "ev-jun", date: "2026-06-01" }],
      FIXTURE_TODAY,
    );
    expect(recent.summary).toBe("There is no full month of data after this change yet.");
  });

  it("before_after for a change that is no longer on the list", () => {
    const data = compute({ type: "before_after", params: { eventId: "gone" } });
    expect(data).toMatchObject({
      type: "before_after",
      total: 0,
      event: null,
      eventDateLabel: null,
      comparison: null,
      points: [],
      max: 1,
      changeLabel: "n/a",
      summary: "This change is no longer on the list.",
    });
  });

  it("compare_counties", () => {
    const data = compute({ type: "compare_counties", params: { counties: ["Marion", "Lake", "Allen"], tag: "Wrong form" } });
    expect(data.total).toBe(10);
    expect(data.tag).toBe("Wrong form");
    expect(data.max).toBe(7);
    expect(data.rows).toEqual([
      { county: "Marion", total: 7, topTag: "Missing signature", topTagCount: 5, topTagShare: 71, tagCount: 2, tagShare: 29 },
      { county: "Lake", total: 2, topTag: "Missing required details", topTagCount: 1, topTagShare: 50, tagCount: 1, tagShare: 50 },
      { county: "Allen", total: 1, topTag: "Needs review", topTagCount: 1, topTagShare: 100, tagCount: 0, tagShare: 0 },
    ]);
    expect(data.scope).toBe("Marion, Lake and Allen, all case types, Wrong form, all months");
    expect(data.summary).toBe(
      "Of Marion, Lake and Allen, Marion County has the most: 7 flagged filings. Wrong form is on 50% of Lake County's flagged filings, the highest share among them.",
    );
  });

  it("compare_counties counts only the chosen counties and applies other filters", () => {
    const data = compute({ type: "compare_counties", params: { counties: ["Lake", "Allen"], caseType: "Family" } });
    expect(data.total).toBe(2);
    expect(data.tag).toBeNull();
    expect(data.rows.map((r) => [r.county, r.total, r.tagCount])).toEqual([["Lake", 1, null], ["Allen", 1, null]]);
    expect(data.summary).toBe("Of Lake and Allen, Lake County has the most: 1 flagged filing.");
    const none = compute({ type: "compare_counties", params: { counties: ["Monroe", "Hamilton"] } });
    expect(none).toMatchObject({ total: 0, max: 1, summary: "No flagged filings match these filters." });
  });

  it("needs_review", () => {
    const data = compute({ type: "needs_review", params: {} });
    expect(data.total).toBe(10);
    expect(data.count).toBe(1);
    expect(data.share).toBe(10);
    expect(data.byCounty).toEqual([{ label: "Allen", count: 1, share: 100 }]);
    expect(data.points.map((p) => p.count)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(data.summary).toBe("1 imported row needs a person to choose the problem (10% of 10 flagged filings).");
    const none = compute({ type: "needs_review", params: { county: "Marion" } });
    expect(none).toMatchObject({ total: 7, count: 0, share: 0, byCounty: [], summary: "No imported rows are waiting for review." });
  });

  it("returns data of the spec's own type for every panel type, and is pure", () => {
    const drafts: PanelDraft[] = [
      { type: "kpi", params: {} },
      { type: "ranked", params: { dimension: "tag" } },
      { type: "heat", params: {} },
      { type: "forms", params: {} },
      { type: "trend", params: {} },
      { type: "before_after", params: { eventId: "ev-apr" } },
      { type: "compare_counties", params: { counties: ["Marion", "Lake"] } },
      { type: "needs_review", params: {} },
    ];
    expect(drafts.map((d) => d.type)).toEqual([...PANEL_TYPES]);
    const before = JSON.stringify(FIXTURE);
    for (const draft of drafts) {
      const spec = createPanel(draft, `p-${draft.type}`);
      const first = computePanel(spec, FIXTURE, EVENTS, FIXTURE_TODAY);
      expect(first.type).toBe(draft.type);
      expect(first.summary.length).toBeGreaterThan(0);
      expect(computePanel(spec, FIXTURE, EVENTS, FIXTURE_TODAY)).toEqual(first);
      // Every panel survives a round trip through JSON, which is how the MCP tools send it.
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
      // Every panel copes with no records at all.
      expect(computePanel(spec, [], EVENTS, FIXTURE_TODAY).type).toBe(draft.type);
    }
    expect(JSON.stringify(FIXTURE)).toBe(before);
  });
});

describe("computePanel on the sample data", () => {
  const records = makeSampleRecords();

  it("kpi matches the stats functions and the prototype's headline numbers", () => {
    const data = computePanel(createPanel({ type: "kpi", params: {} }, "k"), records, SAMPLE_EVENTS, SAMPLE_TODAY);
    if (data.type !== "kpi") throw new Error("wrong type");
    const k = kpis(records);
    expect(data.total).toBe(900);
    expect(data.tiles.map((t) => t.value)).toEqual(["900", "Missing required details", "Marion", "45%"]);
    expect(data.tiles[1].detail).toBe(`on ${k.topTag?.share}% of flagged filings`);
    expect(data.tiles[2].detail).toBe("284 flagged filings");
    expect(data.tiles[3].detail).toBe("176 fixed at the counter");
    expect(data.months).toHaveLength(10);
    expect(data.tiles[0].trend?.reduce((a, b) => a + b, 0)).toBe(900);
  });

  it("a filtered panel equals the same panel computed on pre-filtered records", () => {
    const filtered = applyFilters(records, { county: "Lake" });
    const a = computePanel(createPanel({ type: "ranked", params: { dimension: "tag", county: "Lake" } }, "a"), records, SAMPLE_EVENTS, SAMPLE_TODAY);
    const b = computePanel(createPanel({ type: "ranked", params: { dimension: "tag" } }, "a"), filtered, SAMPLE_EVENTS, SAMPLE_TODAY);
    if (a.type !== "ranked" || b.type !== "ranked") throw new Error("wrong type");
    expect(a.rows).toEqual(b.rows);
    expect(a.total).toBe(b.total);
  });

  it("the heat panel shows all eight counties for a viewer who sees them all, and one for a clerk", () => {
    const all = computePanel(createPanel({ type: "heat", params: {} }, "h"), records, SAMPLE_EVENTS, SAMPLE_TODAY);
    const clerk = computePanel(createPanel({ type: "heat", params: {} }, "h"), applyFilters(records, { county: "Lake" }), SAMPLE_EVENTS, SAMPLE_TODAY);
    if (all.type !== "heat" || clerk.type !== "heat") throw new Error("wrong type");
    expect(all.rows.map((r) => r.county)).toEqual([...COUNTIES]);
    expect(clerk.rows.map((r) => r.county)).toEqual(["Lake"]);
  });

  it("the sample before/after panel for Marion small claims reads as the prototype does", () => {
    const data = computePanel(createPanel({ type: "before_after", params: { eventId: "sc-form" } }, "b", SAMPLE_EVENTS), records, SAMPLE_EVENTS, SAMPLE_TODAY);
    if (data.type !== "before_after") throw new Error("wrong type");
    expect(data.changeLabel).toBe("-75%");
    expect(data.summary).toBe("Before the change: 4 per month over 5 full months. After: 1 per month over 4 full months. That is 75% fewer filings with Missing signature.");
    expect(data.caveat).toBe("This shows what happened after the change, not why. Other things may have changed in the same months.");
    expect(data.points).toHaveLength(10);
    expect(data.points[9]).toMatchObject({ month: "2026-10", inProgress: true, phase: "in_progress" });
  });
});

describe("titles, sizes and filter text", () => {
  it("defaultTitle for every type", () => {
    expect(defaultTitle({ type: "kpi", params: {} })).toBe("Key numbers");
    expect(defaultTitle({ type: "kpi", params: { county: "Marion", caseType: "Small claims" } })).toBe("Key numbers: Marion, Small claims");
    expect(defaultTitle({ type: "ranked", params: { dimension: "tag" } })).toBe("Most common problems");
    expect(defaultTitle({ type: "ranked", params: { dimension: "outcome", county: "Lake" } })).toBe("Outcomes: Lake");
    expect(defaultTitle({ type: "ranked", params: { dimension: "county" } })).toBe("Flagged filings by county");
    expect(defaultTitle({ type: "ranked", params: { dimension: "caseType" } })).toBe("Flagged filings by case type");
    expect(defaultTitle({ type: "ranked", params: { dimension: "form" } })).toBe("Flagged filings by form");
    expect(defaultTitle({ type: "heat", params: { fromMonth: "2026-06", toMonth: "2026-09" } })).toBe("County by problem: Jun 2026 to Sep 2026");
    expect(defaultTitle({ type: "forms", params: { caseType: "Family" } })).toBe("Forms: Family");
    expect(defaultTitle({ type: "trend", params: {} })).toBe("Flagged filings by month");
    expect(defaultTitle({ type: "trend", params: { tag: "Wrong form", county: "Allen" } })).toBe("Wrong form by month: Allen");
    expect(defaultTitle({ type: "before_after", params: { eventId: "sc-form" } }, SAMPLE_EVENTS)).toBe("Before and after: Revised small claims form (Marion, Jun 1)");
    expect(defaultTitle({ type: "before_after", params: { eventId: "sc-form" } })).toBe("Before and after a change");
    expect(defaultTitle({ type: "compare_counties", params: { counties: ["Marion", "Lake", "Allen"] } })).toBe("Compare Marion, Lake and Allen");
    expect(defaultTitle({ type: "needs_review", params: { county: "Lake" } })).toBe("Needs review: Lake");
  });

  it("defaultTitle never exceeds the title limit, so it always passes the schema", () => {
    const long = defaultTitle({
      type: "trend",
      params: { tag: "Missing addresses for service", county: "St. Joseph", caseType: "Protective order", form: "Petition to modify or extend order", fromMonth: "2026-01", toMonth: "2026-10" },
    });
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("...")).toBe(true);
  });

  it("createPanel fills in title and size, keeps the ones given, and produces a valid spec", () => {
    const made = createPanel({ type: "ranked", params: { dimension: "tag", county: "Lake" } }, "id-1");
    expect(made).toEqual({ id: "id-1", title: "Most common problems: Lake", size: "s", type: "ranked", params: { dimension: "tag", county: "Lake" } });
    expect(PanelSpec.parse(made)).toEqual(made);
    const custom = createPanel({ type: "heat", params: {}, title: "  My table ", size: "w" }, "id-2");
    expect(custom).toMatchObject({ title: "My table", size: "w" });
    expect(createPanel({ type: "kpi", params: {}, title: "   " }, "id-3").title).toBe("Key numbers");
  });

  it("every panel type has a label and a default size", () => {
    for (const type of PANEL_TYPES) {
      expect(PANEL_TYPE_LABELS[type].length).toBeGreaterThan(0);
      expect(["s", "w", "l"]).toContain(defaultSize(type));
    }
  });

  it("describeFilters and filterChips", () => {
    expect(describeFilters({})).toBe("All counties, all case types, all months");
    expect(describeFilters({ county: "Marion", caseType: "Small claims", fromMonth: "2026-06", toMonth: "2026-09" })).toBe("Marion County, Small claims, Jun 2026 to Sep 2026");
    expect(describeFilters({ fromMonth: "2026-06" })).toBe("All counties, all case types, from Jun 2026");
    expect(describeFilters({ toMonth: "2026-06" })).toBe("All counties, all case types, through Jun 2026");
    // A clerk sees one county, so the caption names it; a county filter still wins.
    expect(describeFilters({}, "Lake")).toBe("Lake County, all case types, all months");
    expect(describeFilters({ county: "Marion" }, "Lake")).toBe("Marion County, all case types, all months");
    expect(describeFilters({ fromMonth: "2026-06", toMonth: "2026-06" })).toBe("All counties, all case types, Jun 2026");
    expect(describeFilters({ fromMonth: "2026-09", toMonth: "2026-06" })).toBe("All counties, all case types, Jun 2026 to Sep 2026");
    expect(filterChips({})).toEqual([]);
    expect(filterChips({ toMonth: "2026-09", tag: "Wrong form", county: "Lake" })).toEqual([
      { key: "county", label: "Lake County" },
      { key: "tag", label: "Wrong form" },
      { key: "toMonth", label: "Through Sep 2026" },
    ]);
  });

  it("monthWindow", () => {
    expect(monthWindow(FIXTURE, {}, FIXTURE_TODAY)).toEqual(JAN_TO_JUN);
    expect(monthWindow(FIXTURE, { fromMonth: "2026-03" }, FIXTURE_TODAY)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(monthWindow(FIXTURE, { fromMonth: "2026-04", toMonth: "2026-02" }, FIXTURE_TODAY)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(monthWindow([], {}, FIXTURE_TODAY)).toEqual(["2026-06"]);
    const long = monthWindow([{ ...FIXTURE[0], date: "2020-01-15" }], {}, FIXTURE_TODAY);
    expect(long).toHaveLength(36);
    expect(long[35]).toBe("2026-06");
  });

  it("monthChoices offers every month there is data for, however old", () => {
    expect(monthChoices(FIXTURE, FIXTURE_TODAY)).toEqual(JAN_TO_JUN);
    expect(monthChoices([], FIXTURE_TODAY)).toEqual(["2026-06"]);
    const long = monthChoices([{ ...FIXTURE[0], date: "2020-01-15" }], FIXTURE_TODAY);
    expect(long).toHaveLength(78);
    expect(long[0]).toBe("2020-01");
    expect(long[77]).toBe("2026-06");
  });
});

describe("example folders", () => {
  const folders = EXAMPLE_FOLDERS;

  it("are three folders of valid panels with unique ids", () => {
    expect(folders.map((f) => f.name)).toEqual(["Marion small claims", "Lake protective orders", "County comparison"]);
    for (const folder of folders) {
      expect(FolderInput.safeParse({ id: folder.id, name: folder.name, panels: folder.panels }).success).toBe(true);
      expect(folder.panels.length).toBeGreaterThanOrEqual(3);
    }
    const ids = folders.flatMap((f) => f.panels.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every example panel has something to show on the sample data", () => {
    const records = makeSampleRecords();
    for (const folder of folders) {
      for (const panel of folder.panels) {
        const data = computePanel(panel, records, SAMPLE_EVENTS, SAMPLE_TODAY);
        expect(data.type).toBe(panel.type);
        expect(data.total).toBeGreaterThan(0);
        if (data.type === "before_after") expect(data.event).not.toBeNull();
      }
    }
  });

  it("leaders and admins get all three; a clerk gets the one about their county", () => {
    expect(exampleFoldersFor({ role: "leader", county: null })).toEqual(EXAMPLE_FOLDERS);
    expect(exampleFoldersFor({ role: "admin", county: null })).toHaveLength(3);
    expect(exampleFoldersFor({ role: "clerk", county: "Marion" }).map((f) => f.name)).toEqual(["Marion small claims"]);
    expect(exampleFoldersFor({ role: "clerk", county: "Lake" }).map((f) => f.name)).toEqual(["Lake protective orders"]);
    expect(exampleFoldersFor({ role: "clerk", county: "Monroe" })).toEqual([]);
    expect(Object.keys(EXAMPLE_FOLDERS[0]).sort()).toEqual(["id", "name", "panels"]);
    expect(EXAMPLE_FOLDERS[0].panels[2].title).toBe("Before and after: Revised small claims form (Marion, Jun 1)");
  });
});
