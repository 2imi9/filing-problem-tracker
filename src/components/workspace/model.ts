// Pure helpers for the workspace: editing a panel's filters, the list of open panels, folders, the
// browser cache and the reply from the composer. No React, no network, no clock.

import { COUNTIES, formMatchesCaseType } from "@/lib/domain";
import type { ChangeEvent, County, Role } from "@/lib/domain";
import { CURRENT_FOLDER_NAME, PANEL_TYPE_LABELS, PanelSpec, defaultTitle, filterChips } from "@/lib/panels";
import type { Folder, PanelDraft, PanelSize, PanelType, RankedDimension } from "@/lib/panels";
import { FOLDER_NAME_MAX, FOLDER_PANELS_MAX } from "@/lib/schemas";
import type { Filters } from "@/lib/schemas";
import type { StatFlag } from "@/lib/stats";

/** The most panels a workspace can hold. It is saved as a folder, so the folder limit applies. */
export const WORKSPACE_PANELS_MAX = FOLDER_PANELS_MAX;
export { CURRENT_FOLDER_NAME };
export const REQUEST_MAX = 300;

export type FilterKey = keyof Filters;

const ALL_FILTER_KEYS: readonly FilterKey[] = ["county", "caseType", "form", "tag", "fromMonth", "toMonth"];
const WITHOUT_COUNTY: readonly FilterKey[] = ["caseType", "form", "tag", "fromMonth", "toMonth"];
const WITHOUT_TAG: readonly FilterKey[] = ["county", "caseType", "form", "fromMonth", "toMonth"];
const NO_FILTER_KEYS: readonly FilterKey[] = [];

export const SIZE_LABELS: Record<PanelSize, string> = { s: "Small", w: "Wide", l: "Full width" };

export const DIMENSION_NAMES: Record<RankedDimension, string> = {
  tag: "Problem",
  outcome: "Outcome",
  county: "County",
  caseType: "Case type",
  form: "Form",
};

/** The filters a panel of this type can carry. A before/after panel takes its scope from the change. */
export function filterKeysFor(type: PanelType): readonly FilterKey[] {
  switch (type) {
    case "before_after":
      return NO_FILTER_KEYS;
    case "compare_counties":
      return WITHOUT_COUNTY;
    case "needs_review":
      return WITHOUT_TAG;
    default:
      return ALL_FILTER_KEYS;
  }
}

/**
 * Keeps the filters that are set and allowed (`keys`), and drops a form that does not belong to the
 * chosen case type.
 */
export function cleanFilters(filters: Filters, keys: readonly FilterKey[] = ALL_FILTER_KEYS): Filters {
  const out: Filters = {};
  if (filters.county && keys.includes("county")) out.county = filters.county;
  if (filters.caseType && keys.includes("caseType")) out.caseType = filters.caseType;
  if (filters.form && keys.includes("form") && (!out.caseType || formMatchesCaseType(filters.form, out.caseType))) out.form = filters.form;
  if (filters.tag && keys.includes("tag")) out.tag = filters.tag;
  if (filters.fromMonth && keys.includes("fromMonth")) out.fromMonth = filters.fromMonth;
  if (filters.toMonth && keys.includes("toMonth")) out.toMonth = filters.toMonth;
  return out;
}

/** The filter part of a panel's params. */
export function filtersOf(spec: PanelSpec): Filters {
  return spec.type === "before_after" ? {} : cleanFilters(spec.params, filterKeysFor(spec.type));
}

/** The same panel with its filters replaced. Fields that are not filters (dimension, counties...) are kept. */
export function withFilters(spec: PanelSpec, filters: Filters): PanelSpec {
  const next = cleanFilters(filters, filterKeysFor(spec.type));
  switch (spec.type) {
    case "kpi":
      return { ...spec, params: next };
    case "forms":
      return { ...spec, params: next };
    case "trend":
      return { ...spec, params: next };
    case "ranked":
      return {
        ...spec,
        params: { ...next, dimension: spec.params.dimension, ...(spec.params.limit === undefined ? {} : { limit: spec.params.limit }) },
      };
    case "heat":
      return { ...spec, params: { ...next, ...(spec.params.maxTags === undefined ? {} : { maxTags: spec.params.maxTags }) } };
    case "before_after":
      return spec;
    case "compare_counties":
      return { ...spec, params: { ...next, counties: spec.params.counties } };
    case "needs_review":
      return { ...spec, params: next };
  }
}

/**
 * Carries the title across an edit: a title that was the default for the old params becomes the default
 * for the new ones, and a title someone (or the composer) wrote is left alone.
 */
export function retitle(previous: PanelSpec, next: PanelSpec, events: readonly ChangeEvent[]): PanelSpec {
  if (previous.title !== defaultTitle(previous, events)) return next;
  return { ...next, title: defaultTitle(next, events) };
}

/** Replaces a panel's filters and keeps its title in step. Local only: nothing is sent anywhere. */
export function editFilters(spec: PanelSpec, filters: Filters, events: readonly ChangeEvent[]): PanelSpec {
  return retitle(spec, withFilters(spec, filters), events);
}

export interface PanelChip {
  /** "filter:county", "limit", "maxTags", "event", "eventTag", "dimension" or "compare:<county>". */
  key: string;
  label: string;
  removable: boolean;
}

/** Every setting of a panel as a chip: its type-specific fields first, then its filters. */
export function panelChips(spec: PanelSpec, events: readonly ChangeEvent[]): PanelChip[] {
  const chips: PanelChip[] = [];
  switch (spec.type) {
    case "ranked":
      chips.push({ key: "dimension", label: `By ${DIMENSION_NAMES[spec.params.dimension].toLowerCase()}`, removable: false });
      if (spec.params.limit !== undefined) chips.push({ key: "limit", label: `Top ${spec.params.limit}`, removable: true });
      break;
    case "heat":
      if (spec.params.maxTags !== undefined) {
        chips.push({ key: "maxTags", label: `${spec.params.maxTags} ${spec.params.maxTags === 1 ? "problem" : "problems"}`, removable: true });
      }
      break;
    case "before_after": {
      const event = events.find((e) => e.id === spec.params.eventId);
      chips.push({ key: "event", label: event ? event.name : "Change not found", removable: false });
      const tag = spec.params.tag ?? event?.tag;
      if (tag) chips.push({ key: "eventTag", label: tag, removable: spec.params.tag !== undefined && spec.params.tag !== event?.tag });
      break;
    }
    case "compare_counties":
      for (const county of spec.params.counties) {
        chips.push({ key: `compare:${county}`, label: `${county} County`, removable: spec.params.counties.length > 2 });
      }
      break;
    default:
      break;
  }
  for (const chip of filterChips(filtersOf(spec))) {
    chips.push({ key: `filter:${chip.key}`, label: chip.label, removable: true });
  }
  return chips;
}

/** The panel with one removable chip taken off. An unknown or fixed chip leaves the panel as it is. */
export function removeChip(spec: PanelSpec, key: string, events: readonly ChangeEvent[]): PanelSpec {
  if (key.startsWith("filter:")) {
    const filters = filtersOf(spec);
    const name = key.slice("filter:".length);
    const kept: Filters = {};
    if (name !== "county") kept.county = filters.county;
    if (name !== "caseType") kept.caseType = filters.caseType;
    if (name !== "form") kept.form = filters.form;
    if (name !== "tag") kept.tag = filters.tag;
    if (name !== "fromMonth") kept.fromMonth = filters.fromMonth;
    if (name !== "toMonth") kept.toMonth = filters.toMonth;
    return editFilters(spec, kept, events);
  }
  switch (spec.type) {
    case "ranked":
      if (key !== "limit") return spec;
      return retitle(spec, { ...spec, params: { ...filtersOf(spec), dimension: spec.params.dimension } }, events);
    case "heat":
      if (key !== "maxTags") return spec;
      return retitle(spec, { ...spec, params: filtersOf(spec) }, events);
    case "before_after":
      if (key !== "eventTag") return spec;
      return retitle(spec, { ...spec, params: { eventId: spec.params.eventId } }, events);
    case "compare_counties": {
      if (!key.startsWith("compare:") || spec.params.counties.length <= 2) return spec;
      const county = key.slice("compare:".length);
      const counties = spec.params.counties.filter((c) => c !== county);
      if (counties.length === spec.params.counties.length) return spec;
      return retitle(spec, { ...spec, params: { ...spec.params, counties } }, events);
    }
    default:
      return spec;
  }
}

// ---------- The list of open panels ----------

/** Moves a panel one place earlier (-1) or later (1). Returns the same array when it cannot move. */
export function movePanel(panels: readonly PanelSpec[], id: string, delta: -1 | 1): readonly PanelSpec[] {
  const from = panels.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= panels.length) return panels;
  const next = [...panels];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Moves a panel to the place another panel holds (drag and drop). The rest keep their order. */
export function movePanelTo(panels: readonly PanelSpec[], id: string, targetId: string): readonly PanelSpec[] {
  const from = panels.findIndex((p) => p.id === id);
  const to = panels.findIndex((p) => p.id === targetId);
  if (from < 0 || to < 0 || from === to) return panels;
  const next = [...panels];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The small panels that would sit alone in a row when the grid is two panels wide (small is half a row,
 * everything else a full row). The grid lets those take the whole row, so no half-row is left empty.
 * Small panels pair up in order; the odd one out of a run is the one alone.
 */
export function loneSmallPanels(panels: readonly PanelSpec[]): ReadonlySet<string> {
  const lone = new Set<string>();
  let open: string | null = null;
  for (const panel of panels) {
    if (panel.size !== "s") {
      if (open) lone.add(open);
      open = null;
    } else if (open) {
      open = null;
    } else {
      open = panel.id;
    }
  }
  if (open) lone.add(open);
  return lone;
}

export function replacePanel(panels: readonly PanelSpec[], next: PanelSpec): readonly PanelSpec[] {
  return panels.map((p) => (p.id === next.id ? next : p));
}

export function resizePanel(panels: readonly PanelSpec[], id: string, size: PanelSize): readonly PanelSpec[] {
  return panels.map((p) => (p.id === id && p.size !== size ? { ...p, size } : p));
}

export function closePanel(panels: readonly PanelSpec[], id: string): readonly PanelSpec[] {
  return panels.filter((p) => p.id !== id);
}

/** Puts a copy of a panel right after it. Returns the same array when the workspace is full. */
export function duplicatePanel(panels: readonly PanelSpec[], id: string, newId: string): readonly PanelSpec[] {
  const index = panels.findIndex((p) => p.id === id);
  if (index < 0 || panels.length >= WORKSPACE_PANELS_MAX) return panels;
  const next = [...panels];
  next.splice(index + 1, 0, { ...panels[index], id: newId });
  return next;
}

export interface AppendResult {
  panels: readonly PanelSpec[];
  /** Ids of the panels that were added, as they are in `panels`. */
  added: string[];
  /** Panels left out because the workspace was full. */
  dropped: number;
}

/**
 * Adds panels at the end. A panel whose id is already in use gets a new one from `makeId`. Panels
 * beyond the limit are left out and counted.
 */
export function appendPanels(panels: readonly PanelSpec[], incoming: readonly PanelSpec[], makeId: () => string): AppendResult {
  const used = new Set(panels.map((p) => p.id));
  const next = [...panels];
  const added: string[] = [];
  let dropped = 0;
  for (const panel of incoming) {
    if (next.length >= WORKSPACE_PANELS_MAX) {
      dropped += 1;
      continue;
    }
    let id = panel.id;
    while (used.has(id)) id = makeId();
    used.add(id);
    added.push(id);
    next.push(id === panel.id ? panel : { ...panel, id });
  }
  return { panels: next, added, dropped };
}

/**
 * Reads a list of panels from something untrusted (a server reply, the browser cache). Anything that is
 * not a valid PanelSpec is dropped, as is a repeated id, and the list is cut at the workspace limit.
 */
export function parsePanels(value: unknown): PanelSpec[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const panels: PanelSpec[] = [];
  for (const item of value) {
    const parsed = PanelSpec.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    panels.push(parsed.data);
    if (panels.length >= WORKSPACE_PANELS_MAX) break;
  }
  return panels;
}

/** True when two lists hold the same panels in the same order. */
export function samePanels(a: readonly PanelSpec[], b: readonly PanelSpec[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// ---------- Adding a panel by hand ----------

export interface AddPanelOption {
  type: PanelType;
  label: string;
  description: string;
  /** What gets added. Null when this type cannot be added right now. */
  draft: PanelDraft | null;
  /** Why it cannot be added, or null. */
  unavailable: string | null;
}

const ADD_DESCRIPTIONS: Record<PanelType, string> = {
  kpi: "Flagged filings, the most common problem and the county with the most.",
  ranked: "A sorted bar list of problems, outcomes, counties, case types or forms.",
  heat: "A table of counties against the most common problems.",
  forms: "One row per form with its most common problem.",
  trend: "Flagged filings for each month.",
  before_after: "Monthly averages before and after a change a court made.",
  compare_counties: "Two or more counties side by side.",
  needs_review: "Imported rows that still need a person to choose the problem.",
};

const ADD_ORDER: readonly PanelType[] = ["kpi", "ranked", "trend", "heat", "forms", "before_after", "compare_counties", "needs_review"];

/** The counties the viewer has data for, in reference order. A clerk has one. */
export function countiesIn(records: readonly StatFlag[]): County[] {
  const present = new Set(records.map((r) => r.county));
  return COUNTIES.filter((county) => present.has(county));
}

/**
 * The changes worth offering to this viewer. A clerk only has their own county's filings, so a change
 * made in another county would always read as zero.
 */
export function eventsFor(user: { role: Role; county: County | null }, events: readonly ChangeEvent[]): readonly ChangeEvent[] {
  return user.role === "clerk" ? events.filter((event) => event.county === user.county) : events;
}

/** One entry per panel type for the Add panel menu, each with the params a new panel starts with. */
export function addPanelOptions(context: { counties: readonly County[]; events: readonly ChangeEvent[] }): AddPanelOption[] {
  return ADD_ORDER.map((type): AddPanelOption => {
    const base = { type, label: PANEL_TYPE_LABELS[type], description: ADD_DESCRIPTIONS[type] };
    switch (type) {
      case "kpi":
        return { ...base, draft: { type, params: {} }, unavailable: null };
      case "ranked":
        return { ...base, draft: { type, params: { dimension: "tag" } }, unavailable: null };
      case "heat":
        return { ...base, draft: { type, params: {} }, unavailable: null };
      case "forms":
        return { ...base, draft: { type, params: {} }, unavailable: null };
      case "trend":
        return { ...base, draft: { type, params: {} }, unavailable: null };
      case "needs_review":
        return { ...base, draft: { type, params: {} }, unavailable: null };
      case "before_after": {
        const first = context.events[0];
        if (!first) return { ...base, draft: null, unavailable: "No changes have been recorded yet." };
        return { ...base, draft: { type, params: { eventId: first.id } }, unavailable: null };
      }
      case "compare_counties": {
        if (context.counties.length < 2) return { ...base, draft: null, unavailable: "This needs data from at least two counties." };
        return { ...base, draft: { type, params: { counties: context.counties.slice(0, 3) } }, unavailable: null };
      }
    }
  });
}

// ---------- The command bar ----------

/** Three requests to try, shown while the workspace is empty. A clerk's are about their own county. */
export function exampleRequests(user: { role: Role; county: County | null }): string[] {
  if (user.role === "clerk") {
    return ["Most common problems this year", "Missing signature month by month", "Which forms are flagged most"];
  }
  return [
    "Missing signatures in Marion small claims",
    "Compare Marion, Lake and Allen on wrong form",
    "Did the revised small claims form reduce missing signatures?",
  ];
}

export interface ComposeReply {
  panels: PanelSpec[];
  notice: string | null;
  /** Who chose the panels: the model, or the keyword rules. Null when the reply did not say. */
  source: "ai" | "rules" | null;
}

/** Reads the body of POST /api/ai/compose. Panels that are not valid specs are dropped. */
export function parseComposeReply(body: unknown): ComposeReply {
  if (typeof body !== "object" || body === null) return { panels: [], notice: null, source: null };
  const record = body as Record<string, unknown>;
  const notice = typeof record.notice === "string" && record.notice.trim() !== "" ? record.notice.trim() : null;
  const source = record.source === "ai" || record.source === "rules" ? record.source : null;
  return { panels: parsePanels(record.panels), notice, source };
}

// ---------- Undo ----------

/** A step that can be undone (closing a panel, opening a folder): the panels before it and the panels it left. */
export interface UndoStep {
  before: readonly PanelSpec[];
  after: readonly PanelSpec[];
}

/**
 * The panels Undo puts back, or null when Undo is not on offer. Undo returns the whole list to how it
 * was, so it is offered only while the list is still exactly as the step left it. After a filter edit,
 * a resize or any other change it would throw that later work away, so it is withdrawn.
 */
export function undoTarget(step: UndoStep | null, panels: readonly PanelSpec[]): readonly PanelSpec[] | null {
  return step !== null && step.after === panels ? step.before : null;
}

// ---------- Folders ----------

export interface RailFolder extends Folder {
  /** True for a built-in example shown while the saved folders could not be loaded. It can be opened but not renamed or deleted. */
  example: boolean;
}

/** Separates the reserved folder that holds the open panels from the folders the user saved. */
export function splitFolders(folders: readonly Folder[]): { current: Folder | null; saved: Folder[] } {
  return {
    current: folders.find((f) => f.name === CURRENT_FOLDER_NAME) ?? null,
    saved: folders.filter((f) => f.name !== CURRENT_FOLDER_NAME),
  };
}

/**
 * What the rail lists. Once the server has answered (`loaded`), that is the saved folders and nothing
 * else: the server puts the examples there once for each person, so an example that was deleted stays
 * deleted. The built-in examples stand in only while the saved folders could not be loaded.
 */
export function railFolders(saved: readonly Folder[], examples: readonly Folder[], loaded: boolean): RailFolder[] {
  if (loaded) return saved.map((folder) => ({ ...folder, example: false }));
  return examples.map((folder) => ({ ...folder, example: true }));
}

const normalizeName = (name: string) => name.replace(/\s+/g, " ").trim();

/** Why a folder name cannot be used, in plain words, or null when it can. */
export function folderNameError(name: string): string | null {
  const clean = normalizeName(name);
  if (clean === "") return "Give the folder a name.";
  if (clean.length > FOLDER_NAME_MAX) return `The name can be at most ${FOLDER_NAME_MAX} characters.`;
  if (clean.toLowerCase() === CURRENT_FOLDER_NAME) return "That name is reserved. Choose another.";
  return null;
}

/** The saved folder with this name, ignoring case and extra spaces. */
export function findFolderByName<F extends Folder>(folders: readonly F[], name: string): F | undefined {
  const wanted = normalizeName(name).toLowerCase();
  return folders.find((folder) => normalizeName(folder.name).toLowerCase() === wanted);
}

// ---------- Browser cache (a fallback only; the folders API is the record) ----------

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

export interface CachedWorkspace {
  panels: PanelSpec[];
  /** True when these panels have not reached the server yet. */
  dirty: boolean;
}

export function cacheKey(userId: string): string {
  return `fpt.workspace.v1.${userId}`;
}

/** The cached workspace for this user, or null when there is none or the store cannot be read. */
export function readCache(store: ReadStore | null, userId: string): CachedWorkspace | null {
  if (!store) return null;
  try {
    const raw = store.getItem(cacheKey(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.panels)) return null;
    return { panels: parsePanels(record.panels), dirty: record.dirty === true };
  } catch {
    return null;
  }
}

/** Saves the workspace in the browser. Returns false when the store is missing, full or blocked. */
export function writeCache(store: WriteStore | null, userId: string, workspace: { panels: readonly PanelSpec[]; dirty: boolean }): boolean {
  if (!store) return false;
  try {
    store.setItem(cacheKey(userId), JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}
