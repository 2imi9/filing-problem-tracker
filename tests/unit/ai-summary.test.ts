import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSampleRecords, SAMPLE_EVENTS, SAMPLE_TODAY } from "@/lib/sample";
import { allowedNumbers, checkNumbers, digitNumbersIn } from "@/server/ai/numbers";
import { SUMMARY_SYSTEM_PROMPT, SummaryInput, buildSummaryAggregates, readsAsAdvice, summarize } from "@/server/ai/summary";
import { blockJson, fakeClient, systemText, userText } from "./ai-fake";
import { EVENT_APRIL_1, EVENT_MARCH_15, FIXTURE, FIXTURE_TODAY } from "./fixture";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("digitNumbersIn", () => {
  it("reads whole numbers, decimals and thousands separators in canonical form", () => {
    expect(digitNumbersIn("There were 900 filings, 1,234 last year and 12,345,678 overall.")).toEqual(["900", "1234", "12345678"]);
    expect(digitNumbersIn("An average of 4.0 a month, then 1.30, then 0.5.")).toEqual(["4", "1.3", "0.5"]);
  });

  it("leaves signs and percent signs out of the number", () => {
    expect(digitNumbersIn("down 75%, or -75%, or 28 percent")).toEqual(["75", "75", "28"]);
  });

  it("does not read a sentence comma or full stop as part of a number", () => {
    expect(digitNumbersIn("In 2026, 900 were flagged. Of those, 284.")).toEqual(["2026", "900", "284"]);
    expect(digitNumbersIn("counts of 5,2026 and 1,2345")).toEqual(["5", "2026", "1", "2345"]);
  });

  it("splits dates and ranges into their parts", () => {
    expect(digitNumbersIn("2026-06-01, Jun 1, 2026 and 3-5 sentences")).toEqual(["2026", "6", "1", "1", "2026", "3", "5"]);
  });

  it("finds nothing in text without digits", () => {
    expect(digitNumbersIn("Missing signature is the most common problem.")).toEqual([]);
  });
});

describe("allowedNumbers", () => {
  it("collects number values without their sign, and numbers inside strings, but not keys", () => {
    const allowed = allowedNumbers({
      total: 900,
      change: -75,
      average: 1.3,
      label: "Jun 1, 2026",
      month: "2026-06",
      nested: [{ share: 28 }, "top 5"],
      key404: "no number here",
      flag: true,
      none: null,
    });
    expect([...allowed].sort()).toEqual(["1", "1.3", "2026", "28", "5", "6", "75", "900"].sort());
  });

  it("ignores values that are not finite numbers", () => {
    expect([...allowedNumbers([Number.NaN, Number.POSITIVE_INFINITY, 3])]).toEqual(["3"]);
  });
});

describe("checkNumbers", () => {
  const payload = {
    scope: "Marion County, Small claims, Jun 2026 to Sep 2026",
    flaggedFilings: 1234,
    problems: [{ problem: "Missing signature", filings: 249, percentOfFlaggedFilings: 28 }],
    months: [{ month: "2026-06", filings: 31 }],
    change: { tookEffect: "Jun 1, 2026", before: { fullMonths: 5, averagePerMonth: 4 }, after: { fullMonths: 4, averagePerMonth: 1 }, changePercent: -75 },
  };

  it.each([
    ["a count with a thousands separator", "There were 1,234 flagged filings."],
    ["a count without one", "There were 1234 flagged filings."],
    ["a percentage with a percent sign", "Missing signature was on 28% of them."],
    ["a percentage in words", "Missing signature was on 28 percent of them, 249 filings."],
    ["a decimal written with a trailing zero", "The average was 4.0 a month before and 1.0 after."],
    ["a negative figure, with or without its sign", "That is a change of -75%, or 75% fewer."],
    ["a year and a day from a label", "The change took effect on June 1, 2026."],
    ["a month given as YYYY-MM in the data", "June 2026 had 31 flagged filings."],
    ["a number word that matches the data", "The average covers five full months before and four after."],
    ["text with no numbers", "Missing signature is the most common problem."],
  ])("accepts %s", (_name, text) => {
    expect(checkNumbers(text, payload)).toEqual({ ok: true, unsupported: [] });
  });

  it.each([
    ["a count that is not in the data", "There were 1,250 flagged filings.", ["1250"]],
    ["a number the model worked out", "The average fell by 3 a month.", ["3"]],
    ["a percentage that is not in the data", "Missing signature was on 29% of them.", ["29"]],
    ["a decimal that is not in the data", "The average was 4.2 a month.", ["4.2"]],
    ["a year that is not in the data", "Compared with 2025, filings rose.", ["2025"]],
    ["a number word that is not in the data", "Three counties account for most of them.", ["three"]],
    ["a ratio word", "Filings with this problem fell by half.", ["half"]],
    ["a multiple", "Marion has twice as many as Lake.", ["twice"]],
    ["parts of a number that only exist joined up", "There were 12 in one county and 34 in another.", ["12", "34"]],
    ["several, listing each once", "It rose from 7 to 9, then 7 again.", ["7", "9"]],
  ])("rejects %s", (_name, text, unsupported) => {
    expect(checkNumbers(text, payload)).toEqual({ ok: false, unsupported });
  });

  describe("a number spelled with more than one word", () => {
    // 2, 5, 8, 20 and 100 are all in the data; 28 as a word, 200, 205, 500 and 25 are not what it says.
    const parts = { before: 2, after: 5, share: 8, other: 20, percent: 100 };

    it.each([
      ["a scale word after a count", "About two hundred filings were rejected.", ["two hundred"]],
      ["tens and units with a hyphen", "Twenty-eight percent of filings were rejected.", ["twenty-eight"]],
      ["tens and units with a space", "Twenty eight percent of filings were rejected.", ["twenty eight"]],
      ["a scale word, then 'and'", "There were two hundred and five filings.", ["two hundred and five"]],
      ["a figure with a scale word", "There were 2 hundred filings.", ["2 hundred"]],
      ["a run across a line of words only", "Some five hundred filings.", ["five hundred"]],
    ])("is refused: %s", (_name, text, unsupported) => {
      expect(checkNumbers(text, parts)).toEqual({ ok: false, unsupported });
    });

    it("still accepts single number words that are in the data, also side by side in a list", () => {
      expect(checkNumbers("Rejections went from two a month to five.", parts)).toEqual({ ok: true, unsupported: [] });
      expect(checkNumbers("The counts were two, five and eight.", parts)).toEqual({ ok: true, unsupported: [] });
      expect(checkNumbers("Between two and five filings a month.", parts)).toEqual({ ok: true, unsupported: [] });
      expect(checkNumbers("A change of 100 percent, from 2 to 5.", parts)).toEqual({ ok: true, unsupported: [] });
    });

    it("reports a single word that is not in the data as before", () => {
      expect(checkNumbers("There were nine filings and two hundred more.", parts)).toEqual({ ok: false, unsupported: ["nine", "two hundred"] });
    });
  });

  it("does not take a word that is also an object method for a number", () => {
    expect(checkNumbers("The constructor of the form has a valueOf field.", payload).ok).toBe(true);
  });

  it("treats 'one' as a word, not a count", () => {
    expect(checkNumbers("No one county stands out.", {}).ok).toBe(true);
  });
});

describe("readsAsAdvice", () => {
  it("spots text that tells someone what to do", () => {
    for (const text of [
      "Filers should sign every page.",
      "The court must revise the form.",
      "We recommend a new checklist.",
      "Consider adding a signature box.",
      "Clerks need to check the fee.",
    ]) {
      expect(readsAsAdvice(text)).toBe(true);
    }
  });

  it("lets a plain description through", () => {
    expect(readsAsAdvice("The sample data shows 900 flagged filings. Missing signature is the most common problem, on 28% of them.")).toBe(false);
  });
});

describe("SummaryInput", () => {
  it("accepts filters with an optional change and problem", () => {
    expect(SummaryInput.parse({ filters: {} })).toEqual({ filters: {} });
    expect(SummaryInput.parse({ filters: { county: "Marion", fromMonth: "2026-06" }, eventId: "sc-form", tag: "Wrong form" })).toEqual({
      filters: { county: "Marion", fromMonth: "2026-06" },
      eventId: "sc-form",
      tag: "Wrong form",
    });
  });

  it("refuses numbers and anything else it does not know", () => {
    expect(SummaryInput.safeParse({ filters: {}, total: 5000 }).success).toBe(false);
    expect(SummaryInput.safeParse({ filters: { county: "Marion", flaggedFilings: 5000 } }).success).toBe(false);
    expect(SummaryInput.safeParse({ filters: { county: "Cook" } }).success).toBe(false);
    expect(SummaryInput.safeParse({ filters: {}, tag: "Needs review" }).success).toBe(false);
    expect(SummaryInput.safeParse({}).success).toBe(false);
  });
});

describe("buildSummaryAggregates", () => {
  it("works out every count from the records (hand-checked against the fixture)", () => {
    const aggregates = buildSummaryAggregates({ filters: {} }, FIXTURE, [EVENT_APRIL_1], FIXTURE_TODAY, "demo", null);
    expect(aggregates).toEqual({
      sampleData: true,
      scope: "All counties, all case types, all months",
      today: "Jun 25, 2026",
      flaggedFilings: 10,
      problems: [
        { problem: "Missing signature", filings: 5, percentOfFlaggedFilings: 50 },
        { problem: "Wrong form", filings: 3, percentOfFlaggedFilings: 30 },
        { problem: "Missing fee or fee waiver", filings: 2, percentOfFlaggedFilings: 20 },
        { problem: "Missing required details", filings: 1, percentOfFlaggedFilings: 10 },
        { problem: "Wrong county or court", filings: 1, percentOfFlaggedFilings: 10 },
      ],
      outcomes: [
        { outcome: "Rejected", filings: 6, percentOfFlaggedFilings: 60 },
        { outcome: "Returned to fix", filings: 2, percentOfFlaggedFilings: 20 },
        { outcome: "Fixed at counter", filings: 2, percentOfFlaggedFilings: 20 },
      ],
      filingsWithMoreThanOneProblem: { filings: 2, percentOfFlaggedFilings: 20 },
      forms: [
        { form: "Small claims notice of claim", filings: 6, mostCommonProblem: "Missing signature", percentOfThisFormsFilings: 67 },
        { form: "Petition for dissolution, no children", filings: 1, mostCommonProblem: "Wrong form", percentOfThisFormsFilings: 100 },
        { form: "Petition for order of protection", filings: 1, mostCommonProblem: "Missing required details", percentOfThisFormsFilings: 100 },
      ],
      months: [
        { month: "Jan 2026", filings: 2 },
        { month: "Feb 2026", filings: 2 },
        { month: "Mar 2026", filings: 2 },
        { month: "Apr 2026", filings: 1 },
        { month: "May 2026", filings: 1 },
        { month: "Jun 2026", filings: 2, monthStillInProgress: true },
      ],
      importedRowsWaitingForReview: 1,
      counties: [
        { county: "Marion", filings: 7, percentOfFlaggedFilings: 70 },
        { county: "Lake", filings: 2, percentOfFlaggedFilings: 20 },
        { county: "Allen", filings: 1, percentOfFlaggedFilings: 10 },
      ],
    });
  });

  it("names the one county a clerk sees, and never calls their numbers all counties", () => {
    const marion = FIXTURE.filter((flag) => flag.county === "Marion");
    const aggregates = buildSummaryAggregates({ filters: {} }, marion, [EVENT_APRIL_1], FIXTURE_TODAY, "supabase", "Marion");
    expect(aggregates.scope).toBe("Marion County, all case types, all months");
    expect(aggregates.flaggedFilings).toBe(7);
    // One county's numbers have no split by county.
    expect(aggregates.counties).toBeUndefined();
    expect(JSON.stringify(aggregates)).not.toContain("All counties");
    // A filter still narrows it, and a county filter is named as chosen.
    expect(buildSummaryAggregates({ filters: { caseType: "Small claims" } }, marion, [], FIXTURE_TODAY, "supabase", "Marion").scope).toBe("Marion County, Small claims, all months");
    expect(buildSummaryAggregates({ filters: { county: "Lake" } }, marion, [], FIXTURE_TODAY, "supabase", "Marion")).toMatchObject({ scope: "Lake County, all case types, all months", flaggedFilings: 0 });
  });

  it("applies the filters, and leaves the county list out when one county is chosen", () => {
    const aggregates = buildSummaryAggregates({ filters: { county: "Lake", fromMonth: "2026-03", toMonth: "2026-04" } }, FIXTURE, [], FIXTURE_TODAY, "supabase", null);
    expect(aggregates.sampleData).toBe(false);
    expect(aggregates.scope).toBe("Lake County, all case types, Mar 2026 to Apr 2026");
    expect(aggregates.flaggedFilings).toBe(1);
    expect(aggregates.problems).toEqual([{ problem: "Missing required details", filings: 1, percentOfFlaggedFilings: 100 }]);
    expect(aggregates.months).toEqual([
      { month: "Mar 2026", filings: 1 },
      { month: "Apr 2026", filings: 0 },
    ]);
    expect(aggregates.counties).toBeUndefined();
    expect(aggregates.change).toBeUndefined();
  });

  it("adds the before and after comparison for the chosen change (hand-checked)", () => {
    const aggregates = buildSummaryAggregates({ filters: {}, eventId: "ev-apr" }, FIXTURE, [EVENT_APRIL_1, EVENT_MARCH_15], FIXTURE_TODAY, "demo", null);
    expect(aggregates.change).toEqual({
      name: "New signature box (Marion, Apr 1)",
      tookEffect: "Apr 1, 2026",
      county: "Marion",
      caseType: "Small claims",
      problemMeasured: "Missing signature",
      before: { fullMonths: 3, filings: 4, averagePerMonth: 1.3 },
      after: { fullMonths: 2, filings: 1, averagePerMonth: 0.5 },
      changeInMonthlyAveragePercent: -62,
    });
  });

  it("measures another problem when one is picked, and says why there is no percentage when there is none", () => {
    const wrongForm = buildSummaryAggregates({ filters: {}, eventId: "ev-apr", tag: "Wrong form" }, FIXTURE, [EVENT_APRIL_1], FIXTURE_TODAY, "demo", null);
    expect(wrongForm.change).toMatchObject({
      problemMeasured: "Wrong form",
      before: { fullMonths: 3, filings: 2, averagePerMonth: 0.7 },
      after: { fullMonths: 2, filings: 0, averagePerMonth: 0 },
      changeInMonthlyAveragePercent: -100,
    });
    const citation = buildSummaryAggregates({ filters: {}, eventId: "ev-apr", tag: "Citation not found or wrong" }, FIXTURE, [EVENT_APRIL_1], FIXTURE_TODAY, "demo", null);
    expect(citation.change).toMatchObject({
      changeInMonthlyAveragePercent: null,
      whyNoPercentage: "There were no filings with this problem before the change.",
    });
  });

  it("ignores a change id that is not on the list", () => {
    expect(buildSummaryAggregates({ filters: {}, eventId: "gone" }, FIXTURE, [EVENT_APRIL_1], FIXTURE_TODAY, "demo", null).change).toBeUndefined();
  });

  it("holds counts and reference labels only: no ids, no notes, no reasons, no user ids", () => {
    const records = FIXTURE.map((record, index) => ({ ...record, id: `ROWID${index}`, note: "NOTE-TEXT", reason: "REASON-TEXT", createdBy: "USER-ID" }));
    const json = JSON.stringify(buildSummaryAggregates({ filters: {}, eventId: "ev-apr" }, records, [EVENT_APRIL_1], FIXTURE_TODAY, "demo", null));
    for (const secret of ["ROWID", "NOTE-TEXT", "REASON-TEXT", "USER-ID", "createdAt", "Test change."]) expect(json).not.toContain(secret);
  });

  it("matches the sample data's headline figures", () => {
    const aggregates = buildSummaryAggregates({ filters: {}, eventId: "sc-form" }, makeSampleRecords(), SAMPLE_EVENTS, SAMPLE_TODAY, "demo", null);
    expect(aggregates.flaggedFilings).toBe(900);
    expect(aggregates.problems.slice(0, 3).map((p) => [p.problem, p.filings])).toEqual([
      ["Missing required details", 284],
      ["Missing signature", 249],
      ["Wrong county or court", 159],
    ]);
    expect(aggregates.change).toMatchObject({ before: { averagePerMonth: 4 }, after: { averagePerMonth: 1 }, changeInMonthlyAveragePercent: -75 });
  });
});

describe("summarize", () => {
  const aggregates = buildSummaryAggregates({ filters: {}, eventId: "ev-apr" }, FIXTURE, [EVENT_APRIL_1], FIXTURE_TODAY, "demo", null);
  const GOOD =
    "The sample data shows 10 flagged filings across all counties. Missing signature is the most common problem, on 5 filings (50%). Marion County has 7 of them (70%). " +
    "For the new signature box, the average was 1.3 a month over 3 full months before the change and 0.5 a month over 2 full months after, a change of -62%. " +
    "This shows what happened after the change, not why.";

  it("returns the summary when every number in it is in the data", async () => {
    const client = fakeClient(() => ({ text: `  ${GOOD}\n` }));
    expect(await summarize(aggregates, client)).toEqual({ available: true, summary: GOOD, source: "ai" });
  });

  it("sends the stable system prompt, and only the aggregates in the user turn, at medium effort with a 30 second timeout", async () => {
    const client = fakeClient(() => ({ text: GOOD }));
    await summarize(aggregates, client);
    const { params, options } = client.calls[0];
    expect(systemText(params)).toBe(SUMMARY_SYSTEM_PROMPT);
    expect(blockJson(userText(params), "data")).toEqual(JSON.parse(JSON.stringify(aggregates)));
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params).not.toHaveProperty("tools");
    expect(options?.timeout).toBe(30_000);
  });

  it("the system prompt carries the required limits and nothing that changes between requests", () => {
    for (const phrase of ["Describe only what the data block says", "No legal advice", "No advice to filers", "The sample data shows", "Use only numbers that appear in the data block"]) {
      expect(SUMMARY_SYSTEM_PROMPT).toContain(phrase);
    }
    expect(digitNumbersIn(SUMMARY_SYSTEM_PROMPT)).toEqual(["0"]);
  });

  it.each([
    ["a number that is not in the data", GOOD.replace("10 flagged", "11 flagged"), "used a number that is not in the data"],
    ["a figure the model worked out", `${GOOD} That is 0.8 fewer a month.`, "used a number that is not in the data"],
    ["advice", `${GOOD} The court should add a checklist.`, "went beyond describing the numbers"],
    ["no mention that the data is sample data", GOOD.replace("The sample data shows", "There are"), "did not say that the numbers are sample data"],
    ["an empty reply", "   ", "did not return a usable summary"],
    ["a reply that runs on far too long", `The sample data shows 10 flagged filings. ${"More words. ".repeat(200)}`, "did not return a usable summary"],
  ])("discards a summary with %s", async (_name, text, reason) => {
    const client = fakeClient(() => ({ text }));
    const result = await summarize(aggregates, client);
    expect(result.available).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining(reason) });
    expect(result).not.toHaveProperty("summary");
  });

  it("does not ask for the sample data wording outside demo mode", async () => {
    const real = { ...aggregates, sampleData: false };
    const text = GOOD.replace("The sample data shows", "There are");
    expect(await summarize(real, fakeClient(() => ({ text })))).toEqual({ available: true, summary: text, source: "ai" });
  });

  it("is unavailable after a refusal, a cut-off reply or a failed request", async () => {
    const refusal = await summarize(aggregates, fakeClient(() => ({ text: GOOD, stopReason: "refusal" })));
    expect(refusal).toEqual({ available: false, reason: "The AI service did not write a summary for this request." });
    const cutOff = await summarize(aggregates, fakeClient(() => ({ text: GOOD, stopReason: "max_tokens" })));
    expect(cutOff).toEqual({ available: false, reason: "The AI service did not finish the summary." });
    const failed = await summarize(
      aggregates,
      fakeClient(() => {
        throw new Anthropic.APIConnectionTimeoutError();
      }),
    );
    expect(failed).toEqual({ available: false, reason: "The AI service took too long to answer." });
  });

  it("is unavailable, with no request, when there is no client or nothing to summarize", async () => {
    expect(await summarize(aggregates, null)).toEqual({ available: false, reason: "AI features are switched off on this server." });
    expect(await summarize(aggregates)).toEqual({ available: false, reason: "AI features are switched off on this server." });
    const client = fakeClient(() => ({ text: GOOD }));
    const empty = buildSummaryAggregates({ filters: { county: "Monroe" } }, FIXTURE, [], FIXTURE_TODAY, "demo", null);
    expect(await summarize(empty, client)).toMatchObject({ available: false });
    expect(client.calls).toHaveLength(0);
  });
});
