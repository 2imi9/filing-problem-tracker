import { describe, expect, it } from "vitest";
import { PanelSpec, createPanel, defaultTitle, EXAMPLE_FOLDERS } from "@/lib/panels";
import type { Folder, PanelDraft } from "@/lib/panels";
import { SAMPLE_EVENTS, makeSampleRecords } from "@/lib/sample";
import { FolderInput } from "@/lib/schemas";
import {
  CURRENT_FOLDER_NAME,
  WORKSPACE_PANELS_MAX,
  addPanelOptions,
  appendPanels,
  cacheKey,
  cleanFilters,
  closePanel,
  countiesIn,
  duplicatePanel,
  editFilters,
  eventsFor,
  exampleRequests,
  filterKeysFor,
  filtersOf,
  findFolderByName,
  folderNameError,
  loneSmallPanels,
  movePanel,
  movePanelTo,
  panelChips,
  parseComposeReply,
  parsePanels,
  railFolders,
  undoTarget,
  readCache,
  removeChip,
  replacePanel,
  resizePanel,
  retitle,
  samePanels,
  splitFolders,
  withFilters,
  writeCache,
} from "@/components/workspace/model";

const panel = (id: string, draft: PanelDraft) => createPanel(draft, id, SAMPLE_EVENTS);
const ids = (panels: readonly { id: string }[]) => panels.map((p) => p.id);
const valid = (spec: unknown) => PanelSpec.safeParse(spec).success;

const KPI = panel("a", { type: "kpi", params: {} });
const RANKED = panel("b", { type: "ranked", params: { dimension: "tag", limit: 5, county: "Marion" } });
const HEAT = panel("c", { type: "heat", params: { maxTags: 4 } });
const BEFORE_AFTER = panel("d", { type: "before_after", params: { eventId: "sc-form" } });
const COMPARE = panel("e", { type: "compare_counties", params: { counties: ["Marion", "Lake", "Allen"], tag: "Wrong form" } });
const REVIEW = panel("f", { type: "needs_review", params: { county: "Lake" } });
const ALL = [KPI, RANKED, HEAT, BEFORE_AFTER, COMPARE, REVIEW];

describe("filters on a panel", () => {
  it("knows which filters each panel type takes", () => {
    expect(filterKeysFor("kpi")).toEqual(["county", "caseType", "form", "tag", "fromMonth", "toMonth"]);
    expect(filterKeysFor("before_after")).toEqual([]);
    expect(filterKeysFor("compare_counties")).not.toContain("county");
    expect(filterKeysFor("needs_review")).not.toContain("tag");
  });

  it("drops unset filters and a form that does not belong to the case type", () => {
    expect(cleanFilters({ county: undefined, caseType: "Family", form: "Small claims counterclaim", tag: "Wrong form" })).toEqual({
      caseType: "Family",
      tag: "Wrong form",
    });
    expect(cleanFilters({ caseType: "Family", form: "Petition to modify child support" })).toEqual({
      caseType: "Family",
      form: "Petition to modify child support",
    });
    expect(cleanFilters({ form: "Small claims counterclaim" })).toEqual({ form: "Small claims counterclaim" });
  });

  it("reads the filter part of each panel", () => {
    expect(filtersOf(RANKED)).toEqual({ county: "Marion" });
    expect(filtersOf(BEFORE_AFTER)).toEqual({});
    expect(filtersOf(COMPARE)).toEqual({ tag: "Wrong form" });
    expect(filtersOf(REVIEW)).toEqual({ county: "Lake" });
  });

  it("replaces filters and keeps the fields that are not filters", () => {
    const ranked = withFilters(RANKED, { caseType: "Family" });
    expect(ranked.params).toEqual({ caseType: "Family", dimension: "tag", limit: 5 });
    expect(withFilters(HEAT, { county: "Lake" }).params).toEqual({ county: "Lake", maxTags: 4 });
    expect(withFilters(COMPARE, { county: "Lake", caseType: "Family" }).params).toEqual({ caseType: "Family", counties: ["Marion", "Lake", "Allen"] });
    expect(withFilters(REVIEW, { tag: "Wrong form", county: "Allen" }).params).toEqual({ county: "Allen" });
    expect(withFilters(BEFORE_AFTER, { county: "Lake" })).toBe(BEFORE_AFTER);
  });

  it("always produces a spec the schema accepts", () => {
    const filters = { county: "Lake", caseType: "Family", form: "Small claims counterclaim", tag: "Needs review", fromMonth: "2026-03", toMonth: "2026-01" } as const;
    for (const spec of ALL) expect(valid(withFilters(spec, filters))).toBe(true);
  });

  it("keeps a default title in step with the filters and leaves a written title alone", () => {
    const edited = editFilters(KPI, { county: "Lake" }, SAMPLE_EVENTS);
    expect(KPI.title).toBe("Key numbers");
    expect(edited.title).toBe("Key numbers: Lake");
    const named = { ...KPI, title: "My numbers" };
    expect(editFilters(named, { county: "Lake" }, SAMPLE_EVENTS).title).toBe("My numbers");
    const otherChange = panel("d", { type: "before_after", params: { eventId: "po-guide" }, title: BEFORE_AFTER.title });
    expect(retitle(BEFORE_AFTER, otherChange, SAMPLE_EVENTS).title).toBe(defaultTitle({ type: "before_after", params: { eventId: "po-guide" } }, SAMPLE_EVENTS));
  });
});

describe("chips", () => {
  it("lists a panel's settings, fixed ones first", () => {
    expect(panelChips(RANKED, SAMPLE_EVENTS)).toEqual([
      { key: "dimension", label: "By problem", removable: false },
      { key: "limit", label: "Top 5", removable: true },
      { key: "filter:county", label: "Marion County", removable: true },
    ]);
    expect(panelChips(KPI, SAMPLE_EVENTS)).toEqual([]);
    expect(panelChips(HEAT, SAMPLE_EVENTS)).toEqual([{ key: "maxTags", label: "4 problems", removable: true }]);
  });

  it("names the change and the problem of a before/after panel", () => {
    expect(panelChips(BEFORE_AFTER, SAMPLE_EVENTS)).toEqual([
      { key: "event", label: "Revised small claims form (Marion, Jun 1)", removable: false },
      { key: "eventTag", label: "Missing signature", removable: false },
    ]);
    const other = panel("x", { type: "before_after", params: { eventId: "sc-form", tag: "Wrong form" } });
    expect(panelChips(other, SAMPLE_EVENTS)[1]).toEqual({ key: "eventTag", label: "Wrong form", removable: true });
    const gone = panel("y", { type: "before_after", params: { eventId: "deleted" } });
    expect(panelChips(gone, SAMPLE_EVENTS)).toEqual([{ key: "event", label: "Change not found", removable: false }]);
  });

  it("lets a county go from a comparison only while more than two remain", () => {
    const chips = panelChips(COMPARE, SAMPLE_EVENTS);
    expect(chips.map((c) => c.key)).toEqual(["compare:Marion", "compare:Lake", "compare:Allen", "filter:tag"]);
    expect(chips.slice(0, 3).every((c) => c.removable)).toBe(true);
    const two = removeChip(COMPARE, "compare:Lake", SAMPLE_EVENTS);
    expect(two.type === "compare_counties" && two.params.counties).toEqual(["Marion", "Allen"]);
    expect(two.title).toBe("Compare Marion and Allen: Wrong form");
    expect(panelChips(two, SAMPLE_EVENTS).filter((c) => c.key.startsWith("compare:")).every((c) => !c.removable)).toBe(true);
    expect(removeChip(two, "compare:Marion", SAMPLE_EVENTS)).toBe(two);
  });

  it("removes one chip and keeps the rest", () => {
    const noLimit = removeChip(RANKED, "limit", SAMPLE_EVENTS);
    expect(noLimit.params).toEqual({ county: "Marion", dimension: "tag" });
    const noCounty = removeChip(RANKED, "filter:county", SAMPLE_EVENTS);
    expect(noCounty.params).toEqual({ dimension: "tag", limit: 5 });
    expect(noCounty.title).toBe("Most common problems");
    expect(removeChip(HEAT, "maxTags", SAMPLE_EVENTS).params).toEqual({});
    const withTag = panel("x", { type: "before_after", params: { eventId: "sc-form", tag: "Wrong form" } });
    expect(removeChip(withTag, "eventTag", SAMPLE_EVENTS).params).toEqual({ eventId: "sc-form" });
    expect(removeChip(RANKED, "dimension", SAMPLE_EVENTS)).toBe(RANKED);
    expect(removeChip(KPI, "limit", SAMPLE_EVENTS)).toBe(KPI);
    for (const spec of ALL) {
      for (const chip of panelChips(spec, SAMPLE_EVENTS)) expect(valid(removeChip(spec, chip.key, SAMPLE_EVENTS))).toBe(true);
    }
  });
});

describe("the list of open panels", () => {
  const list = [KPI, RANKED, HEAT];

  it("moves a panel one place and stops at the ends", () => {
    expect(ids(movePanel(list, "a", 1))).toEqual(["b", "a", "c"]);
    expect(ids(movePanel(list, "c", -1))).toEqual(["a", "c", "b"]);
    expect(movePanel(list, "a", -1)).toBe(list);
    expect(movePanel(list, "c", 1)).toBe(list);
    expect(movePanel(list, "missing", 1)).toBe(list);
  });

  it("moves a dragged panel to the place of the one it is over", () => {
    expect(ids(movePanelTo(list, "a", "c"))).toEqual(["b", "c", "a"]);
    expect(ids(movePanelTo(list, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(movePanelTo(list, "a", "a")).toBe(list);
    expect(movePanelTo(list, "a", "missing")).toBe(list);
  });

  it("resizes, replaces and closes", () => {
    expect(resizePanel(list, "a", "s")[0].size).toBe("s");
    expect(resizePanel(list, "a", "s")[1]).toBe(RANKED);
    const renamed = { ...RANKED, title: "Renamed" };
    expect(replacePanel(list, renamed)[1]).toBe(renamed);
    expect(ids(closePanel(list, "b"))).toEqual(["a", "c"]);
  });

  it("puts a duplicate right after the original", () => {
    const next = duplicatePanel(list, "a", "copy");
    expect(ids(next)).toEqual(["a", "copy", "b", "c"]);
    expect(next[1]).toEqual({ ...KPI, id: "copy" });
    expect(duplicatePanel(list, "missing", "copy")).toBe(list);
    const fullList = Array.from({ length: WORKSPACE_PANELS_MAX }, (_, i) => ({ ...KPI, id: `k${i}` }));
    expect(duplicatePanel(fullList, "k0", "copy")).toBe(fullList);
  });

  it("appends panels, gives a clashing id a new one and stops at the limit", () => {
    let made = 0;
    const makeId = () => `new${(made += 1)}`;
    const result = appendPanels(list, [{ ...HEAT, id: "a" }, { ...HEAT, id: "z" }], makeId);
    expect(ids(result.panels)).toEqual(["a", "b", "c", "new1", "z"]);
    expect(result.added).toEqual(["new1", "z"]);
    expect(result.dropped).toBe(0);

    const nearlyFull = Array.from({ length: WORKSPACE_PANELS_MAX - 1 }, (_, i) => ({ ...KPI, id: `k${i}` }));
    const capped = appendPanels(nearlyFull, [{ ...HEAT, id: "x" }, { ...HEAT, id: "y" }], makeId);
    expect(capped.panels).toHaveLength(WORKSPACE_PANELS_MAX);
    expect(capped.added).toEqual(["x"]);
    expect(capped.dropped).toBe(1);
    expect(FolderInput.safeParse({ name: CURRENT_FOLDER_NAME, panels: capped.panels }).success).toBe(true);
  });

  it("reads panels from untrusted data and drops what is not a panel", () => {
    const parsed = parsePanels([KPI, { ...RANKED, params: { dimension: "color" } }, "text", null, { ...KPI }, HEAT]);
    expect(ids(parsed)).toEqual(["a", "c"]);
    expect(parsePanels("nope")).toEqual([]);
    expect(parsePanels(undefined)).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ ...KPI, id: `k${i}` }));
    expect(parsePanels(many)).toHaveLength(WORKSPACE_PANELS_MAX);
  });

  it("compares two lists by content", () => {
    expect(samePanels(list, [...list])).toBe(true);
    expect(samePanels(list, [RANKED, KPI, HEAT])).toBe(false);
    expect(samePanels(list, resizePanel(list, "a", "s"))).toBe(false);
    expect(samePanels([], [])).toBe(true);
  });
});

describe("small panels in a grid two panels wide", () => {
  const sized = (sizes: string) => [...sizes].map((size, index) => ({ ...KPI, id: `p${index}`, size: size as "s" | "w" | "l" }));
  const lone = (sizes: string) => [...loneSmallPanels(sized(sizes))].sort();

  it("pair up in order, and the one left without a small neighbor is marked to take the whole row", () => {
    expect(lone("")).toEqual([]);
    expect(lone("ss")).toEqual([]);
    expect(lone("s")).toEqual(["p0"]);
    expect(lone("wsw")).toEqual(["p1"]);
    expect(lone("sss")).toEqual(["p2"]);
    expect(lone("ssws")).toEqual(["p3"]);
    expect(lone("swsl")).toEqual(["p0", "p2"]);
    expect(lone("wl")).toEqual([]);
  });
});

describe("adding a panel by hand", () => {
  const records = makeSampleRecords();

  it("finds the counties there is data for, in reference order", () => {
    expect(countiesIn(records)).toHaveLength(8);
    expect(countiesIn(records.filter((r) => r.county === "Lake" || r.county === "Marion"))).toEqual(["Marion", "Lake"]);
    expect(countiesIn([])).toEqual([]);
  });

  it("offers every panel type with params the schema accepts", () => {
    const options = addPanelOptions({ counties: countiesIn(records), events: SAMPLE_EVENTS });
    expect(options.map((o) => o.type).sort()).toEqual(["before_after", "compare_counties", "forms", "heat", "kpi", "needs_review", "ranked", "trend"]);
    for (const option of options) {
      expect(option.unavailable).toBeNull();
      expect(option.draft).not.toBeNull();
      if (option.draft) expect(valid(createPanel(option.draft, "new", SAMPLE_EVENTS))).toBe(true);
    }
  });

  it("says why a type cannot be added", () => {
    const options = addPanelOptions({ counties: ["Marion"], events: [] });
    const byType = Object.fromEntries(options.map((o) => [o.type, o]));
    expect(byType.before_after.draft).toBeNull();
    expect(byType.before_after.unavailable).toBe("No changes have been recorded yet.");
    expect(byType.compare_counties.draft).toBeNull();
    expect(byType.compare_counties.unavailable).toBe("This needs data from at least two counties.");
    expect(byType.kpi.draft).not.toBeNull();
  });

  it("offers a clerk only the changes made in their county", () => {
    expect(eventsFor({ role: "clerk", county: "Lake" }, SAMPLE_EVENTS).map((e) => e.id)).toEqual(["po-guide"]);
    expect(eventsFor({ role: "clerk", county: "Monroe" }, SAMPLE_EVENTS)).toEqual([]);
    expect(eventsFor({ role: "leader", county: null }, SAMPLE_EVENTS)).toHaveLength(3);
    expect(eventsFor({ role: "admin", county: null }, SAMPLE_EVENTS)).toHaveLength(3);
  });
});

describe("the command bar", () => {
  it("has three example requests for every role", () => {
    expect(exampleRequests({ role: "leader", county: null })).toHaveLength(3);
    expect(exampleRequests({ role: "admin", county: null })).toHaveLength(3);
    const clerk = exampleRequests({ role: "clerk", county: "Lake" });
    expect(clerk).toHaveLength(3);
    // A clerk sees one county, so their examples do not name another.
    expect(clerk.join(" ")).not.toMatch(/Marion|Allen/);
  });

  it("reads a compose reply and drops panels that are not valid", () => {
    const reply = parseComposeReply({ panels: [KPI, { type: "kpi" }, RANKED], notice: "  Two panels matched.  ", source: "rules" });
    expect(ids(reply.panels)).toEqual(["a", "b"]);
    expect(reply.notice).toBe("Two panels matched.");
    expect(reply.source).toBe("rules");
  });

  it("copes with a reply that is not what it should be", () => {
    expect(parseComposeReply(null)).toEqual({ panels: [], notice: null, source: null });
    expect(parseComposeReply("text")).toEqual({ panels: [], notice: null, source: null });
    expect(parseComposeReply({ panels: "x", notice: 4, source: "magic" })).toEqual({ panels: [], notice: null, source: null });
    expect(parseComposeReply({ panels: [], notice: "" })).toEqual({ panels: [], notice: null, source: null });
  });
});

describe("folders", () => {
  const current: Folder = { id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] };
  const mine: Folder = { id: "m1", name: "Marion  Review", panels: [RANKED] };

  it("keeps the reserved folder out of the rail", () => {
    expect(splitFolders([mine, current])).toEqual({ current, saved: [mine] });
    expect(splitFolders([mine])).toEqual({ current: null, saved: [mine] });
  });

  it("lists what the server holds once it has answered, and no example in place of a deleted folder", () => {
    expect(railFolders([mine], EXAMPLE_FOLDERS, true)).toEqual([{ ...mine, example: false }]);
    // Every folder deleted: the rail is empty. The examples do not come back.
    expect(railFolders([], EXAMPLE_FOLDERS, true)).toEqual([]);
  });

  it("stands the examples in only while the saved folders could not be loaded", () => {
    const examples = railFolders([], EXAMPLE_FOLDERS, false);
    expect(examples).toHaveLength(3);
    expect(examples.every((folder) => folder.example)).toBe(true);
  });

  it("checks a folder name", () => {
    expect(folderNameError("   ")).toBe("Give the folder a name.");
    expect(folderNameError("x".repeat(61))).toBe("The name can be at most 60 characters.");
    expect(folderNameError(" __CURRENT ")).toBe("That name is reserved. Choose another.");
    expect(folderNameError("Marion review")).toBeNull();
    expect(folderNameError("x".repeat(60))).toBeNull();
  });

  it("finds a folder by name whatever the case and spacing", () => {
    expect(findFolderByName([mine], " marion review ")).toBe(mine);
    expect(findFolderByName([mine], "Lake review")).toBeUndefined();
  });
});

describe("the browser cache", () => {
  function memoryStore(): Storage {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => void values.delete(key),
      setItem: (key, value) => void values.set(key, value),
    };
  }

  it("writes and reads back one user's panels", () => {
    const store = memoryStore();
    expect(writeCache(store, "u1", { panels: [KPI, RANKED], dirty: true })).toBe(true);
    expect(readCache(store, "u1")).toEqual({ panels: [KPI, RANKED], dirty: true });
    expect(readCache(store, "u2")).toBeNull();
    expect(cacheKey("u1")).not.toBe(cacheKey("u2"));
  });

  it("drops cached panels that are no longer valid", () => {
    const store = memoryStore();
    store.setItem(cacheKey("u1"), JSON.stringify({ panels: [KPI, { id: "old", type: "pie" }], dirty: false }));
    expect(readCache(store, "u1")).toEqual({ panels: [KPI], dirty: false });
  });

  it("treats a broken or blocked store as no cache", () => {
    const store = memoryStore();
    store.setItem(cacheKey("u1"), "{not json");
    expect(readCache(store, "u1")).toBeNull();
    store.setItem(cacheKey("u1"), JSON.stringify(["a"]));
    expect(readCache(store, "u1")).toBeNull();
    store.setItem(cacheKey("u1"), "null");
    expect(readCache(store, "u1")).toBeNull();

    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readCache(blocked, "u1")).toBeNull();
    expect(writeCache(blocked, "u1", { panels: [KPI], dirty: true })).toBe(false);
    expect(readCache(null, "u1")).toBeNull();
    expect(writeCache(null, "u1", { panels: [], dirty: false })).toBe(false);
  });
});

describe("undo of a close or of opening a folder", () => {
  const before = [KPI, RANKED];
  const after = [KPI];

  it("is offered while the panels are exactly as the step left them, and puts back what was there before", () => {
    expect(undoTarget({ before, after }, after)).toBe(before);
    expect(undoTarget(null, after)).toBeNull();
  });

  it("is withdrawn once the panels have changed again, so it cannot throw that change away", () => {
    // A resize or a filter edit after the close: a new list, even when it holds the same panels.
    const resized = [{ ...KPI, size: "s" as const }];
    expect(undoTarget({ before, after }, resized)).toBeNull();
    expect(undoTarget({ before, after }, [...after])).toBeNull();
    expect(undoTarget({ before, after }, before)).toBeNull();
  });
});
