import { describe, expect, it } from "vitest";
import { CASE_TYPES, COUNTIES, OUTCOMES, TAGS } from "@/lib/domain";
import { makeSampleRecords, SAMPLE_EVENTS, SAMPLE_TODAY } from "@/lib/sample";
import { AGGREGATE_TOOLS, callAggregateTool } from "@/server/tools";
import type { ToolContext, ToolOutcome } from "@/server/tools";
import { EVENT_APRIL_1, EVENT_MARCH_15, FIXTURE, FIXTURE_TODAY } from "./fixture";

// Every expected number below is worked out by hand from the ten filings listed in fixture.ts.

const CONTEXT: ToolContext = { flags: FIXTURE, events: [EVENT_APRIL_1, EVENT_MARCH_15], viewerCounty: null, todayIso: FIXTURE_TODAY, mode: "supabase" };
const DEMO: ToolContext = { flags: makeSampleRecords(), events: SAMPLE_EVENTS, viewerCounty: null, todayIso: SAMPLE_TODAY, mode: "demo" };

function result(outcome: ToolOutcome): Record<string, unknown> {
  if (!outcome.ok) throw new Error(`The tool failed: ${outcome.error}`);
  return outcome.result;
}

const run = (name: string, input: unknown = {}, context: ToolContext = CONTEXT) => result(callAggregateTool(name, input, context));

describe("the tool list", () => {
  it("offers the five read-only tools, reference values first", () => {
    expect(AGGREGATE_TOOLS.map((tool) => tool.name)).toEqual([
      "list_reference_values",
      "get_problem_counts",
      "get_county_breakdown",
      "get_form_breakdown",
      "compare_before_after",
    ]);
    for (const tool of AGGREGATE_TOOLS) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(60);
    }
  });

  it("answers an unknown tool name with an error, not an exception", () => {
    expect(callAggregateTool("delete_flags", {}, CONTEXT)).toEqual({ ok: false, error: "There is no tool named delete_flags." });
  });
});

describe("get_problem_counts", () => {
  it("counts every problem and outcome across all ten filings", () => {
    expect(run("get_problem_counts")).toEqual({
      scope: "All counties, all case types, all months",
      flaggedFilings: 10,
      problems: [
        { problem: "Missing signature", filings: 5, percentOfFlaggedFilings: 50 },
        { problem: "Wrong form", filings: 3, percentOfFlaggedFilings: 30 },
        { problem: "Missing fee or fee waiver", filings: 2, percentOfFlaggedFilings: 20 },
        { problem: "Missing required details", filings: 1, percentOfFlaggedFilings: 10 },
        { problem: "Wrong county or court", filings: 1, percentOfFlaggedFilings: 10 },
      ],
      problemsNotShown: 0,
      outcomes: [
        { outcome: "Rejected", filings: 6, percentOfFlaggedFilings: 60 },
        { outcome: "Returned to fix", filings: 2, percentOfFlaggedFilings: 20 },
        { outcome: "Fixed at counter", filings: 2, percentOfFlaggedFilings: 20 },
      ],
      filingsWithMoreThanOneProblem: { filings: 2, percentOfFlaggedFilings: 20 },
      importedRowsWaitingForReview: 1,
      sampleData: false,
    });
  });

  it("applies a county filter and a limit, and says how many problems it left out", () => {
    const marion = run("get_problem_counts", { county: "Marion", limit: 2 });
    expect(marion.flaggedFilings).toBe(7);
    expect(marion.problems).toEqual([
      { problem: "Missing signature", filings: 5, percentOfFlaggedFilings: 71 },
      { problem: "Missing fee or fee waiver", filings: 2, percentOfFlaggedFilings: 29 },
    ]);
    expect(marion.problemsNotShown).toBe(2);
    expect(marion.importedRowsWaitingForReview).toBe(0);
    expect(marion.scope).toContain("Marion");
  });

  it("applies a problem filter and a month range", () => {
    // Filings 2, 4 and 5 carry Wrong form; filing 2 also has Missing signature, filing 5 two more.
    const wrongForm = run("get_problem_counts", { tag: "Wrong form" });
    expect(wrongForm.flaggedFilings).toBe(3);
    expect(wrongForm.filingsWithMoreThanOneProblem).toEqual({ filings: 2, percentOfFlaggedFilings: 67 });
    // March to May: filings 5, 6, 7 and 8.
    const spring = run("get_problem_counts", { fromMonth: "2026-03", toMonth: "2026-05" });
    expect(spring.flaggedFilings).toBe(4);
    expect(spring.outcomes).toEqual([
      { outcome: "Rejected", filings: 2, percentOfFlaggedFilings: 50 },
      { outcome: "Returned to fix", filings: 1, percentOfFlaggedFilings: 25 },
      { outcome: "Fixed at counter", filings: 1, percentOfFlaggedFilings: 25 },
    ]);
  });

  it("answers zero, not an error, when nothing matches", () => {
    const none = run("get_problem_counts", { county: "Monroe" });
    expect(none).toMatchObject({ flaggedFilings: 0, problems: [], problemsNotShown: 0, importedRowsWaitingForReview: 0 });
    expect(none.filingsWithMoreThanOneProblem).toEqual({ filings: 0, percentOfFlaggedFilings: 0 });
  });
});

describe("get_county_breakdown", () => {
  it("breaks each county's filings out by the most common problems", () => {
    const table = run("get_county_breakdown");
    expect(table.flaggedFilings).toBe(10);
    expect(table.problems).toEqual([
      "Missing signature",
      "Wrong form",
      "Missing fee or fee waiver",
      "Missing required details",
      "Needs review",
      "Wrong county or court",
    ]);
    const counties = table.counties as { county: string; flaggedFilings: number; byProblem: { problem: string; filings: number }[] }[];
    expect(counties.map((row) => [row.county, row.flaggedFilings, row.byProblem.map((cell) => cell.filings)])).toEqual([
      ["Marion", 7, [5, 2, 2, 0, 0, 1]],
      ["Lake", 2, [0, 1, 0, 1, 0, 0]],
      ["Allen", 1, [0, 0, 0, 0, 1, 0]],
    ]);
    expect(counties[0].byProblem[0]).toEqual({ problem: "Missing signature", filings: 5 });
  });

  it("applies a case type filter and a cap on the problems broken out", () => {
    const family = run("get_county_breakdown", { caseType: "Family", maxProblems: 2 });
    expect(family.flaggedFilings).toBe(2);
    expect(family.problems).toEqual(["Needs review", "Wrong form"]);
    const counties = family.counties as { county: string; flaggedFilings: number; byProblem: { filings: number }[] }[];
    expect(counties.map((row) => [row.county, row.flaggedFilings, row.byProblem.map((cell) => cell.filings)])).toEqual([
      ["Marion", 0, [0, 0]],
      ["Lake", 1, [0, 1]],
      ["Allen", 1, [1, 0]],
    ]);
  });

  it("lists only the county asked for, or only the counties the caller has data for", () => {
    const lake = run("get_county_breakdown", { county: "Lake" }).counties as { county: string }[];
    expect(lake.map((row) => row.county)).toEqual(["Lake"]);
    const clerk: ToolContext = { ...CONTEXT, flags: FIXTURE.filter((flag) => flag.county === "Marion"), viewerCounty: "Marion" };
    const scoped = run("get_county_breakdown", {}, clerk);
    expect(scoped.flaggedFilings).toBe(7);
    expect((scoped.counties as { county: string }[]).map((row) => row.county)).toEqual(["Marion"]);
  });
});

describe("a caller who sees one county", () => {
  const clerk: ToolContext = { ...CONTEXT, flags: FIXTURE.filter((flag) => flag.county === "Marion"), viewerCounty: "Marion" };

  it.each(["get_problem_counts", "get_county_breakdown", "get_form_breakdown"])("%s names that county in the scope, never all counties", (name) => {
    expect(run(name, {}, clerk)).toMatchObject({ scope: "Marion County, all case types, all months", flaggedFilings: 7 });
    expect(run(name, { caseType: "Small claims" }, clerk).scope).toBe("Marion County, Small claims, all months");
    // Someone who sees every county is told so, as before.
    expect(run(name, {}).scope).toBe("All counties, all case types, all months");
  });
});

describe("get_form_breakdown", () => {
  it("ranks the forms and names each form's most common problem", () => {
    expect(run("get_form_breakdown", { county: "Marion" })).toEqual({
      scope: "Marion County, all case types, all months",
      flaggedFilings: 7,
      forms: [
        {
          form: "Small claims notice of claim",
          caseType: "Small claims",
          flaggedFilings: 6,
          mostCommonProblem: "Missing signature",
          filingsWithThatProblem: 4,
          percentOfThisFormsFilings: 67,
        },
        {
          form: "Small claims counterclaim",
          caseType: "Small claims",
          flaggedFilings: 1,
          mostCommonProblem: "Missing signature",
          filingsWithThatProblem: 1,
          percentOfThisFormsFilings: 100,
        },
      ],
      sampleData: false,
    });
  });

  it("covers every form that has a flagged filing", () => {
    const all = run("get_form_breakdown").forms as { form: string; flaggedFilings: number }[];
    expect(all).toHaveLength(5);
    expect(all[0]).toMatchObject({ form: "Small claims notice of claim", flaggedFilings: 6 });
    expect(all.reduce((sum, row) => sum + row.flaggedFilings, 0)).toBe(10);
  });
});

describe("compare_before_after", () => {
  it("averages full months on each side of a change that started on the first of a month", () => {
    // Missing signature in Marion small claims: Jan 2, Feb 1, Mar 1 | Apr 0, May 1 | Jun in progress.
    const apr = run("compare_before_after", { eventId: "ev-apr" });
    expect(apr.change).toEqual({ id: "ev-apr", name: "New signature box (Marion, Apr 1)", tookEffect: "Apr 1, 2026", county: "Marion", caseType: "Small claims" });
    expect(apr.problemMeasured).toBe("Missing signature");
    expect(apr.before).toEqual({ fullMonths: 3, filings: 4, averagePerMonth: 1.3 });
    expect(apr.after).toEqual({ fullMonths: 2, filings: 1, averagePerMonth: 0.5 });
    // 0.5 against 4/3 is a fall of 62.5 percent, which Math.round takes to -62.
    expect(apr.changeInMonthlyAveragePercent).toBe(-62);
    expect(apr.direction).toBe("down");
    expect(apr.months).toEqual([
      { month: "Jan 2026", filings: 2, countedAs: "before" },
      { month: "Feb 2026", filings: 1, countedAs: "before" },
      { month: "Mar 2026", filings: 1, countedAs: "before" },
      { month: "Apr 2026", filings: 0, countedAs: "after" },
      { month: "May 2026", filings: 1, countedAs: "after" },
      { month: "Jun 2026", filings: 0, countedAs: "in_progress" },
    ]);
    expect(typeof apr.inWords).toBe("string");
    // Five filings in all is too few to read much into, and the answer says so.
    expect(String(apr.caveat).toLowerCase()).toContain("small");
  });

  it("leaves out the month a mid-month change took effect in", () => {
    const mar = run("compare_before_after", { eventId: "ev-mar" });
    expect(mar.before).toEqual({ fullMonths: 2, filings: 3, averagePerMonth: 1.5 });
    expect(mar.after).toEqual({ fullMonths: 2, filings: 1, averagePerMonth: 0.5 });
    expect(mar.changeInMonthlyAveragePercent).toBe(-67);
    expect((mar.months as { month: string; countedAs: string }[]).find((point) => point.month === "Mar 2026")?.countedAs).toBe("change");
  });

  it("measures another problem when asked", () => {
    // Wrong form in Marion small claims: Jan 1 (filing 2), Mar 1 (filing 5), none after.
    const wrongForm = run("compare_before_after", { eventId: "ev-apr", tag: "Wrong form" });
    expect(wrongForm.problemMeasured).toBe("Wrong form");
    expect(wrongForm.before).toEqual({ fullMonths: 3, filings: 2, averagePerMonth: 0.7 });
    expect(wrongForm.after).toEqual({ fullMonths: 2, filings: 0, averagePerMonth: 0 });
    expect(wrongForm.changeInMonthlyAveragePercent).toBe(-100);
  });

  it("answers an unknown change id with a sentence that says what to do", () => {
    expect(callAggregateTool("compare_before_after", { eventId: "nope" }, CONTEXT)).toEqual({
      ok: false,
      error: "No recorded change has that id. Call list_reference_values to see the recorded changes and their ids.",
    });
  });
});

describe("list_reference_values", () => {
  it("lists the exact names the other tools accept, and the recorded changes", () => {
    const reference = run("list_reference_values");
    expect(reference.today).toBe(FIXTURE_TODAY);
    expect(reference.counties).toEqual([...COUNTIES]);
    expect(reference.countiesWithDataForThisAccount).toEqual(["Marion", "Lake", "Allen"]);
    expect((reference.caseTypes as { caseType: string; forms: string[] }[]).map((entry) => entry.caseType)).toEqual([...CASE_TYPES]);
    expect((reference.caseTypes as { caseType: string; forms: string[] }[]).every((entry) => entry.forms.length > 0)).toBe(true);
    expect(reference.problems).toEqual([...TAGS]);
    expect(reference.needsReviewMarker).toBe("Needs review");
    expect(reference.outcomes).toEqual([...OUTCOMES]);
    expect(reference.changes).toEqual([
      { id: "ev-apr", name: "New signature box (Marion, Apr 1)", tookEffect: "2026-04-01", county: "Marion", caseType: "Small claims", problem: "Missing signature", description: "Test change." },
      { id: "ev-mar", name: "Mid-month change", tookEffect: "2026-03-15", county: "Marion", caseType: "Small claims", problem: "Missing signature", description: "Test change." },
    ]);
  });

  it("accepts no input at all as well as an empty object", () => {
    expect(callAggregateTool("list_reference_values", undefined, CONTEXT).ok).toBe(true);
    expect(callAggregateTool("list_reference_values", null, CONTEXT).ok).toBe(true);
    expect(callAggregateTool("list_reference_values", { county: "Marion" }, CONTEXT).ok).toBe(false);
  });
});

describe("input checks", () => {
  it.each([
    ["a county that is not on the list", "get_problem_counts", { county: "Cook" }],
    ["a problem that is not on the list", "get_problem_counts", { tag: "Filed late" }],
    ["a month in the wrong form", "get_form_breakdown", { fromMonth: "June" }],
    ["a limit of zero", "get_problem_counts", { limit: 0 }],
    ["a field the tool does not have", "get_form_breakdown", { rows: true }],
    ["too many problems", "get_county_breakdown", { maxProblems: 99 }],
    ["no change id", "compare_before_after", {}],
    ["input that is not an object", "get_problem_counts", "county=Marion"],
  ])("refuses %s with a sentence that points to the reference values", (_name, tool, input) => {
    const outcome = callAggregateTool(tool, input, CONTEXT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/^The input is not valid\./);
      expect(outcome.error).toContain("Call list_reference_values for the accepted values.");
    }
  });
});

describe("what the tools give away", () => {
  it("marks every answer as made up in the demo, and as real otherwise", () => {
    for (const tool of AGGREGATE_TOOLS) {
      const input = tool.name === "compare_before_after" ? { eventId: "sc-form" } : {};
      const demo = run(tool.name, input, DEMO);
      expect(demo.sampleData).toBe(true);
      expect(demo.dataNote).toBe("Prototype. All data is made up. Do not present these numbers as real court figures.");
    }
    expect(run("get_problem_counts").sampleData).toBe(false);
    expect(run("get_problem_counts")).not.toHaveProperty("dataNote");
  });

  it("agrees with the sample data's known totals", () => {
    expect(run("get_problem_counts", {}, DEMO).flaggedFilings).toBe(900);
    const top = (run("get_problem_counts", { limit: 3 }, DEMO).problems as { problem: string; filings: number }[]).map((entry) => [entry.problem, entry.filings]);
    expect(top).toEqual([
      ["Missing required details", 284],
      ["Missing signature", 249],
      ["Wrong county or court", 159],
    ]);
    const form = run("compare_before_after", { eventId: "sc-form" }, DEMO);
    expect(form.before).toMatchObject({ averagePerMonth: 4 });
    expect(form.after).toMatchObject({ averagePerMonth: 1 });
    expect(form.changeInMonthlyAveragePercent).toBe(-75);
  });

  it("never returns a row, a note, a rejection reason or who entered a filing", () => {
    const secretNote = "Counter staff spoke with the filer on the phone";
    const secretReason = "Signature line left blank on page two";
    const flags = FIXTURE.map((flag) => ({ ...flag, note: secretNote, reason: secretReason, createdBy: "user-clerk-41" }));
    const context: ToolContext = { ...CONTEXT, flags };
    for (const tool of AGGREGATE_TOOLS) {
      const input = tool.name === "compare_before_after" ? { eventId: "ev-apr" } : {};
      const text = JSON.stringify(run(tool.name, input, context));
      expect(text).not.toContain(secretNote);
      expect(text).not.toContain(secretReason);
      expect(text).not.toContain("user-clerk-41");
      expect(text).not.toMatch(/"(?:id|note|reason|createdBy|createdAt|batchId)":"f\d+"/);
      expect(text).not.toMatch(/"f\d+"/);
      expect(text).not.toContain("T12:00:00.000Z");
    }
  });

  it("does not change the flags it is given", () => {
    const before = JSON.stringify(FIXTURE);
    for (const tool of AGGREGATE_TOOLS) run(tool.name, tool.name === "compare_before_after" ? { eventId: "ev-apr" } : {});
    expect(JSON.stringify(FIXTURE)).toBe(before);
  });
});
