import { describe, expect, it } from "vitest";
import { COUNTIES, OUTCOMES, TAGS } from "@/lib/domain";
import { SAMPLE_EVENTS, SAMPLE_TODAY, makeSampleRecords } from "@/lib/sample";
import {
  applyFilters,
  beforeAfter,
  byForm,
  compareCounties,
  countBy,
  countTags,
  countyByProblem,
  kpis,
  monthlySeries,
  pct,
  rank,
  sparkline,
} from "@/lib/stats";
import { monthsBetween } from "@/lib/time";
import { EVENT_APRIL_1, EVENT_MARCH_15, FIXTURE, FIXTURE_TODAY } from "./fixture";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("stats on the hand-made fixture", () => {
  it("pct rounds to a whole number and is 0 for an empty whole", () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
    expect(pct(0, 0)).toBe(0);
    expect(pct(5, 0)).toBe(0);
  });

  it("applyFilters applies each filter and combines them", () => {
    expect(applyFilters(FIXTURE, {})).toHaveLength(10);
    expect(applyFilters(FIXTURE, { county: "Marion" })).toHaveLength(7);
    expect(applyFilters(FIXTURE, { caseType: "Family" }).map((r) => r.county)).toEqual(["Lake", "Allen"]);
    expect(applyFilters(FIXTURE, { form: "Small claims counterclaim" })).toHaveLength(1);
    expect(applyFilters(FIXTURE, { tag: "Wrong form" }).map((r) => r.date)).toEqual(["2026-01-20", "2026-02-15", "2026-03-03"]);
    expect(applyFilters(FIXTURE, { tag: "Needs review" })).toHaveLength(1);
    expect(applyFilters(FIXTURE, { fromMonth: "2026-03", toMonth: "2026-04" }).map((r) => r.date)).toEqual(["2026-03-03", "2026-03-20", "2026-04-02"]);
    expect(applyFilters(FIXTURE, { fromMonth: "2026-06" })).toHaveLength(2);
    expect(applyFilters(FIXTURE, { toMonth: "2026-01" })).toHaveLength(2);
    expect(applyFilters(FIXTURE, { county: "Marion", tag: "Wrong form", fromMonth: "2026-02" }).map((r) => r.date)).toEqual(["2026-03-03"]);
  });

  it("applyFilters reads a reversed month range the right way round", () => {
    expect(applyFilters(FIXTURE, { fromMonth: "2026-04", toMonth: "2026-03" })).toHaveLength(3);
  });

  it("countTags counts a filing once under each of its problems", () => {
    expect(countTags(FIXTURE)).toEqual({
      "Missing signature": 5,
      "Wrong form": 3,
      "Missing fee or fee waiver": 2,
      "Missing required details": 1,
      "Needs review": 1,
      "Wrong county or court": 1,
    });
    expect(countTags([])).toEqual({});
  });

  it("rank sorts by count, breaks ties by label, and gives shares of the total", () => {
    expect(rank(countTags(FIXTURE), FIXTURE.length)).toEqual([
      { label: "Missing signature", count: 5, share: 50 },
      { label: "Wrong form", count: 3, share: 30 },
      { label: "Missing fee or fee waiver", count: 2, share: 20 },
      { label: "Missing required details", count: 1, share: 10 },
      { label: "Needs review", count: 1, share: 10 },
      { label: "Wrong county or court", count: 1, share: 10 },
    ]);
    expect(rank({ a: 0, b: 2 }, 2)).toEqual([{ label: "b", count: 2, share: 100 }]);
    expect(rank({}, 0)).toEqual([]);
  });

  it("kpis", () => {
    expect(kpis(FIXTURE)).toEqual({
      total: 10,
      topTag: { label: "Missing signature", count: 5, share: 50 },
      topCounty: { label: "Marion", count: 7, share: 70 },
      multiProblem: { count: 2, share: 20 },
      fixedAtCounter: 2,
      outcomes: [
        { label: "Rejected", count: 6, share: 60 },
        { label: "Returned to fix", count: 2, share: 20 },
        { label: "Fixed at counter", count: 2, share: 20 },
      ],
    });
  });

  it("kpis on no records", () => {
    expect(kpis([])).toEqual({
      total: 0,
      topTag: null,
      topCounty: null,
      multiProblem: { count: 0, share: 0 },
      fixedAtCounter: 0,
      outcomes: [],
    });
  });

  it("countyByProblem builds columns from the top problems and rows in the order asked", () => {
    expect(countyByProblem(FIXTURE, { maxTags: 2, counties: ["Marion", "Lake", "Allen"] })).toEqual({
      tags: ["Missing signature", "Wrong form"],
      rows: [
        { county: "Marion", cells: [5, 2], total: 7 },
        { county: "Lake", cells: [0, 1], total: 2 },
        { county: "Allen", cells: [0, 0], total: 1 },
      ],
      max: 5,
    });
  });

  it("countyByProblem defaults to every county and six columns, and max is at least 1", () => {
    const table = countyByProblem(FIXTURE);
    expect(table.rows.map((r) => r.county)).toEqual([...COUNTIES]);
    expect(table.tags).toHaveLength(6);
    expect(countyByProblem([]).max).toBe(1);
    expect(countyByProblem([]).tags).toEqual([]);
  });

  it("byForm", () => {
    expect(byForm(FIXTURE)).toEqual([
      { form: "Small claims notice of claim", caseType: "Small claims", flagged: 6, topTag: "Missing signature", topTagCount: 4, topShare: 67 },
      { form: "Petition for dissolution, no children", caseType: "Family", flagged: 1, topTag: "Wrong form", topTagCount: 1, topShare: 100 },
      { form: "Petition for order of protection", caseType: "Protective order", flagged: 1, topTag: "Missing required details", topTagCount: 1, topShare: 100 },
      { form: "Petition to modify child support", caseType: "Family", flagged: 1, topTag: "Needs review", topTagCount: 1, topShare: 100 },
      { form: "Small claims counterclaim", caseType: "Small claims", flagged: 1, topTag: "Missing signature", topTagCount: 1, topShare: 100 },
    ]);
  });

  it("monthlySeries counts per month, with zero months kept, optionally for one problem", () => {
    const months = monthsBetween("2026-01", "2026-06");
    expect(monthlySeries(FIXTURE, months).map((p) => p.count)).toEqual([2, 2, 2, 1, 1, 2]);
    expect(monthlySeries(FIXTURE, months, "Missing signature").map((p) => p.count)).toEqual([2, 1, 1, 0, 1, 0]);
    expect(monthlySeries(FIXTURE, ["2025-12", "2026-07"])).toEqual([
      { month: "2025-12", count: 0 },
      { month: "2026-07", count: 0 },
    ]);
  });

  it("beforeAfter averages full months only and leaves out the month in progress", () => {
    const result = beforeAfter(FIXTURE, EVENT_APRIL_1, "Missing signature", FIXTURE_TODAY);
    expect(result.series).toEqual([
      { month: "2026-01", count: 2, phase: "before" },
      { month: "2026-02", count: 1, phase: "before" },
      { month: "2026-03", count: 1, phase: "before" },
      { month: "2026-04", count: 0, phase: "after" },
      { month: "2026-05", count: 1, phase: "after" },
      { month: "2026-06", count: 0, phase: "in_progress" },
    ]);
    expect(result.before).toEqual({ months: 3, total: 4, perMonth: 1.3 });
    expect(result.after).toEqual({ months: 2, total: 1, perMonth: 0.5 });
    // (0.5 - 1.3333) / 1.3333 = -62.5%, which rounds to -62.
    expect(result.changePct).toBe(-62);
    expect(result.direction).toBe("down");
    expect(result.missing).toBeNull();
    expect(result).toMatchObject({ eventId: "ev-apr", tag: "Missing signature", county: "Marion", caseType: "Small claims" });
  });

  it("beforeAfter leaves out the month of a mid-month change from both sides", () => {
    const result = beforeAfter(FIXTURE, EVENT_MARCH_15, "Missing signature", FIXTURE_TODAY);
    expect(result.series.map((p) => p.phase)).toEqual(["before", "before", "change", "after", "after", "in_progress"]);
    expect(result.before).toEqual({ months: 2, total: 3, perMonth: 1.5 });
    expect(result.after).toEqual({ months: 2, total: 1, perMonth: 0.5 });
    expect(result.changePct).toBe(-67);
  });

  it("beforeAfter only counts the change's own county and case type", () => {
    const other = beforeAfter(FIXTURE, { ...EVENT_APRIL_1, county: "Lake", caseType: "Family" }, "Wrong form", FIXTURE_TODAY);
    expect(other.series.map((p) => p.count)).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it("beforeAfter reports an increase and no change", () => {
    const up = beforeAfter(FIXTURE, EVENT_APRIL_1, "Missing fee or fee waiver", FIXTURE_TODAY);
    // Before: 1 in 3 months. After: 1 in 2 months. (0.5 - 0.3333) / 0.3333 = +50%.
    expect(up.changePct).toBe(50);
    expect(up.direction).toBe("up");

    // Wrong form in Marion small claims with a change on Mar 1 and today in May:
    // before Jan 1, Feb 0 = 0.5 a month; after Mar 1, Apr 0 = 0.5 a month.
    const flat = beforeAfter(FIXTURE, { ...EVENT_APRIL_1, date: "2026-03-01" }, "Wrong form", "2026-05-20");
    expect(flat.before).toEqual({ months: 2, total: 1, perMonth: 0.5 });
    expect(flat.after).toEqual({ months: 2, total: 1, perMonth: 0.5 });
    expect(flat.changePct).toBe(0);
    expect(flat.direction).toBe("flat");
  });

  it("beforeAfter says why there is no percentage", () => {
    const noAfter = beforeAfter(FIXTURE, { ...EVENT_APRIL_1, date: "2026-06-01" }, "Missing signature", FIXTURE_TODAY);
    expect(noAfter.changePct).toBeNull();
    expect(noAfter.missing).toBe("no_full_months_after");
    expect(noAfter.direction).toBe("unknown");

    const noBefore = beforeAfter(FIXTURE, { ...EVENT_APRIL_1, date: "2026-01-01" }, "Missing signature", FIXTURE_TODAY);
    expect(noBefore.missing).toBe("no_full_months_before");

    const noneBefore = beforeAfter(FIXTURE, EVENT_APRIL_1, "Wrong county or court", FIXTURE_TODAY);
    expect(noneBefore.before.total).toBe(0);
    expect(noneBefore.missing).toBe("none_before");
    expect(noneBefore.changePct).toBeNull();
  });

  it("beforeAfter looks at most 12 months to each side of the change", () => {
    const old = { ...FIXTURE[0], date: "2023-01-10" };
    const result = beforeAfter([old, ...FIXTURE], { ...EVENT_APRIL_1, date: "2025-01-01" }, "Missing signature", "2026-12-15");
    expect(result.series[0].month).toBe("2024-01");
    expect(result.series[result.series.length - 1].month).toBe("2026-01");
    expect(result.before.months).toBe(12);
    expect(result.after.months).toBe(13);
  });

  it("compareCounties", () => {
    expect(compareCounties(FIXTURE, ["Marion", "Lake", "Allen"], "Wrong form")).toEqual([
      { county: "Marion", total: 7, topTag: "Missing signature", topTagCount: 5, topTagShare: 71, tagCount: 2, tagShare: 29 },
      { county: "Lake", total: 2, topTag: "Missing required details", topTagCount: 1, topTagShare: 50, tagCount: 1, tagShare: 50 },
      { county: "Allen", total: 1, topTag: "Needs review", topTagCount: 1, topTagShare: 100, tagCount: 0, tagShare: 0 },
    ]);
    expect(compareCounties(FIXTURE, ["Hamilton"])).toEqual([
      { county: "Hamilton", total: 0, topTag: null, topTagCount: 0, topTagShare: 0, tagCount: null, tagShare: null },
    ]);
  });

  it("sparkline maps values onto the box with zero at the bottom", () => {
    expect(sparkline([0, 5, 10], 100, 20, 0)).toBe("0,20 50,10 100,0");
    expect(sparkline([3, 3], 10, 10, 0)).toBe("0,0 10,0");
    expect(sparkline([0, 0, 0], 20, 10, 0)).toBe("0,10 10,10 20,10");
    expect(sparkline([4])).toBe("");
    expect(sparkline([])).toBe("");
  });
});

describe("stats invariants on the 900-record sample", () => {
  const records = makeSampleRecords();
  const months = monthsBetween("2026-01", "2026-10");

  it("every breakdown adds back up to the total", () => {
    expect(records).toHaveLength(900);
    expect(sum(Object.values(countBy(records, (r) => r.county)))).toBe(900);
    expect(sum(Object.values(countBy(records, (r) => r.outcome)))).toBe(900);
    expect(sum(Object.values(countBy(records, (r) => r.caseType)))).toBe(900);
    expect(sum(monthlySeries(records, months).map((p) => p.count))).toBe(900);
    expect(sum(byForm(records).map((row) => row.flagged))).toBe(900);
    expect(sum(countyByProblem(records).rows.map((row) => row.total))).toBe(900);
    expect(sum(kpis(records).outcomes.map((o) => o.count))).toBe(900);
  });

  it("tag counts equal the number of tags on the records", () => {
    const counts = countTags(records);
    expect(sum(Object.values(counts))).toBe(sum(records.map((r) => r.tags.length)));
    for (const tag of TAGS) {
      expect(counts[tag]).toBe(records.filter((r) => r.tags.includes(tag)).length);
    }
  });

  it("rank is sorted and its top entry is the KPI top problem", () => {
    const ranked = rank(countTags(records), records.length);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].count).toBeGreaterThanOrEqual(ranked[i].count);
    expect(kpis(records).topTag).toEqual(ranked[0]);
  });

  it("filtering by each county splits the records with nothing lost or doubled", () => {
    expect(sum(COUNTIES.map((county) => applyFilters(records, { county }).length))).toBe(900);
    expect(sum(OUTCOMES.map((outcome) => records.filter((r) => r.outcome === outcome).length))).toBe(900);
  });

  it("heat table cells never exceed their row total and match a direct count", () => {
    const table = countyByProblem(records);
    for (const row of table.rows) {
      row.cells.forEach((cell, i) => {
        expect(cell).toBeLessThanOrEqual(row.total);
        expect(cell).toBe(records.filter((r) => r.county === row.county && r.tags.includes(table.tags[i])).length);
      });
    }
    expect(table.max).toBe(Math.max(...table.rows.flatMap((row) => row.cells)));
  });

  it("the monthly series of each problem adds up to that problem's count", () => {
    const counts = countTags(records);
    for (const tag of TAGS) {
      expect(sum(monthlySeries(records, months, tag).map((p) => p.count))).toBe(counts[tag]);
    }
  });

  it("before/after on each sample change covers every month once and adds up", () => {
    for (const event of SAMPLE_EVENTS) {
      const result = beforeAfter(records, event, event.tag, SAMPLE_TODAY);
      expect(result.series.map((p) => p.month)).toEqual(months);
      expect(result.series[result.series.length - 1].phase).toBe("in_progress");
      const scoped = records.filter((r) => r.county === event.county && r.caseType === event.caseType && r.tags.includes(event.tag));
      expect(sum(result.series.map((p) => p.count))).toBe(scoped.length);
      expect(result.before.total).toBe(sum(result.series.filter((p) => p.phase === "before").map((p) => p.count)));
      expect(result.after.total).toBe(sum(result.series.filter((p) => p.phase === "after").map((p) => p.count)));
    }
  });

  it("the Marion small claims change shows the drop the prototype shows: 4.0 a month before, 1.0 after", () => {
    const result = beforeAfter(records, SAMPLE_EVENTS[0], "Missing signature", SAMPLE_TODAY);
    expect(result.before).toEqual({ months: 5, total: 20, perMonth: 4 });
    expect(result.after).toEqual({ months: 4, total: 4, perMonth: 1 });
    expect(result.changePct).toBe(-75);
  });

  it("the mid-month Lake change leaves July out of both averages", () => {
    const result = beforeAfter(records, SAMPLE_EVENTS[1], "Missing required details", SAMPLE_TODAY);
    expect(result.series.find((p) => p.month === "2026-07")?.phase).toBe("change");
    expect(result.before.months).toBe(6);
    expect(result.after.months).toBe(2);
  });
});
