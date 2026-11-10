// Reads a clerk's rejection export (CSV), checks every row against the reference lists, and sorts the
// free-text reason into problem categories with plain keyword rules. Rows no rule matches are marked
// "Needs review" for a person. Nothing here saves anything.

import { NEEDS_REVIEW, REASON_MAX, isCaseType, isCounty, isForm, formMatchesCaseType, MIN_DATE } from "./domain";
import type { CaseType, County, FlagTag, Form, Tag } from "./domain";
import { describePersonalData, findPersonalData } from "./pii";
import { isIsoDate } from "./time";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

// Keyword rules: clerk free text to categories. The same rules as the prototype.
const RULES: [RegExp, Tag][] = [
  [/\b(sign|signed|signature|unsigned)\b/i, "Missing signature"],
  [/\b(wrong|old|outdated)\s+(version|form)|\bused .*form|incorrect form/i, "Wrong form"],
  [/wrong (county|court)|lives in|venue|jurisdiction/i, "Wrong county or court"],
  [/\b(needs?|missing|lacks?)\b.*\b(date|dates|detail|details|description|incident|amount|facts)\b/i, "Missing required details"],
  [/\bfee\b|waiver|\bpaid\b|payment/i, "Missing fee or fee waiver"],
  [/\bcit(e|es|ed|ation)\b|case that does not exist|statute|fake/i, "Citation not found or wrong"],
  [/\baddress\b|service/i, "Missing addresses for service"],
  [/notar|verif|sworn|affirm/i, "Not verified or notarized"],
  [/page|scan|unreadable|illegible|blank/i, "Pages missing or unreadable"],
];

/** The problems the keyword rules find in a rejection reason. Empty when no rule matches. */
export function classify(reason: string): Tag[] {
  const out: Tag[] = [];
  for (const [pattern, tag] of RULES) {
    if (pattern.test(reason) && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The tags to store for a reason sorted by the rules: the matches, or Needs review when there are none. */
export function classifyOrReview(reason: string): FlagTag[] {
  const tags = classify(reason);
  return tags.length > 0 ? tags : [NEEDS_REVIEW];
}

interface Scan {
  rows: string[][];
  /** The line (counted from 1, header included) where a quoted field opens and is never closed, or null. */
  unclosedQuoteLine: number | null;
}

function scanCsv(text: string): Scan {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  let line = 1;
  let quoteLine = 1;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    const lineBreak = c === "\n" || c === "\r";
    if (lineBreak && c === "\r" && text[i + 1] === "\n") i++;
    if (lineBreak) line++;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += lineBreak ? "\n" : c;
      }
    } else if (c === '"' && cur.trim() === "") {
      // A quotation mark opens a quoted field only at the start of a field. Anywhere else it is part of
      // the text: a reason such as: margin under 1" on page 2.
      quoted = true;
      quoteLine = line;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (lineBreak) {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((field) => field.trim())), unclosedQuoteLine: quoted ? quoteLine : null };
}

/**
 * Splits CSV text into rows of fields. Handles quoted fields, doubled quotes, commas and line breaks
 * inside quotes, CRLF or LF line ends, and a leading byte order mark. Rows that are entirely blank are
 * dropped. A quotation mark in the middle of an unquoted field is kept as text. A quoted field that is
 * never closed runs to the end of the text; rowsFromCsv refuses such a file.
 */
export function parseCSV(text: string): string[][] {
  return scanCsv(text).rows;
}

/** One data row as read from the file. Nothing is validated yet. */
export interface CsvRow {
  /** Position among the data rows, starting at 1 (the header is not counted). */
  line: number;
  date: string;
  county: string;
  caseType: string;
  form: string;
  reason: string;
}

export type CsvResult = { ok: true; rows: CsvRow[] } | { ok: false; error: string };

const COLUMNS = ["date", "county", "case_type", "form", "reason"] as const;

function joinNames(names: readonly string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Reads the export. Fails with a plain message when the file is too big, has no rows, lacks a column, or
 * opens a quoted field it never closes (everything after that mark would be read as one field, and the
 * rows it swallowed would vanish without a word).
 */
export function rowsFromCsv(text: string): CsvResult {
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) {
    return { ok: false, error: "This file is larger than 5 MB. Split it into smaller files and add them one at a time." };
  }
  const { rows, unclosedQuoteLine } = scanCsv(text);
  if (unclosedQuoteLine !== null) {
    return {
      ok: false,
      error: `Line ${unclosedQuoteLine.toLocaleString("en-US")} opens a field with a quotation mark (") that is never closed, so the rows after it cannot be told apart. Add the closing mark, or write a mark that is part of the text twice ("").`,
    };
  }
  if (rows.length < 2) {
    return { ok: false, error: "No rows found. Paste a CSV with a header row and at least one record." };
  }
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const missing = COLUMNS.filter((name) => !head.includes(name));
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        missing.length === 1
          ? `The header needs a column named ${missing[0]}.`
          : `The header needs columns named ${joinNames(missing)}.`,
    };
  }
  if (rows.length - 1 > MAX_CSV_ROWS) {
    return {
      ok: false,
      error: `This file has ${(rows.length - 1).toLocaleString("en-US")} rows. The most that can be added at once is ${MAX_CSV_ROWS.toLocaleString("en-US")}.`,
    };
  }
  const at = { date: head.indexOf("date"), county: head.indexOf("county"), caseType: head.indexOf("case_type"), form: head.indexOf("form"), reason: head.indexOf("reason") };
  const get = (r: string[], i: number) => (r[i] ?? "").replace(/\s+/g, " ").trim();
  return {
    ok: true,
    rows: rows.slice(1).map((r, n) => ({
      line: n + 1,
      date: get(r, at.date),
      county: get(r, at.county),
      caseType: get(r, at.caseType),
      form: get(r, at.form),
      reason: get(r, at.reason),
    })),
  };
}

/** A row that passed every check. It still has no tags: classification comes next. */
export interface CheckedRow {
  line: number;
  date: string;
  county: County;
  caseType: CaseType;
  form: Form;
  reason: string;
}

/** A row that cannot be added, with the reasons in plain words. */
export interface RejectedRow extends CsvRow {
  problems: string[];
}

export interface CheckOptions {
  /** The app's today, YYYY-MM-DD. Rows dated after it are rejected. */
  todayIso: string;
  /** When set, rows for any other county are rejected. A clerk can only add rows for their own county. */
  onlyCounty?: County | null;
}

/**
 * Checks each row against the reference lists, the date rules and the personal data check.
 * Rows that fail are returned in `rejected` with the reason. Nothing is rewritten to make a row fit.
 */
export function checkCsvRows(rows: readonly CsvRow[], options: CheckOptions): { accepted: CheckedRow[]; rejected: RejectedRow[] } {
  const accepted: CheckedRow[] = [];
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    const problems: string[] = [];
    if (!isIsoDate(row.date)) problems.push("The date is not a real date in the form YYYY-MM-DD.");
    else if (row.date < MIN_DATE) problems.push(`The date is before ${MIN_DATE}.`);
    else if (row.date > options.todayIso) problems.push("The date is in the future.");

    const county = isCounty(row.county) ? row.county : null;
    if (!county) problems.push(row.county ? `"${row.county}" is not a county on the list.` : "The county is missing.");
    else if (options.onlyCounty && county !== options.onlyCounty) {
      problems.push(`This row is for ${county} County. You can add rows for ${options.onlyCounty} County only.`);
    }

    const caseType = isCaseType(row.caseType) ? row.caseType : null;
    if (!caseType) problems.push(row.caseType ? `"${row.caseType}" is not a case type on the list.` : "The case type is missing.");

    const form = isForm(row.form) ? row.form : null;
    if (!form) problems.push(row.form ? `"${row.form}" is not a form on the list.` : "The form is missing.");
    else if (caseType && !formMatchesCaseType(form, caseType)) problems.push(`This form is not used for ${caseType}.`);

    if (row.reason.length > REASON_MAX) problems.push(`The reason is longer than ${REASON_MAX} characters.`);
    const findings = findPersonalData(row.reason);
    if (findings.length > 0) problems.push(describePersonalData(findings));

    if (problems.length === 0 && county && caseType && form) {
      accepted.push({ line: row.line, date: row.date, county, caseType, form, reason: row.reason });
    } else {
      rejected.push({ ...row, problems });
    }
  }
  return { accepted, rejected };
}
