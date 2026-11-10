// Renders the dashboard and the workspace to HTML with the data context replaced by the sample data.
// No browser and no effects: this checks the first render of each page for each role.

import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeanFlag, SessionUser } from "@/lib/domain";
import { EXAMPLE_FOLDERS, computePanel } from "@/lib/panels";
import type { Folder, PanelSpec } from "@/lib/panels";
import { SAMPLE_EVENTS, SAMPLE_TODAY, demoUserById, makeSampleRecords } from "@/lib/sample";
import { dashboardPanels } from "@/components/panels/dashboardSpecs";
import type { WorkspaceStore } from "@/components/workspace/useWorkspaceStore";

const ALL_RECORDS: LeanFlag[] = makeSampleRecords();

function user(id: string): SessionUser {
  const found = demoUserById(id);
  if (!found) throw new Error(`no demo user ${id}`);
  return found;
}

const session = vi.hoisted(() => ({
  current: null as null | { records: unknown[]; events: unknown[]; user: unknown; todayIso: string; ai: boolean },
}));
const workspace = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/components/data/DataProvider", () => ({
  DataGate: ({ children }: { children: ReactNode }) => children,
  useLoadedData: () => session.current,
}));

vi.mock("@/components/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: () => workspace.current,
}));

function signIn(id: string, options: { ai?: boolean; events?: typeof SAMPLE_EVENTS } = {}) {
  const who = user(id);
  const records = who.role === "clerk" ? ALL_RECORDS.filter((record) => record.county === who.county) : ALL_RECORDS;
  session.current = { records, events: options.events ?? SAMPLE_EVENTS, user: who, todayIso: SAMPLE_TODAY, ai: options.ai ?? true };
  return records;
}

function store(panels: readonly PanelSpec[], folders: readonly Folder[], overrides: Partial<WorkspaceStore> = {}): WorkspaceStore {
  return {
    ready: true,
    panels,
    update: () => undefined,
    current: () => panels,
    folders,
    saveState: "idle",
    loadError: null,
    reload: () => undefined,
    saveFolder: async () => null,
    renameFolder: async () => null,
    deleteFolder: async () => null,
    ...overrides,
  };
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const labels = (html: string) => [...html.matchAll(/<label[^>]*>(.*?)<\/label>/g)].map((match) => text(match[1]).trim());
const headings = (html: string) => [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((match) => text(match[1]).trim());

async function renderDashboard(): Promise<string> {
  const { Dashboard } = await import("@/app/dashboard/Dashboard");
  return renderToStaticMarkup(createElement(Dashboard));
}

async function renderWorkspace(): Promise<string> {
  const { Workspace } = await import("@/components/workspace/Workspace");
  return renderToStaticMarkup(createElement(Workspace));
}

beforeEach(() => {
  session.current = null;
  workspace.current = null;
});

describe("dashboard", () => {
  it("a leader gets the filter bar, the AI summary and the six panels in order", async () => {
    signIn("demo-leader");
    const html = await renderDashboard();
    expect(labels(html)).toEqual(["County", "Case type", "From", "To", "Change to check", "Problem to follow"]);
    expect(headings(html)).toEqual([
      "AI summary",
      "Key numbers",
      "Most common problems",
      "What happened to flagged filings",
      "Problems by county",
      "Problems by form",
      "Before and after a change",
    ]);
    expect(text(html)).toContain("900 flagged filings: All counties, all case types, all months");
    expect(text(html)).toContain("AI summary. Check against the numbers below.");
    expect(html).toMatch(/<button[^>]*>(<svg.*?<\/svg>)?<span>Generate<\/span>/);
    expect(text(html)).not.toContain("Summary unavailable");
    expect(text(html)).not.toContain("Clear all filters");
    expect(text(html)).not.toContain("You see");
  });

  it("prints exactly what computePanel returns for each of its specs", async () => {
    const records = signIn("demo-leader");
    const html = text(await renderDashboard());
    const specs = dashboardPanels({ filters: {}, eventId: null, tag: null }, SAMPLE_EVENTS);
    for (const spec of [specs.kpi, specs.problems, specs.outcomes, specs.heat, specs.forms, specs.beforeAfter]) {
      if (!spec) throw new Error("expected every dashboard panel");
      expect(html).toContain(computePanel(spec, records, SAMPLE_EVENTS, SAMPLE_TODAY).summary);
    }
    expect(html).toContain("Missing required details 284 32%");
    expect(html).toContain("-75%");
  });

  it("says the summary is unavailable when AI is off, and offers nothing to press", async () => {
    signIn("demo-leader", { ai: false });
    const html = await renderDashboard();
    expect(text(html)).toContain("Summary unavailable. AI features are switched off on this server.");
    expect(text(html)).not.toMatch(/Generate\b(?! and)/);
    expect(headings(html)).toContain("Key numbers");
  });

  it("a clerk sees one county: no county filter, a note, and only that county's changes", async () => {
    const records = signIn("demo-clerk-lake");
    const html = await renderDashboard();
    expect(labels(html)).toEqual(["Case type", "From", "To", "Change to check", "Problem to follow"]);
    expect(text(html)).toContain("You see Lake County only.");
    // The scope names the county the clerk sees, never "All counties".
    expect(text(html)).toContain(`${records.length} flagged filings: Lake County, all case types, all months`);
    expect(text(html)).not.toContain("All counties");
    const changeSelect = html.match(/<select[^>]*>(?:(?!<\/select>).)*Protective order guide.*?<\/select>/)?.[0] ?? "";
    expect(changeSelect).toContain("Protective order guide (Lake, Jul 15)");
    expect(changeSelect).not.toContain("Revised small claims form");
    expect(html.match(/<th scope="row">Lake<\/th>/g)).toHaveLength(1);
    expect(html).not.toContain('<th scope="row">Marion</th>');
  });

  it("explains the before/after panel when no change is recorded", async () => {
    signIn("demo-leader", { events: [] });
    const html = await renderDashboard();
    expect(headings(html)).toContain("Before and after a change");
    expect(text(html)).toContain("No changes have been recorded yet");
    expect(labels(html)).toEqual(["County", "Case type", "From", "To"]);
  });
});

describe("workspace", () => {
  it("empty: a large command bar with three example requests, and the folders the server holds", async () => {
    signIn("demo-leader");
    // The server puts the example folders there for each person, as saved folders.
    workspace.current = store([], EXAMPLE_FOLDERS);
    const html = await renderWorkspace();
    expect(text(html)).toContain("What do you want to see?");
    expect(text(html)).toContain("Or try one of these");
    expect(text(html)).toContain("Missing signatures in Marion small claims");
    expect(text(html)).toContain("Add panel");
    expect(html).not.toContain('aria-label="Open panels"');
    for (const folder of EXAMPLE_FOLDERS) {
      expect(text(html)).toContain(`Open folder ${folder.name} ${folder.panels.length} panels`);
      expect(html).toContain(`aria-label="Delete folder ${folder.name}"`);
    }
    expect(text(html)).not.toContain(", example");
    expect(text(html)).not.toContain("You see");
  });

  it("with every folder deleted the rail is empty: no example comes back", async () => {
    signIn("demo-leader");
    workspace.current = store([], []);
    const html = text(await renderWorkspace());
    expect(html).toContain("No folders yet.");
    expect(html).not.toContain("Open folder");
    expect(html).not.toContain("Examples built on the sample data");
  });

  it("with panels: the bar docks, the grid lists every panel and the rail lists saved folders", async () => {
    signIn("demo-leader");
    const panels = EXAMPLE_FOLDERS[0].panels;
    workspace.current = store(panels, [{ id: "f1", name: "Monday review", panels }], { saveState: "saved" });
    const html = await renderWorkspace();
    expect(html).toContain('aria-label="Open panels"');
    expect(html.match(/data-panel-id="/g)).toHaveLength(panels.length);
    expect(headings(html)).toEqual([...panels.map((panel) => panel.title), "Folders"]);
    expect(text(html)).not.toContain("Or try one of these");
    expect(text(html)).toContain("Layout saved");
    expect(text(html)).toContain("Open folder Monday review 4 panels");
    expect(text(html)).not.toContain("Examples built on the sample data.");
    for (const panel of panels) {
      expect(html).toContain(`aria-label="Move earlier: ${panel.title}"`);
      expect(html).toContain(`aria-label="Close ${panel.title}"`);
    }
  });

  it("a clerk is told the workspace covers their county only, and gets their county's example when the folders cannot be loaded", async () => {
    signIn("demo-clerk-marion");
    workspace.current = store([], [], { loadError: "Could not reach the server. Check the connection and try again." });
    const html = await renderWorkspace();
    expect(text(html)).toContain("You see Marion County only.");
    // The saved folders could not be loaded, so the built-in example for their county stands in.
    expect(text(html)).toContain("Open folder Marion small claims 4 panels, example");
    expect(text(html)).toContain("Examples built on the sample data, listed while your own folders cannot be loaded.");
    expect(text(html)).not.toContain("Open folder County comparison");
    expect(text(html)).toContain("Most common problems this year");
  });

  it("waits for the saved workspace before offering the command bar", async () => {
    signIn("demo-leader");
    workspace.current = store([], [], { ready: false });
    const html = await renderWorkspace();
    expect(text(html)).toContain("Loading your workspace");
    expect(html).not.toContain('id="workspace-request"');
    expect(html).not.toContain("Open folder");
  });

  it("says so when the saved workspace could not be loaded", async () => {
    signIn("demo-leader");
    workspace.current = store([], [], { loadError: "Could not reach the server. Check the connection and try again.", saveState: "local" });
    const html = text(await renderWorkspace());
    expect(html).toContain("Your saved workspace could not be loaded.");
    expect(html).toContain("Try again");
    expect(html).toContain("Layout kept in this browser only.");
  });
});
