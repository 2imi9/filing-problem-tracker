import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ChangeEventInput,
  Filters,
  FolderInput,
  ImportCommitInput,
  ImportPreviewInput,
  ImportRow,
  IsoDate,
  NewFlagInput,
  PANEL_PARAMS,
  PANEL_TYPES,
  PanelSpec,
  parseChangeEventInput,
  parseImportRow,
  parseNewFlagInput,
} from "@/lib/schemas";

const TODAY = "2026-10-30";

const newFlag = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-10-29",
  county: "Marion",
  caseType: "Small claims",
  form: "Small claims notice of claim",
  tags: ["Missing signature"],
  outcome: "Rejected",
  ...overrides,
});

const importRow = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-09-02",
  county: "Hamilton",
  caseType: "Small claims",
  form: "Small claims notice of claim",
  reason: "no signature on page 2",
  tags: ["Missing signature"],
  ...overrides,
});

const event = (overrides: Record<string, unknown> = {}) => ({
  name: "Revised form",
  date: "2026-06-01",
  county: "Marion",
  caseType: "Small claims",
  tag: "Missing signature",
  description: "A clearer signature box.",
  ...overrides,
});

function messages(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw error;
  }
  return [];
}

describe("IsoDate", () => {
  it("accepts real dates from 2020 on", () => {
    expect(IsoDate.safeParse("2020-01-01").success).toBe(true);
    expect(IsoDate.safeParse("2024-02-29").success).toBe(true);
  });

  it.each(["2019-12-31", "2026-02-30", "2026-13-01", "26-01-01", "2026/01/01", "", "today"])("refuses %j", (value) => {
    expect(IsoDate.safeParse(value).success).toBe(false);
  });

  it("refuses values that are not text", () => {
    expect(IsoDate.safeParse(20260101).success).toBe(false);
    expect(IsoDate.safeParse(null).success).toBe(false);
  });
});

describe("NewFlagInput", () => {
  it("accepts a minimal flag and leaves note undefined", () => {
    const parsed = parseNewFlagInput(newFlag(), TODAY);
    expect(parsed).toEqual({ ...newFlag(), note: undefined });
  });

  it("trims the note, collapses whitespace and treats a blank note as none", () => {
    expect(parseNewFlagInput(newFlag({ note: "  page 2\n\n unsigned  " }), TODAY).note).toBe("page 2 unsigned");
    expect(parseNewFlagInput(newFlag({ note: "   " }), TODAY).note).toBeUndefined();
  });

  it("allows a note of exactly 200 characters and refuses 201", () => {
    expect(parseNewFlagInput(newFlag({ note: "x".repeat(200) }), TODAY).note).toHaveLength(200);
    expect(messages(() => parseNewFlagInput(newFlag({ note: "x".repeat(201) }), TODAY))).toEqual(["note: The note can be at most 200 characters."]);
  });

  it.each([
    [{ county: "Cook" }, "county: County is not on the list."],
    [{ county: "marion" }, "county: County is not on the list."],
    [{ caseType: "Traffic" }, "caseType: Case type is not on the list."],
    [{ form: "Made-up form" }, "form: Form is not on the list."],
    [{ outcome: "Lost" }, "outcome: Outcome is not on the list."],
    [{ tags: ["Typo in name"] }, "tags.0: Problem is not on the list."],
    [{ tags: ["Needs review"] }, "tags.0: Problem is not on the list."],
    [{ tags: [] }, "tags: Choose at least one problem."],
    [{ tags: ["Wrong form", "Wrong form"] }, "tags: Each problem can be chosen once."],
    [{ form: "Petition for change of name" }, "form: This form is not used for Small claims."],
    [{ date: "2019-12-31" }, "date: The date cannot be before 2020-01-01."],
    [{ date: "2026-02-30" }, "date: Use a real date in the form YYYY-MM-DD."],
  ] as [Record<string, unknown>, string][])("refuses %j", (overrides, message) => {
    expect(messages(() => parseNewFlagInput(newFlag(overrides), TODAY))).toEqual([message]);
  });

  it("refuses a date after today and accepts today", () => {
    expect(messages(() => parseNewFlagInput(newFlag({ date: "2026-10-31" }), TODAY))).toEqual(["date: The date cannot be in the future."]);
    expect(parseNewFlagInput(newFlag({ date: TODAY }), TODAY).date).toBe(TODAY);
  });

  it("refuses unknown fields, so a client cannot set id, source or createdBy", () => {
    expect(NewFlagInput.safeParse(newFlag({ id: "x" })).success).toBe(false);
    expect(NewFlagInput.safeParse(newFlag({ source: "sample" })).success).toBe(false);
    expect(NewFlagInput.safeParse(newFlag({ createdBy: "demo-admin" })).success).toBe(false);
  });

  it("refuses missing fields and wrong types", () => {
    expect(NewFlagInput.safeParse({}).success).toBe(false);
    expect(NewFlagInput.safeParse(null).success).toBe(false);
    expect(NewFlagInput.safeParse(newFlag({ tags: "Missing signature" })).success).toBe(false);
    expect(NewFlagInput.safeParse(newFlag({ note: 5 })).success).toBe(false);
  });

  it("accepts all nine problems at once", () => {
    const all = ["Missing signature", "Wrong form", "Wrong county or court", "Missing required details", "Missing fee or fee waiver", "Citation not found or wrong", "Missing addresses for service", "Not verified or notarized", "Pages missing or unreadable"];
    expect(parseNewFlagInput(newFlag({ tags: all }), TODAY).tags).toHaveLength(9);
  });
});

describe("ImportRow", () => {
  it("accepts a sorted row and a Needs review row", () => {
    expect(parseImportRow(importRow(), TODAY).tags).toEqual(["Missing signature"]);
    expect(parseImportRow(importRow({ tags: ["Needs review"], reason: "" }), TODAY)).toMatchObject({ tags: ["Needs review"], reason: "" });
  });

  it.each([
    [{ tags: [] }, "tags: Each row needs at least one problem, or Needs review."],
    [{ tags: ["Needs review", "Wrong form"] }, "tags: Needs review cannot be combined with other problems."],
    [{ tags: ["Wrong form", "Wrong form"] }, "tags: Each problem can be chosen once."],
    [{ tags: ["Something else"] }, "tags.0: Problem is not on the list."],
    [{ county: "Cook" }, "county: County is not on the list."],
    [{ form: "Petition for change of name" }, "form: This form is not used for Small claims."],
    [{ reason: "x".repeat(501) }, "reason: The reason can be at most 500 characters."],
    [{ date: "2027-01-01" }, "date: The date cannot be in the future."],
  ] as [Record<string, unknown>, string][])("refuses %j", (overrides, message) => {
    expect(messages(() => parseImportRow(importRow(overrides), TODAY))).toEqual([message]);
  });

  it("refuses unknown fields such as outcome, source or line", () => {
    expect(ImportRow.safeParse(importRow({ outcome: "Fixed at counter" })).success).toBe(false);
    expect(ImportRow.safeParse(importRow({ line: 3 })).success).toBe(false);
  });

  it("requires a reason field, even if empty", () => {
    const withoutReason = { date: "2026-09-02", county: "Hamilton", caseType: "Small claims", form: "Small claims notice of claim", tags: ["Missing signature"] };
    expect(ImportRow.safeParse(withoutReason).success).toBe(false);
  });
});

describe("ChangeEventInput", () => {
  it("accepts a new change and a replacement with an id", () => {
    expect(parseChangeEventInput(event(), TODAY).id).toBeUndefined();
    expect(parseChangeEventInput(event({ id: "sc-form" }), TODAY).id).toBe("sc-form");
  });

  it.each([
    [{ name: "   " }, "name: Give the change a name."],
    [{ name: "x".repeat(81) }, "name: The name can be at most 80 characters."],
    [{ description: "x".repeat(301) }, "description: The description can be at most 300 characters."],
    [{ tag: "Needs review" }, "tag: Problem is not on the list."],
    [{ county: "Cook" }, "county: County is not on the list."],
    [{ caseType: "Probate" }, "caseType: Case type is not on the list."],
    [{ date: "2026-11-15" }, "date: The date cannot be in the future."],
  ] as [Record<string, unknown>, string][])("refuses %j", (overrides, message) => {
    expect(messages(() => parseChangeEventInput(event(overrides), TODAY))).toEqual([message]);
  });

  it("refuses unknown fields", () => {
    expect(ChangeEventInput.safeParse(event({ factor: 0.3 })).success).toBe(false);
  });
});

describe("Filters", () => {
  it("accepts no filters and every filter", () => {
    expect(Filters.parse({})).toEqual({});
    const all = { county: "Lake", caseType: "Family", form: "Petition to modify child support", tag: "Needs review", fromMonth: "2026-01", toMonth: "2026-10" };
    expect(Filters.parse(all)).toEqual(all);
  });

  it.each([
    { county: "" },
    { county: "All counties" },
    { caseType: "Small Claims" },
    { form: "x" },
    { tag: "Signature" },
    { fromMonth: "2026-1" },
    { toMonth: "2026-13" },
    { fromMonth: "2026-01-01" },
    { year: 2026 },
  ])("refuses %j", (filters) => {
    expect(Filters.safeParse(filters).success).toBe(false);
  });
});

describe("PanelSpec", () => {
  const base = { id: "p1", title: "A panel", size: "w" };

  it("accepts one valid spec of every type", () => {
    const specs = [
      { ...base, type: "kpi", params: {} },
      { ...base, type: "ranked", params: { dimension: "tag", limit: 5, county: "Marion" } },
      { ...base, type: "heat", params: { maxTags: 4 } },
      { ...base, type: "forms", params: { caseType: "Family" } },
      { ...base, type: "trend", params: { tag: "Wrong form" } },
      { ...base, type: "before_after", params: { eventId: "sc-form", tag: "Missing signature" } },
      { ...base, type: "compare_counties", params: { counties: ["Marion", "Lake"], tag: "Wrong form" } },
      { ...base, type: "needs_review", params: { county: "Lake" } },
    ];
    expect(specs.map((spec) => spec.type)).toEqual([...PANEL_TYPES]);
    for (const spec of specs) expect(PanelSpec.parse(spec)).toEqual(spec);
  });

  it.each([
    ["an unknown type", { ...base, type: "pie", params: {} }],
    ["an unknown size", { ...base, size: "xl", type: "kpi", params: {} }],
    ["an empty title", { ...base, title: "  ", type: "kpi", params: {} }],
    ["a title over 80 characters", { ...base, title: "x".repeat(81), type: "kpi", params: {} }],
    ["a missing id", { title: "t", size: "s", type: "kpi", params: {} }],
    ["an extra top-level field", { ...base, type: "kpi", params: {}, numbers: [1, 2] }],
    ["an extra param", { ...base, type: "kpi", params: { total: 900 } }],
    ["ranked without a dimension", { ...base, type: "ranked", params: {} }],
    ["ranked with an unknown dimension", { ...base, type: "ranked", params: { dimension: "judge" } }],
    ["ranked with a limit of 0", { ...base, type: "ranked", params: { dimension: "tag", limit: 0 } }],
    ["ranked with a limit over 20", { ...base, type: "ranked", params: { dimension: "tag", limit: 21 } }],
    ["heat with a fractional column count", { ...base, type: "heat", params: { maxTags: 2.5 } }],
    ["before_after without an event", { ...base, type: "before_after", params: {} }],
    ["before_after with filters it does not take", { ...base, type: "before_after", params: { eventId: "e", county: "Lake" } }],
    ["before_after measuring Needs review", { ...base, type: "before_after", params: { eventId: "e", tag: "Needs review" } }],
    ["compare_counties with one county", { ...base, type: "compare_counties", params: { counties: ["Marion"] } }],
    ["compare_counties with a repeated county", { ...base, type: "compare_counties", params: { counties: ["Marion", "Marion"] } }],
    ["compare_counties with a county filter", { ...base, type: "compare_counties", params: { counties: ["Marion", "Lake"], county: "Allen" } }],
    ["compare_counties with an unknown county", { ...base, type: "compare_counties", params: { counties: ["Marion", "Cook"] } }],
    ["needs_review with a tag filter", { ...base, type: "needs_review", params: { tag: "Wrong form" } }],
    ["a filter value off the list", { ...base, type: "trend", params: { county: "Cook" } }],
  ])("refuses %s", (_label, spec) => {
    expect(PanelSpec.safeParse(spec).success).toBe(false);
  });

  it("has a params schema for every panel type", () => {
    expect(Object.keys(PANEL_PARAMS).sort()).toEqual([...PANEL_TYPES].sort());
  });
});

describe("FolderInput", () => {
  const panel = { id: "p1", title: "Key numbers", size: "w", type: "kpi", params: {} };

  it("accepts a new folder, an empty folder and a replacement", () => {
    expect(FolderInput.parse({ name: "  My  folder ", panels: [panel] })).toEqual({ name: "My folder", panels: [panel] });
    expect(FolderInput.parse({ name: "Empty", panels: [] }).panels).toEqual([]);
    expect(FolderInput.parse({ id: "f1", name: "Mine", panels: [] }).id).toBe("f1");
  });

  it("refuses a blank or long name, an invalid panel, and more than 24 panels", () => {
    expect(FolderInput.safeParse({ name: " ", panels: [] }).success).toBe(false);
    expect(FolderInput.safeParse({ name: "x".repeat(61), panels: [] }).success).toBe(false);
    expect(FolderInput.safeParse({ name: "ok", panels: [{ ...panel, type: "pie" }] }).success).toBe(false);
    expect(FolderInput.safeParse({ name: "ok", panels: Array.from({ length: 25 }, () => panel) }).success).toBe(false);
    expect(FolderInput.safeParse({ name: "ok", panels: Array.from({ length: 24 }, () => panel) }).success).toBe(true);
    expect(FolderInput.safeParse({ name: "ok", panels: [], owner: "demo-admin" }).success).toBe(false);
  });
});

describe("import request bodies", () => {
  it("ImportPreviewInput takes csv text and an optional useAi", () => {
    expect(ImportPreviewInput.parse({ csv: "a,b" })).toEqual({ csv: "a,b" });
    expect(ImportPreviewInput.parse({ csv: "", useAi: true })).toEqual({ csv: "", useAi: true });
    expect(ImportPreviewInput.safeParse({}).success).toBe(false);
    expect(ImportPreviewInput.safeParse({ csv: "a", useAi: "yes" }).success).toBe(false);
  });

  it("ImportCommitInput needs at least one row", () => {
    expect(ImportCommitInput.safeParse({ rows: [] }).success).toBe(false);
    expect(ImportCommitInput.parse({ rows: [{}], batchName: " September  export " })).toEqual({ rows: [{}], batchName: "September export" });
    expect(ImportCommitInput.safeParse({ rows: [{}], batchName: "x".repeat(81) }).success).toBe(false);
  });
});
