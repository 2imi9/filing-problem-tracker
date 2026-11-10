import "server-only";
// Turns a request typed into the workspace command bar into panels by matching words. No model, no
// network: this is what runs when AI is off, fails, or chooses nothing, and it always gives the same
// answer for the same request and data.
//
// It looks for the names the tracker already knows (counties, case types, forms, problems, recorded
// changes, months) and a few words that point at a kind of panel ("compare", "by month", "did it help").

import { CASE_TYPES, COUNTIES, FORMS, TAGS, caseTypeOfForm } from "@/lib/domain";
import type { CaseType, ChangeEvent, County, Form, Tag } from "@/lib/domain";
import type { PanelDraft } from "@/lib/panels";
import type { Filters } from "@/lib/schemas";
import { countBy, rank } from "@/lib/stats";
import type { StatFlag } from "@/lib/stats";
import { addMonths, monthOf } from "@/lib/time";

export interface ComposeContext {
  /** The recorded changes. */
  events: readonly ChangeEvent[];
  /** The flags the person may see. Used only to rank counties ("the three biggest counties"). */
  flags: readonly StatFlag[];
  /** The app's today, YYYY-MM-DD. */
  todayIso: string;
  /**
   * The one county a clerk is held to, or null for a person who sees every county. A panel for another
   * county would count that county's filings in records the person does not have and print zero.
   */
  viewerCounty: County | null;
}

/** The recorded changes a panel can be opened for: all of them, or those in the one county the person sees. */
export function eventsInScope(context: Pick<ComposeContext, "events" | "viewerCounty">): ChangeEvent[] {
  const { viewerCounty } = context;
  return viewerCounty === null ? [...context.events] : context.events.filter((event) => event.county === viewerCounty);
}

/** "Lake", "Lake and Allen", "Lake, Allen and Monroe". */
const listOf = (names: readonly string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export interface KeywordPlan {
  /** Panels to open, in order. Empty when nothing in the request matched. */
  drafts: PanelDraft[];
  /** A plain sentence for the person when something they asked for could not be done. */
  notice?: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const COUNTY_PATTERNS: [County, RegExp][] = COUNTIES.map((county) => [
  county,
  // "St. Joseph" is also written "St Joseph" and "Saint Joseph".
  new RegExp(`\\b${escapeRegExp(county.toLowerCase()).replace(/^st\\\. /, "(?:st\\.?|saint)\\s+")}\\b`),
]);

const CASE_TYPE_PATTERNS: Record<CaseType, RegExp> = {
  "Small claims": /\bsmall[\s-]claims?\b/,
  "Protective order": /\bprotective[\s-]orders?\b|\borders? of protection\b/,
  Family: /\bfamily\b|\bdivorces?\b|\bdissolutions?\b|\bchild support\b|\bcustody\b/,
  Eviction: /\bevictions?\b|\btenants?\b|\blandlords?\b/,
  "Name change": /\bname[\s-]changes?\b|\bchanges? of name\b/,
};

// Shorter ways people refer to a form. The full name always matches too.
const FORM_ALIASES: Record<Form, RegExp> = {
  "Small claims notice of claim": /\bnotices? of claim\b/,
  "Small claims counterclaim": /\bcounter-?claims?\b/,
  "Petition for order of protection": /\bpetitions? for (?:an? )?order of protection\b/,
  "Petition to modify or extend order": /\bmodify or extend\b|\bextend (?:an? |the )?order\b/,
  "Petition for dissolution, no children": /\bdissolution,? (?:with )?no children\b|\bdissolution without children\b/,
  "Petition for dissolution, with children": /\bdissolution,? with children\b/,
  "Petition to modify child support": /\bmodify child support\b/,
  "Tenant answer or request for hearing": /\btenant answers?\b|\brequests? for (?:a )?hearing\b/,
  "Petition for change of name": /\bpetitions? for (?:a )?change of name\b/,
};

// How a person asking a question names each problem. These differ from the import rules in csv.ts, which
// read a clerk's rejection reason ("lives in", "page 2"); a request says "signatures" or "fees".
const TAG_PATTERNS: Record<Tag, RegExp> = {
  "Missing signature": /\b(?:un)?sign(?:ed|ing|ature|atures)?\b/,
  "Wrong form": /\b(?:wrong|old|outdated|incorrect)\s+(?:version|forms?)\b/,
  "Wrong county or court": /\bwrong\s+(?:county|court|venue)\b|\bvenue\b|\bjurisdiction\b/,
  "Missing required details": /\b(?:required\s+)?details?\b|\bincomplete\b/,
  "Missing fee or fee waiver": /\bfees?\b|\bwaivers?\b/,
  "Citation not found or wrong": /\bcitations?\b|\bcit(?:e|es|ed|ing)\b/,
  "Missing addresses for service": /\baddress(?:es)?\b|\bservice\b/,
  "Not verified or notarized": /\bnotar\w*|\bverif\w*/,
  "Pages missing or unreadable": /\bpages?\b|\bunreadable\b|\billegible\b/,
};

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Full names and three-letter short forms, plus "Sept". */
const MONTH_WORD = MONTH_NAMES.map((name) => {
  if (name === "september") return "sep(?:t(?:ember)?)?";
  return name.length > 3 ? `${name.slice(0, 3)}(?:${name.slice(3)})?` : name;
}).join("|");
const monthNumber = (word: string) => MONTH_NAMES.findIndex((name) => name.startsWith(word.slice(0, 3))) + 1;

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const COUNT_WORD = `\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")}`;
const toCount = (word: string) => NUMBER_WORDS[word] ?? Number(word);

// "Did it help?" in its common forms: the person is asking about the effect of a change.
const EFFECT_WORDS = /\b(?:help(?:ed|s|ing)?|reduc(?:e|ed|es|ing|tion)|before|after|work(?:ed|s|ing)?|improv(?:e|ed|es|ement)|effects?|impact|difference|drop(?:ped|s)?|fewer|changes?|changed)\b/;
const COMPARE_WORDS = /\b(?:compar\w*|versus|vs\.?|against|side by side)\b/;

const PANEL_WORDS = {
  needsReview: /\bneeds? review\b|\bunsorted\b|\bwaiting for review\b|\breview queue\b/,
  heat: /\bheat\b|\bby county\b|\bcounty by problem\b|\bwhich count(?:y|ies)\b|\bacross (?:the )?counties\b|\ball counties\b/,
  forms: /\bforms\b|\bby form\b|\bwhich form\b|\beach form\b/,
  outcomes: /\boutcomes?\b|\brejected\b|\breturned\b|\bfixed at (?:the )?counter\b|\bwhat happened\b/,
  trend: /\btrends?\b|\bover time\b|\bmonth by month\b|\bby month\b|\bmonthly\b|\beach month\b|\bper month\b/,
  problems: /\bmost common\b|\b(?:top|common|biggest|main) (?:problems?|issues?|reasons?)\b|\bwhat goes wrong\b|\bwhy\b/,
  caseTypes: /\bby case type\b|\bcase types\b|\bwhich case type\b/,
  kpi: /\boverview\b|\bkey numbers\b|\bhow many\b|\btotals?\b|\bheadline\b/,
} as const;

// Words too general to identify a change by name.
const GENERIC_WORDS = new Set([
  ...[...COUNTIES, ...CASE_TYPES, ...FORMS, ...TAGS].join(" ").toLowerCase().match(/[a-z]+/g) ?? [],
  ...MONTH_NAMES,
  ..."county court courts clerk office form forms change changes help self with from that this after before start starts started".split(" "),
]);

/** The words in a change's name that set it apart: "kiosk", "guide", "revised". */
function distinctiveWords(event: ChangeEvent): string[] {
  const words = event.name.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
  return words.filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word));
}

/** Reads a request one piece at a time. Each piece that is recognized is blanked so it is not read twice. */
class Reader {
  rest: string;

  constructor(text: string) {
    this.rest = text.toLowerCase().replace(/[‘’]/g, "'");
  }

  /** The first match, or null. A match is blanked out of the text. */
  take(pattern: RegExp): RegExpExecArray | null {
    const match = pattern.exec(this.rest);
    if (match) this.blank(match.index, match[0].length);
    return match;
  }

  /** Where the pattern first matches, or -1. Nothing is blanked. */
  find(pattern: RegExp): number {
    return pattern.exec(this.rest)?.index ?? -1;
  }

  has(pattern: RegExp): boolean {
    return pattern.test(this.rest);
  }

  blank(index: number, length: number): void {
    this.rest = this.rest.slice(0, index) + " ".repeat(length) + this.rest.slice(index + length);
  }
}

function readForm(reader: Reader): Form | undefined {
  for (const form of FORMS) {
    if (reader.take(new RegExp(`\\b${escapeRegExp(form.toLowerCase()).replace(/,/g, ",?")}\\b`)) || reader.take(FORM_ALIASES[form])) return form;
  }
  return undefined;
}

/** The problem named first in the request. A request can filter on one. */
function readTag(reader: Reader): Tag | undefined {
  let best: { tag: Tag; index: number; pattern: RegExp } | null = null;
  for (const tag of TAGS) {
    for (const pattern of [new RegExp(`\\b${escapeRegExp(tag.toLowerCase())}\\b`), TAG_PATTERNS[tag]]) {
      const index = reader.find(pattern);
      if (index >= 0 && (best === null || index < best.index)) best = { tag, index, pattern };
    }
  }
  if (!best) return undefined;
  reader.take(best.pattern);
  return best.tag;
}

function readCaseType(reader: Reader): CaseType | undefined {
  return CASE_TYPES.find((caseType) => reader.take(CASE_TYPE_PATTERNS[caseType]) !== null);
}

/** Every county named, in the order named. */
function readCounties(reader: Reader): County[] {
  const found: { county: County; index: number }[] = [];
  for (const [county, pattern] of COUNTY_PATTERNS) {
    const match = reader.take(pattern);
    if (match) found.push({ county, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index).map((entry) => entry.county);
}

/** "this year", "last month", "past 3 months", "since June", "in September". */
function readMonths(reader: Reader, todayIso: string): Pick<Filters, "fromMonth" | "toMonth"> {
  const current = monthOf(todayIso);
  const year = current.slice(0, 4);
  // A month named without a year is the most recent one: this year's, or last year's if it has not come yet.
  const named = (word: string) => {
    const month = `${year}-${String(monthNumber(word)).padStart(2, "0")}`;
    return month > current ? addMonths(month, -12) : month;
  };

  if (reader.take(/\bthis year\b|\byear to date\b|\bso far this year\b/)) return { fromMonth: `${year}-01` };
  if (reader.take(/\bthis month\b/)) return { fromMonth: current, toMonth: current };
  if (reader.take(/\blast month\b/)) return { fromMonth: addMonths(current, -1), toMonth: addMonths(current, -1) };
  const span = reader.take(new RegExp(`\\b(?:last|past)\\s+(${COUNT_WORD})\\s+months\\b`));
  if (span) return { fromMonth: addMonths(current, 1 - Math.min(36, Math.max(1, toCount(span[1])))) };
  const range = reader.take(new RegExp(`\\b(?:from\\s+)?(${MONTH_WORD})\\s+(?:to|through|until)\\s+(${MONTH_WORD})\\b`));
  if (range) return { fromMonth: named(range[1]), toMonth: named(range[2]) };
  const since = reader.take(new RegExp(`\\b(?:since|from)\\s+(${MONTH_WORD})\\b`));
  if (since) return { fromMonth: named(since[1]) };
  const single = reader.take(new RegExp(`\\b(?:in|during|for)\\s+(${MONTH_WORD})\\b`));
  if (single) return { fromMonth: named(single[1]), toMonth: named(single[1]) };
  return {};
}

/** The number in "the three biggest counties" or "top 4 counties", or null. Naming a number of counties asks for a comparison. */
function readCountyCount(reader: Reader): number | null {
  const match = reader.take(new RegExp(`\\b(?:top\\s+)?(${COUNT_WORD})\\s+(?:(?:biggest|largest|busiest|top)\\s+)?counties\\b`));
  return match ? toCount(match[1]) : null;
}

/**
 * Chooses panels for a request by matching words.
 *
 * - A recorded change named in the request, or a "did it help" question that fits one, opens a before/after panel.
 * - "Compare", or two or more counties, opens a county comparison. With fewer than two counties named, it uses the counties with the most flagged filings.
 * - Words such as "by month", "outcomes" or "forms" open that kind of panel.
 * - Otherwise a county, case type, form, problem or month range opens the key numbers, the ranked problems and the monthly trend for it.
 *
 * A person held to one county gets panels for that county only: other counties named are left out, with a
 * notice, and so are changes made elsewhere.
 */
export function composeByKeywords(text: string, context: ComposeContext): KeywordPlan {
  const reader = new Reader(text);
  const drafts: PanelDraft[] = [];
  const notices: string[] = [];

  // Changes are matched on the untouched text, before their words can be read as something else.
  const events = eventsInScope(context);
  const namedEvents = events.filter((event) => {
    const hits = distinctiveWords(event).map((word) => reader.take(new RegExp(`\\b${escapeRegExp(word)}s?\\b`)));
    return hits.some((hit) => hit !== null);
  });

  const form = readForm(reader);
  const tag = readTag(reader);
  // A form settles the case type. A case type named as well is read, so its words are not matched again, and then ignored.
  const namedCaseType = readCaseType(reader);
  const caseType = form ? caseTypeOfForm(form) : namedCaseType;
  const namedCounties = readCounties(reader);
  const { viewerCounty } = context;
  const counties = viewerCounty === null ? namedCounties : namedCounties.filter((name) => name === viewerCounty);
  if (counties.length < namedCounties.length) {
    const leftOut = namedCounties.filter((name) => !counties.includes(name));
    notices.push(`You see ${viewerCounty} County only, so ${listOf(leftOut)} ${leftOut.length === 1 ? "was" : "were"} left out.`);
  }
  const months = readMonths(reader, context.todayIso);
  const county = counties.length === 1 ? counties[0] : undefined;

  const shared: Omit<Filters, "county" | "tag"> = { ...(caseType ? { caseType } : {}), ...(form ? { form } : {}), ...months };
  const filters: Omit<Filters, "tag"> = { ...(county ? { county } : {}), ...shared };
  const withTag: Filters = { ...filters, ...(tag ? { tag } : {}) };
  const anyFilter = Object.keys(withTag).length > 0;

  // 1. Before and after a change.
  let chosenEvents = namedEvents;
  if (chosenEvents.length === 0 && reader.has(EFFECT_WORDS) && events.length > 0) {
    const score = (event: ChangeEvent) =>
      Number(counties.includes(event.county)) + Number(caseType === event.caseType) + Number(tag === event.tag);
    const best = Math.max(...events.map(score));
    if (best > 0) chosenEvents = events.filter((event) => score(event) === best);
    else if (!anyFilter) chosenEvents = events;
    else notices.push("No recorded change matches that county, case type or problem, so the panels show the filings instead.");
  }
  for (const event of chosenEvents) {
    drafts.push({ type: "before_after", params: { eventId: event.id, ...(tag && tag !== event.tag ? { tag } : {}) } });
  }
  if (chosenEvents.length === 1) {
    const event = chosenEvents[0];
    drafts.push({ type: "trend", params: { county: event.county, caseType: event.caseType, tag: tag ?? event.tag } });
  }

  // 2. Counties side by side.
  const wanted = readCountyCount(reader);
  if (namedCounties.length >= 2 || wanted !== null || reader.has(COMPARE_WORDS)) {
    const ranked = rank(countBy(context.flags, (flag) => flag.county), context.flags.length).map((entry) => entry.label);
    const size = Math.min(COUNTIES.length, Math.max(2, wanted ?? 3));
    const chosen = counties.length >= 2 ? counties : [...counties, ...ranked.filter((name) => !counties.includes(name))].slice(0, size);
    if (chosen.length >= 2) {
      drafts.push({ type: "compare_counties", params: { counties: chosen, ...shared, ...(tag ? { tag } : {}) } });
    } else {
      notices.push("There is data for one county only, so there is nothing to compare.");
    }
  }

  // 3. Panels asked for by kind.
  if (reader.has(PANEL_WORDS.needsReview)) drafts.push({ type: "needs_review", params: filters });
  if (reader.has(PANEL_WORDS.heat)) drafts.push({ type: "heat", params: withTag });
  if (reader.has(PANEL_WORDS.forms)) drafts.push({ type: "forms", params: withTag });
  if (reader.has(PANEL_WORDS.outcomes)) drafts.push({ type: "ranked", params: { ...withTag, dimension: "outcome" } });
  if (reader.has(PANEL_WORDS.trend)) drafts.push({ type: "trend", params: withTag });
  if (reader.has(PANEL_WORDS.problems)) drafts.push({ type: "ranked", params: { ...filters, dimension: "tag" } });
  if (reader.has(PANEL_WORDS.caseTypes)) drafts.push({ type: "ranked", params: { ...withTag, dimension: "caseType" } });
  if (reader.has(PANEL_WORDS.kpi)) drafts.push({ type: "kpi", params: filters });

  // 4. Nothing asked for by kind: the standard set for whatever was named.
  if (drafts.length === 0 && anyFilter) {
    const problems: PanelDraft = { type: "ranked", params: { ...filters, dimension: "tag" } };
    const numbers: PanelDraft = { type: "kpi", params: filters };
    // With a problem named, its month by month count leads. The other two leave the problem filter off,
    // so they show where that problem stands among all of them.
    if (tag) drafts.push({ type: "trend", params: withTag }, problems, numbers);
    else drafts.push(numbers, problems, { type: "trend", params: filters });
  }

  if (drafts.length === 0 && notices.length === 0) {
    notices.push("Nothing in that request matched a county, a case type, a form, a problem or a recorded change. Name one, or use Add panel.");
  }
  return notices.length > 0 ? { drafts, notice: notices.join(" ") } : { drafts };
}
