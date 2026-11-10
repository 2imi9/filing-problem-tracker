import "server-only";
// Checks that generated text uses only numbers it was given. Pure: no I/O, no model.
//
// The AI summary is shown next to the real figures, so a number the model made up (or worked out itself)
// must never reach the page. The server keeps the payload it sent, pulls every number out of the text
// that came back, and refuses the text if any of them is not in the payload.

// 1,234 or 1,234.5 (thousands separators), or 12 or 12.5. A sign and a percent sign are not part of the
// number: "-75%" reads as 75.
const NUMBER = /(?<![\d,])\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?/g;

// Counts written as words are checked too. "one" is left out: it is mostly used as a pronoun.
const NUMBER_WORDS = new Map<string, number>(
  Object.entries({
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
    thousand: 1000,
    million: 1_000_000,
  }),
);

// Words that state a proportion or a multiple. They are a calculation the payload cannot back up.
const RATIO_WORDS = ["half", "halved", "twice", "double", "doubled", "triple", "tripled", "quarter", "quarters", "thirds"];

const WORD = /[a-z]+/g;

// The words that multiply what stands before them: "two hundred", "3 thousand".
const SCALE_WORDS = new Set(["hundred", "thousand", "million"]);

// A figure right before a word: "2 " in "2 hundred", "1.5 " in "1.5 million".
const FIGURE_BEFORE = /\d[\d,.]*[ \t-]*$/;

/**
 * True when the text between two number words makes them one number: a space or a hyphen ("twenty eight",
 * "twenty-eight"), or "and" after a scale word ("two hundred and five"). "two and three" stays two numbers.
 */
function joinsNumberWords(first: string, between: string): boolean {
  if (/^(?:[ \t]+|-)$/.test(between)) return true;
  return SCALE_WORDS.has(first) && /^[ \t]+and[ \t]+$/.test(between);
}

/** "1,234" -> "1234", "4.0" -> "4", "06" -> "6". */
function canonical(token: string): string {
  return String(Number(token.replace(/,/g, "")));
}

/** Every number written in digits, in order of appearance, in canonical form. */
export function digitNumbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(canonical);
}

/**
 * Every number a piece of data holds: number values (sign dropped), and numbers written inside string
 * values such as "Jun 1, 2026" or "2026-06". Object keys are not counted.
 */
export function allowedNumbers(payload: unknown): Set<string> {
  const allowed = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "number") {
      if (Number.isFinite(value)) allowed.add(String(Math.abs(value)));
    } else if (typeof value === "string") {
      for (const n of digitNumbersIn(value)) allowed.add(n);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (typeof value === "object" && value !== null) {
      Object.values(value).forEach(walk);
    }
  };
  walk(payload);
  return allowed;
}

export interface NumberCheck {
  ok: boolean;
  /** What the text says that the payload does not: numbers in canonical form, and number or ratio words as written. */
  unsupported: string[];
}

/**
 * True when every number in `text` appears in `payload`.
 * Tolerant of form, strict on value: "1,234" matches 1234, "28%" matches 28, "4.0" matches 4, "-75%"
 * matches -75 or 75, and "June 2026" matches a payload that holds "Jun 2026" or "2026-06".
 * Number words ("three counties") must match too. Ratio words ("half", "twice") never pass, and neither
 * does a number spelled with more than one word ("two hundred"): the prompt asks for digits.
 */
export function checkNumbers(text: string, payload: unknown): NumberCheck {
  const allowed = allowedNumbers(payload);
  const unsupported = new Set<string>();
  for (const n of digitNumbersIn(text)) {
    if (!allowed.has(n)) unsupported.add(n);
  }
  const lower = text.toLowerCase();
  // Number words in a row read as one number ("two hundred", "twenty-eight", "three hundred and five"), and
  // so does a figure with a scale word after it ("2 hundred"). Its parts being in the payload says nothing
  // about the number it states, so a number spelled with more than one word never passes.
  let run: { start: number; end: number; words: number; last: string } | null = null;
  const closeRun = () => {
    if (!run) return;
    const written = lower.slice(run.start, run.end);
    if (run.words > 1 || !allowed.has(String(NUMBER_WORDS.get(written)))) unsupported.add(written);
    run = null;
  };
  for (const match of lower.matchAll(WORD)) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;
    if (RATIO_WORDS.includes(word)) unsupported.add(word);
    if (!NUMBER_WORDS.has(word)) continue;
    if (SCALE_WORDS.has(word)) {
      const figure = FIGURE_BEFORE.exec(lower.slice(0, start));
      if (figure) unsupported.add(lower.slice(start - figure[0].length, end));
    }
    if (run && joinsNumberWords(run.last, lower.slice(run.end, start))) {
      run = { start: run.start, end, words: run.words + 1, last: word };
    } else {
      closeRun();
      run = { start, end, words: 1, last: word };
    }
  }
  closeRun();
  return { ok: unsupported.size === 0, unsupported: [...unsupported] };
}
