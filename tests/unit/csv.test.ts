import { describe, expect, it } from "vitest";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, checkCsvRows, classify, classifyOrReview, parseCSV, rowsFromCsv } from "@/lib/csv";
import type { CsvRow } from "@/lib/csv";

const HEADER = "date,county,case_type,form,reason";
const row = (overrides: Partial<CsvRow> = {}): CsvRow => ({
  line: 1,
  date: "2026-09-02",
  county: "Hamilton",
  caseType: "Small claims",
  form: "Small claims notice of claim",
  reason: "no signature on page 2",
  ...overrides,
});

describe("parseCSV", () => {
  it("splits plain rows", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    expect(parseCSV('a,"b, with comma",c')).toEqual([["a", "b, with comma", "c"]]);
    expect(parseCSV('"she said ""no"" twice",x')).toEqual([['she said "no" twice', "x"]]);
    expect(parseCSV('"line one\nline two",x\nnext,y')).toEqual([
      ["line one\nline two", "x"],
      ["next", "y"],
    ]);
  });

  it("handles CRLF, lone CR and LF line ends the same way", () => {
    const expected = [
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ];
    expect(parseCSV("a,b\r\n1,2\r\n3,4\r\n")).toEqual(expected);
    expect(parseCSV("a,b\r1,2\r3,4")).toEqual(expected);
    expect(parseCSV("a,b\n1,2\n3,4\n")).toEqual(expected);
  });

  it("drops blank lines and a byte order mark, and keeps empty fields", () => {
    expect(parseCSV("﻿a,b\n\n , \n1,\n")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
    expect(parseCSV("")).toEqual([]);
  });

  it("keeps a quotation mark in the middle of an unquoted field as text, and the rows after it as rows", () => {
    expect(parseCSV('a,margin under 1" on page 2\nb,no signature\nc,fee not paid')).toEqual([
      ["a", 'margin under 1" on page 2'],
      ["b", "no signature"],
      ["c", "fee not paid"],
    ]);
    expect(parseCSV('a,the 8.5" x 11" sheet,z')).toEqual([["a", 'the 8.5" x 11" sheet', "z"]]);
    expect(parseCSV('a,"quoted" then "more",z')).toEqual([["a", 'quoted then "more"', "z"]]);
  });

  it("still opens a quoted field after spaces at the start of a field", () => {
    expect(parseCSV('a, "b,c",d')).toEqual([["a", " b,c", "d"]]);
    expect(parseCSV(' "x,y" ,z')).toEqual([[" x,y ", "z"]]);
  });

  it("reads to the end when a quote is never closed", () => {
    expect(parseCSV('a,"unclosed, text\nmore')).toEqual([["a", "unclosed, text\nmore"]]);
  });
});

describe("classify (keyword rules from the prototype)", () => {
  it.each([
    ["no signature on page 2", ["Missing signature", "Pages missing or unreadable"]],
    ["Filed in wrong county - defendant lives in Marion", ["Wrong county or court"]],
    ["not notarized; fee waiver form missing", ["Missing fee or fee waiver", "Not verified or notarized"]],
    ["cites a case that does not exist (possible AI)", ["Citation not found or wrong"]],
    ["needs dates and description of incidents", ["Missing required details"]],
    ["used old version of form", ["Wrong form"]],
    ["no address for defendant; unsigned", ["Missing signature", "Missing addresses for service"]],
    ["filing fee not paid", ["Missing fee or fee waiver"]],
    ["page 3 missing / scan unreadable", ["Pages missing or unreadable"]],
  ])("%s", (reason, tags) => {
    expect(classify(reason)).toEqual(tags);
  });

  it("returns nothing when no rule matches, and classifyOrReview marks that Needs review", () => {
    expect(classify("called filer - will bring in tomorrow")).toEqual([]);
    expect(classify("")).toEqual([]);
    expect(classifyOrReview("called filer - will bring in tomorrow")).toEqual(["Needs review"]);
    expect(classifyOrReview("UNSIGNED")).toEqual(["Missing signature"]);
  });
});

describe("rowsFromCsv", () => {
  it("reads rows by header name, in any column order and letter case", () => {
    const result = rowsFromCsv('Reason,Form,Case Type,COUNTY,Date\n"unsigned, twice",Small claims counterclaim,Small claims,Monroe,2026-09-12');
    expect(result).toEqual({
      ok: true,
      rows: [{ line: 1, date: "2026-09-12", county: "Monroe", caseType: "Small claims", form: "Small claims counterclaim", reason: "unsigned, twice" }],
    });
  });

  it("numbers data rows from 1, trims fields and collapses line breaks inside a reason", () => {
    const result = rowsFromCsv(`${HEADER}\r\n 2026-09-02 , Hamilton ,Small claims,Small claims notice of claim,"no signature\non page 2"\r\n2026-09-03,Hamilton,Small claims,Small claims notice of claim,\r\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.line)).toEqual([1, 2]);
    expect(result.rows[0]).toMatchObject({ date: "2026-09-02", county: "Hamilton", reason: "no signature on page 2" });
    expect(result.rows[1].reason).toBe("");
  });

  it("fills missing trailing fields with empty text", () => {
    const result = rowsFromCsv(`${HEADER}\n2026-09-02,Hamilton`);
    expect(result).toEqual({ ok: true, rows: [{ line: 1, date: "2026-09-02", county: "Hamilton", caseType: "", form: "", reason: "" }] });
  });

  it("reads every row when a reason holds a quotation mark, such as an inch sign", () => {
    const result = rowsFromCsv(
      [
        HEADER,
        '2026-09-02,Marion,Small claims,Small claims notice of claim,margin under 1" on page 2',
        "2026-09-03,Marion,Small claims,Small claims notice of claim,no signature",
        "2026-09-04,Marion,Small claims,Small claims notice of claim,filing fee not paid",
      ].join("\n"),
    );
    expect(result.ok && result.rows.map((row) => row.reason)).toEqual(['margin under 1" on page 2', "no signature", "filing fee not paid"]);
  });

  it("refuses a file with a quoted field that is never closed, and says on which line it opens", () => {
    const result = rowsFromCsv(
      [
        HEADER,
        "2026-09-02,Marion,Small claims,Small claims notice of claim,no signature",
        '2026-09-03,Marion,Small claims,Small claims notice of claim,"fee not paid',
        "2026-09-04,Marion,Small claims,Small claims notice of claim,page 2 blank",
      ].join("\r\n"),
    );
    expect(result).toEqual({
      ok: false,
      error:
        'Line 3 opens a field with a quotation mark (") that is never closed, so the rows after it cannot be told apart. Add the closing mark, or write a mark that is part of the text twice ("").',
    });
  });

  it("fails when there are no data rows", () => {
    const message = "No rows found. Paste a CSV with a header row and at least one record.";
    expect(rowsFromCsv("")).toEqual({ ok: false, error: message });
    expect(rowsFromCsv(HEADER)).toEqual({ ok: false, error: message });
    expect(rowsFromCsv(`${HEADER}\n\n   \n`)).toEqual({ ok: false, error: message });
  });

  it("fails when the reason column is missing", () => {
    expect(rowsFromCsv("date,county,case_type,form,notes\n2026-09-02,Hamilton,Small claims,Small claims notice of claim,x")).toEqual({
      ok: false,
      error: "The header needs a column named reason.",
    });
  });

  it("names every missing column", () => {
    expect(rowsFromCsv("date,why\n2026-09-02,x")).toEqual({
      ok: false,
      error: "The header needs columns named county, case_type, form and reason.",
    });
  });

  it("refuses more than 10,000 rows and accepts exactly 10,000", () => {
    const line = "2026-09-02,Hamilton,Small claims,Small claims notice of claim,unsigned";
    const atLimit = rowsFromCsv([HEADER, ...Array.from({ length: MAX_CSV_ROWS }, () => line)].join("\n"));
    expect(atLimit.ok).toBe(true);
    const over = rowsFromCsv([HEADER, ...Array.from({ length: MAX_CSV_ROWS + 1 }, () => line)].join("\n"));
    expect(over).toEqual({ ok: false, error: "This file has 10,001 rows. The most that can be added at once is 10,000." });
  });

  it("refuses more than 5 MB, counted in bytes", () => {
    const big = `${HEADER}\n2026-09-02,Hamilton,Small claims,Small claims notice of claim,${"x".repeat(MAX_CSV_BYTES)}`;
    expect(rowsFromCsv(big)).toEqual({
      ok: false,
      error: "This file is larger than 5 MB. Split it into smaller files and add them one at a time.",
    });
    // Two-byte characters: under the limit by length, over it by bytes.
    const accented = `${HEADER}\n2026-09-02,Hamilton,Small claims,Small claims notice of claim,${"é".repeat(MAX_CSV_BYTES / 2)}`;
    expect(accented.length).toBeLessThan(MAX_CSV_BYTES);
    expect(rowsFromCsv(accented).ok).toBe(false);
  });
});

describe("checkCsvRows", () => {
  const options = { todayIso: "2026-10-30" };

  it("accepts a clean row and types its values", () => {
    const { accepted, rejected } = checkCsvRows([row()], options);
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([
      { line: 1, date: "2026-09-02", county: "Hamilton", caseType: "Small claims", form: "Small claims notice of claim", reason: "no signature on page 2" },
    ]);
  });

  it("accepts an empty reason (it will go to Needs review)", () => {
    expect(checkCsvRows([row({ reason: "" })], options).accepted).toHaveLength(1);
  });

  it.each([
    [{ date: "09/02/2026" }, "The date is not a real date in the form YYYY-MM-DD."],
    [{ date: "2026-02-30" }, "The date is not a real date in the form YYYY-MM-DD."],
    [{ date: "" }, "The date is not a real date in the form YYYY-MM-DD."],
    [{ date: "2019-12-31" }, "The date is before 2020-01-01."],
    [{ date: "2026-10-31" }, "The date is in the future."],
    [{ county: "Cook" }, '"Cook" is not a county on the list.'],
    [{ county: "marion" }, '"marion" is not a county on the list.'],
    [{ county: "" }, "The county is missing."],
    [{ caseType: "Traffic" }, '"Traffic" is not a case type on the list.'],
    [{ caseType: "" }, "The case type is missing."],
    [{ form: "Some other form" }, '"Some other form" is not a form on the list.'],
    [{ form: "" }, "The form is missing."],
    [{ form: "Petition for change of name" }, "This form is not used for Small claims."],
    [{ reason: "x".repeat(501) }, "The reason is longer than 500 characters."],
  ] as [Partial<CsvRow>, string][])("rejects %j", (overrides, problem) => {
    const { accepted, rejected } = checkCsvRows([row(overrides)], options);
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].problems).toEqual([problem]);
    expect(rejected[0]).toMatchObject({ line: 1, ...overrides });
  });

  it("accepts today's date and the earliest allowed date", () => {
    expect(checkCsvRows([row({ date: "2026-10-30" }), row({ date: "2020-01-01" })], options).accepted).toHaveLength(2);
  });

  it("rejects a reason that looks like it holds personal data, and says what kind", () => {
    const { accepted, rejected } = checkCsvRows([row({ reason: "unsigned, see case 49D01-2401-SC-000123" })], options);
    expect(accepted).toEqual([]);
    expect(rejected[0].problems).toEqual([
      "This looks like it contains a case number. The tracker does not store anything that identifies a person.",
    ]);
  });

  it("lists every problem a row has", () => {
    const { rejected } = checkCsvRows([row({ date: "soon", county: "Cook", caseType: "", form: "" })], options);
    expect(rejected[0].problems).toHaveLength(4);
  });

  it("rejects rows for another county when a county is required, without rewriting them", () => {
    const rows = [row({ line: 1, county: "Marion" }), row({ line: 2, county: "Lake" })];
    const { accepted, rejected } = checkCsvRows(rows, { ...options, onlyCounty: "Marion" });
    expect(accepted.map((r) => r.line)).toEqual([1]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].county).toBe("Lake");
    expect(rejected[0].problems).toEqual(["This row is for Lake County. You can add rows for Marion County only."]);
  });

  it("splits a mixed file and keeps the order", () => {
    const rows = [row({ line: 1 }), row({ line: 2, county: "Nowhere" }), row({ line: 3 })];
    const { accepted, rejected } = checkCsvRows(rows, options);
    expect(accepted.map((r) => r.line)).toEqual([1, 3]);
    expect(rejected.map((r) => r.line)).toEqual([2]);
  });
});
