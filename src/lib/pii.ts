// Looks for text that could identify a person: case numbers, phone numbers, email addresses, Social
// Security numbers, street addresses and names. It is a guard against slips, run on notes and on imported
// rejection reasons before anything is saved or sent to the AI. It is pattern matching, not proof: it can
// miss a name written in all capitals, and it can flag an unusual capitalized phrase.
//
// Letters are matched as Unicode letters, so a name with an accent ("José García") is one word like any
// other, and the text is put into composed form (NFC) first, so an accent typed as a separate combining
// mark does not split a word. Findings point into that composed text.

import { CASE_TYPES, COUNTIES, FORMS, NEEDS_REVIEW, OUTCOMES, TAGS } from "./domain";

export type PiiKind = "case_number" | "ssn" | "phone" | "email" | "address" | "name";

export interface PiiFinding {
  kind: PiiKind;
  /** The text that matched. */
  match: string;
  /** Where the match starts in the text. */
  index: number;
}

export const PII_LABELS: Record<PiiKind, string> = {
  case_number: "a case number",
  ssn: "a Social Security number",
  phone: "a phone number",
  email: "an email address",
  address: "a street address",
  name: "a person's name",
};

// When two patterns match the same text, the kind listed first wins.
const KIND_ORDER: PiiKind[] = ["case_number", "ssn", "phone", "email", "address", "name"];

const PATTERNS: [PiiKind, RegExp][] = [
  // Indiana uniform case number, for example 49D01-2401-SC-000123.
  ["case_number", /\b\d{2}[A-Za-z]\d{2}-\d{4}-[A-Za-z]{2}-\d{1,7}\b/g],
  // Hyphenated runs that mix letters with four or more digits, for example SC-2024-00123.
  ["case_number", /\b(?=[A-Za-z0-9-]*[A-Za-z])(?=(?:[A-Za-z0-9-]*\d){4})[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g],
  // Compact runs such as 24SC001234 or SC0012345.
  ["case_number", /\b\d{2,4}[A-Za-z]{2,4}\d{3,}\b|\b[A-Za-z]{2,4}\d{5,}\b/g],
  // "case no. 12345", "cause # 2024-1234".
  ["case_number", /\b(?:case|cause|docket)\s*(?:no\.?|number|num\.?|#)?\s*[:#]?\s*(?=[A-Za-z0-9-]*\d[A-Za-z0-9-]*\d[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,}/gi],
  ["ssn", /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g],
  ["ssn", /\b(?:ssn|social security(?: number)?)\D{0,6}\d{9}\b/gi],
  ["ssn", /(?<![\d-])\d{9}(?![\d-])/g],
  ["phone", /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])/g],
  ["phone", /(?<![\d-])\d{10}(?![\d-])/g],
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
  ["address", /\bP\.?\s?O\.?\s+Box\s+\d+\b/gi],
  // Any other long run of digits is treated as an identifier (nine digits read as a Social Security number
  // and ten as a phone number, above).
  ["case_number", /(?<![\d-])(?:\d{7,8}|\d{11,})(?![\d-])/g],
];

const STREET_SUFFIX =
  "st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pkwy|parkway|hwy|highway|cir|circle";
// Words that join parts of a sentence and are never part of a street's name. Without this, a number and
// the word "court" a few words later read as an address: "filed 2 days late in wrong court".
const NOT_IN_STREET_NAME = "in|of|the|to|at|for|on|from|with|before|after|and|or";
const ADDRESS = new RegExp(
  `(?<![\\d-])\\d{1,6}\\s+((?:(?!(?:${NOT_IN_STREET_NAME})\\s)[\\p{L}\\p{N}.'-]+\\s+){1,4}?)(?:${STREET_SUFFIX})(?![\\p{L}\\p{N}])\\.?(?!\\s*Joseph)`,
  "giu",
);
const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);

// Words that are part of the job, not part of a name. Built from the reference lists plus court and
// everyday words that clerks capitalize.
const EXTRA_WORDS = `
  january february march april may june july august september october november december
  jan feb mar apr jun jul aug sep sept oct nov dec
  monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday
  indiana county counties court courts clerk clerks judge judges magistrate commissioner superior circuit
  township city town state office division room counter lobby desk window kiosk
  small claims claim family eviction evictions protective order orders name change dissolution children
  child support custody parenting time paternity guardianship divorce marriage adoption
  form forms petition petitions notice notices motion motions answer answers counterclaim complaint
  summons subpoena affidavit affidavits appearance certificate certificates declaration decree judgment
  exhibit exhibits attachment attachments worksheet worksheets schedule schedules cover sheet sheets
  packet packets document documents filing filings file filed filer filers e-filing efiling odyssey
  tenant tenants landlord landlords defendant defendants plaintiff plaintiffs petitioner petitioners
  respondent respondents party parties litigant litigants attorney attorneys notary public self help
  represented unrepresented pro se guide guides checklist checklists instructions instruction
  signature signatures signed sign unsigned fee fees waiver waivers payment paid unpaid service served
  address addresses verified verification notarized notarization sworn citation citations statute
  page pages scan scanned copy copies original originals blank illegible unreadable legible
  missing wrong incorrect incomplete required details detail description date dates amount amounts facts
  financial income information confidential proof hearing hearings trial case cases cause docket
  rejected returned fixed accepted corrected pending review needs need needed
  version versions old new current outdated revised updated rule rules local code section line box part item
  number numbers first second third last next prior previous other another same different
  the this that these those there here a an and or but if then than so because while when where which who
  what why how no not none never only also already still again
  on in at for to from with without by of off out up down over under into onto about after before between
  per as is are was were be been being has have had do does did will would should could must may might can
  called calling call came come bring brought sent send left gave given told asked wants wanted lives
  lived used using see saw seen please thanks thank note notes all any each every both some many few more most
  one two three four five six seven eight nine ten am pm sample prototype demo test center centre
  department agency program services bureau legal aid library online portal website
  day days week weeks month months year years hour hours late early attach attached
`;

// Indiana places whose names are two capitalized words, which would otherwise read as "Firstname
// Lastname". A clerk writes these when a filing went to the wrong county or court.
const PLACE_NAMES = new Set(
  `fort wayne|south bend|crown point|west lafayette|terre haute|east chicago|beech grove|mount vernon|north vernon
  |rising sun|french lick|west baden|santa claus|notre dame|la porte|fort branch|north manchester|south haven
  |saint john|saint joseph|west terre haute|north judson|south whitley`
    .split("|")
    .map((name) => name.trim()),
);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g) ?? [];
}

const VOCABULARY = new Set<string>([
  ...words([...COUNTIES, ...CASE_TYPES, ...FORMS, ...TAGS, ...OUTCOMES, NEEDS_REVIEW].join(" ")),
  ...words(EXTRA_WORDS),
]);

/** True for a word from the tracker's own vocabulary, ignoring case and simple endings. */
function isKnownWord(word: string): boolean {
  return word
    .toLowerCase()
    .split("-")
    .every((part) => {
      const w = part.replace(/'s$/, "");
      if (VOCABULARY.has(w)) return true;
      return ["s", "es", "d", "ed", "ing"].some(
        (ending) => w.length > ending.length + 2 && w.endsWith(ending) && VOCABULARY.has(w.slice(0, -ending.length)),
      );
    });
}

// One capitalized word as it appears in a name: Smith, O'Brien, McDonald, Garcia-Lopez, García. Words in
// all capitals do not match, so a reason typed in capitals is not read as a list of names.
const NAME_WORD = "\\p{Lu}(?:\\p{Ll}+|'\\p{Lu}\\p{Ll}+)(?:\\p{Lu}\\p{Ll}+)?(?:[-']\\p{Lu}?\\p{Ll}+)*";
// Where a word starts and ends. "\b" only knows the letters a to z, so it would end "José" after "Jos".
const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";
const CAPITALIZED = new RegExp(`${WORD_START}${NAME_WORD}${WORD_END}`, "gu");
// A title or a party role, then a capitalized word. Only the abbreviations take a period: after a role
// word a period ends the sentence ("Returned to filer. Forgot page 2.").
const TITLED_NAME = new RegExp(
  `${WORD_START}(?:(?:Mr|Mrs|Ms|Mx|Dr|Atty)\\.?|Miss|Attorney|Judge|[Dd]efendant|[Pp]laintiff|[Pp]etitioner|[Rr]espondent|[Tt]enant|[Ll]andlord|[Ff]iler)\\s+(${NAME_WORD})${WORD_END}`,
  "gu",
);
const MIDDLE_INITIAL_GAP = /^\s+(?:\p{Lu}\.?\s+)?$/u;

function findNames(text: string): PiiFinding[] {
  const found: PiiFinding[] = [];

  // Two or more capitalized words in a row, none of them a known word: "Firstname Lastname".
  let run: { index: number; end: number; count: number } | null = null;
  const closeRun = () => {
    if (run && run.count >= 2) {
      const match = text.slice(run.index, run.end);
      if (!PLACE_NAMES.has(match.toLowerCase().replace(/\s+/g, " "))) found.push({ kind: "name", match, index: run.index });
    }
    run = null;
  };
  for (const m of text.matchAll(CAPITALIZED)) {
    const start = m.index;
    const end = start + m[0].length;
    if (isKnownWord(m[0])) {
      closeRun();
      continue;
    }
    // A middle initial ("J.") may sit between two parts of a name.
    const joins: boolean = run !== null && MIDDLE_INITIAL_GAP.test(text.slice(run.end, start));
    if (run && joins) {
      run = { index: run.index, end, count: run.count + 1 };
    } else {
      closeRun();
      run = { index: start, end, count: 1 };
    }
  }
  closeRun();

  // A title or a party role followed by one capitalized word: "Mr. Lastname", "defendant Lastname".
  for (const m of text.matchAll(TITLED_NAME)) {
    if (!isKnownWord(m[1])) found.push({ kind: "name", match: m[0], index: m.index });
  }
  return found;
}

function findAddresses(text: string): PiiFinding[] {
  const found: PiiFinding[] = [];
  for (const m of text.matchAll(ADDRESS)) {
    const streetWords = m[1].trim().split(/\s+/);
    // "page 2 of the small claims court form" is not an address: every word before the suffix is a known word.
    const named = streetWords.some((w) => !DIRECTIONS.has(w.toLowerCase().replace(/\.$/, "")) && !isKnownWord(w));
    if (named) found.push({ kind: "address", match: m[0], index: m.index });
  }
  return found;
}

/**
 * Returns what looks like personal data in the text. An empty array means nothing was found.
 * Findings are sorted by position and do not overlap.
 */
export function findPersonalData(input: string): PiiFinding[] {
  const text = input.normalize("NFC");
  const all: PiiFinding[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const m of text.matchAll(pattern)) all.push({ kind, match: m[0], index: m.index });
  }
  all.push(...findAddresses(text), ...findNames(text));

  // Prefer the longer match, then the more specific kind, and drop anything that overlaps a kept finding.
  all.sort(
    (a, b) => b.match.length - a.match.length || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.index - b.index,
  );
  const kept: PiiFinding[] = [];
  for (const finding of all) {
    const end = finding.index + finding.match.length;
    if (!kept.some((k) => finding.index < k.index + k.match.length && k.index < end)) kept.push(finding);
  }
  return kept.sort((a, b) => a.index - b.index);
}

/** One plain sentence naming what was found, or an empty string when nothing was. */
export function describePersonalData(findings: readonly PiiFinding[]): string {
  const kinds = KIND_ORDER.filter((kind) => findings.some((f) => f.kind === kind)).map((kind) => PII_LABELS[kind]);
  if (kinds.length === 0) return "";
  const list = kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;
  return `This looks like it contains ${list}. The tracker does not store anything that identifies a person.`;
}
