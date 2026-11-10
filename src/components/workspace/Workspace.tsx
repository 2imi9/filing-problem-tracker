"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelSize, PanelSpec } from "@/lib/panels";
import { createPanel, exampleFoldersFor, monthChoices } from "@/lib/panels";
import { DataGate, useLoadedData } from "@/components/data/DataProvider";
import { ApiError, apiFetch } from "@/components/data/apiClient";
import { Alert, Button, Spinner } from "@/components/ui";
import { AddPanelMenu } from "./AddPanelMenu";
import { COMMAND_INPUT_ID, CommandBar } from "./CommandBar";
import type { CommandResult } from "./CommandBar";
import { FolderRail } from "./FolderRail";
import { Grid } from "./Grid";
import type { DragHandle } from "./Grid";
import { WorkspacePanel } from "./WorkspacePanel";
import type { PanelControl } from "./WorkspacePanel";
import { newPanelId } from "./ids";
import {
  WORKSPACE_PANELS_MAX,
  addPanelOptions,
  appendPanels,
  closePanel,
  countiesIn,
  duplicatePanel,
  eventsFor,
  exampleRequests,
  movePanel,
  movePanelTo,
  parseComposeReply,
  parsePanels,
  railFolders,
  replacePanel,
  resizePanel,
  undoTarget,
} from "./model";
import type { AddPanelOption, RailFolder, UndoStep } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";
import type { SaveState } from "./useWorkspaceStore";
import styles from "./workspace.module.css";

/** How long a new panel keeps its outline. */
const FRESH_MS = 2400;

const SAVE_LABELS: Record<SaveState, string> = {
  idle: "",
  saving: "Saving the layout",
  saved: "Layout saved",
  local: "Layout kept in this browser only. It will be saved when the server can be reached.",
};

interface Status {
  text: string;
  /** Set when the step can be undone. */
  undo: UndoStep | null;
}

const panelsWord = (count: number) => `${count} ${count === 1 ? "panel" : "panels"}`;

/** The workspace: a command bar, a grid of live panels and a rail of saved folders. */
export function Workspace() {
  return (
    <DataGate>
      <LoadedWorkspace />
    </DataGate>
  );
}

function LoadedWorkspace() {
  const { records, events, user, todayIso } = useLoadedData();
  const store = useWorkspaceStore(user.id);
  const { panels, update } = store;
  const [minimized, setMinimized] = useState<ReadonlySet<string>>(() => new Set());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status | null>(null);
  /** Where keyboard focus should go once the grid has been redrawn. */
  const focusRequest = useRef<{ id: string; control: PanelControl } | "command" | null>(null);

  const counties = useMemo(() => countiesIn(records), [records]);
  const months = useMemo(() => monthChoices(records, todayIso), [records, todayIso]);
  // The changes offered when adding or editing a panel. Panels still get every change, to look one up by id.
  const offered = useMemo(() => eventsFor(user, events), [user, events]);
  const options = useMemo(() => addPanelOptions({ counties, events: offered }), [counties, offered]);
  const folders = useMemo(() => railFolders(store.folders, exampleFoldersFor(user), store.loadError === null), [store.folders, store.loadError, user]);
  const requests = useMemo(() => exampleRequests(user), [user]);
  const full = panels.length >= WORKSPACE_PANELS_MAX;
  const empty = panels.length === 0;
  // Offered only while the panels are as the step left them: see undoTarget.
  const undoPanels = undoTarget(status?.undo ?? null, panels);

  // After a keyboard move or a close, put focus back on a control that still exists.
  useEffect(() => {
    const request = focusRequest.current;
    if (request === null) return;
    focusRequest.current = null;
    const target =
      request === "command"
        ? document.getElementById(COMMAND_INPUT_ID)
        : document.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(request.id)}"] [data-control="${request.control}"]`);
    target?.focus();
  }, [panels]);

  const markFresh = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    setFresh((current) => new Set([...current, ...ids]));
    window.setTimeout(() => {
      setFresh((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, FRESH_MS);
  };

  /**
   * Adds panels to the end of the grid and says how many were opened. It reads the panels as they are
   * now, not as they were when a request was sent, so a change made while waiting is kept.
   */
  const open = (incoming: readonly PanelSpec[], how: string, notice: string | null) => {
    const result = appendPanels(store.current(), incoming, newPanelId);
    update(() => result.panels);
    markFresh(result.added);
    const left = result.dropped > 0 ? ` ${panelsWord(result.dropped)} did not fit: a workspace holds at most ${WORKSPACE_PANELS_MAX}.` : "";
    setStatus({ text: `${panelsWord(result.added.length)} opened${how}.${left}${notice ? ` ${notice}` : ""}`, undo: null });
  };

  const compose = async (request: string): Promise<CommandResult> => {
    let body: unknown;
    try {
      body = await apiFetch<unknown>("/api/ai/compose", { method: "POST", body: { request } });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
        return { ok: false, message: "Requests in words are not available right now. Use Add panel to open panels by hand." };
      }
      throw error;
    }
    const reply = parseComposeReply(body);
    if (reply.panels.length === 0) {
      return { ok: false, message: reply.notice ?? "Nothing matched that request. Name a county, a case type or a problem, or use Add panel." };
    }
    if (store.current().length >= WORKSPACE_PANELS_MAX) {
      return { ok: false, message: `The workspace is full (${WORKSPACE_PANELS_MAX} panels). Close a panel and ask again.` };
    }
    const how =
      reply.source === "ai"
        ? ", chosen by AI. The numbers in them are counted from the data, not written by AI"
        : reply.source === "rules"
          ? ", chosen by matching keywords in your request"
          : "";
    open(reply.panels, how, reply.notice);
    return { ok: true, message: reply.notice };
  };

  const add = (option: AddPanelOption) => {
    if (!option.draft) return;
    open([createPanel(option.draft, newPanelId(), events)], "", null);
  };

  const move = (panel: PanelSpec, delta: -1 | 1, control: PanelControl) => {
    const next = movePanel(panels, panel.id, delta);
    if (next === panels) return;
    focusRequest.current = { id: panel.id, control };
    update(() => next);
    setStatus({ text: `Moved ${panel.title} to position ${next.findIndex((p) => p.id === panel.id) + 1} of ${next.length}.`, undo: null });
  };

  const close = (panel: PanelSpec, index: number) => {
    const next = closePanel(panels, panel.id);
    const neighbor = next[index] ?? next[index - 1];
    focusRequest.current = neighbor ? { id: neighbor.id, control: "handle" } : "command";
    update(() => next);
    setMinimized((current) => {
      if (!current.has(panel.id)) return current;
      const copy = new Set(current);
      copy.delete(panel.id);
      return copy;
    });
    setStatus({ text: `Closed ${panel.title}.`, undo: { before: panels, after: next } });
  };

  const duplicate = (panel: PanelSpec) => {
    const id = newPanelId();
    const next = duplicatePanel(panels, panel.id, id);
    if (next === panels) return;
    update(() => next);
    markFresh([id]);
    setStatus({ text: `Duplicated ${panel.title}. The copy is next to it.`, undo: null });
  };

  const toggleMinimized = (id: string) => {
    setMinimized((current) => {
      const copy = new Set(current);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  const openFolder = (folder: RailFolder) => {
    const next = parsePanels(folder.panels);
    update(() => next);
    setMinimized(new Set());
    markFresh(next.map((panel) => panel.id));
    setStatus({ text: `Opened the folder ${folder.name}: ${panelsWord(next.length)}.`, undo: { before: panels, after: next } });
  };

  const onReorder = useCallback((id: string, targetId: string) => update((current) => movePanelTo(current, id, targetId)), [update]);
  const onDragEnd = useCallback((moved: boolean) => {
    if (moved) setStatus({ text: "Panel dropped in its new place.", undo: null });
  }, []);

  const renderPanel = (panel: PanelSpec, index: number, drag: DragHandle) => (
    <WorkspacePanel
      spec={panel}
      index={index}
      count={panels.length}
      records={records}
      events={events}
      offeredEvents={offered}
      todayIso={todayIso}
      viewerCounty={user.role === "clerk" ? user.county : null}
      counties={counties}
      months={months}
      minimized={minimized.has(panel.id)}
      full={full}
      drag={drag}
      onChange={(next) => update((current) => replacePanel(current, next))}
      onMove={(delta, control) => move(panel, delta, control)}
      onResize={(size: PanelSize) => update((current) => resizePanel(current, panel.id, size))}
      onMinimize={() => toggleMinimized(panel.id)}
      onDuplicate={() => duplicate(panel)}
      onClose={() => close(panel, index)}
    />
  );

  return (
    <div className={styles.layout} data-empty={empty}>
      <div className={styles.main}>
        {user.role === "clerk" && user.county ? (
          <p className={styles.scopeNote}>You see {user.county} County only. A clerk&apos;s workspace covers the filings of their own county.</p>
        ) : null}

        {store.ready ? (
          <CommandBar mode={empty ? "hero" : "docked"} examples={requests} onSubmit={compose}>
            <AddPanelMenu options={options} full={full} onAdd={add} />
          </CommandBar>
        ) : (
          <Spinner label="Loading your workspace" announce />
        )}

        <div className={styles.statusRow}>
          <p className={styles.status} role="status">
            {status ? status.text : ""}
          </p>
          {undoPanels ? (
            <Button
              size="sm"
              variant="ghost"
              icon="undo"
              onClick={() => {
                // This button leaves the page with the step it undoes, so focus goes to the command bar.
                focusRequest.current = "command";
                update(() => undoPanels);
                setStatus({ text: "Put the panels back as they were.", undo: null });
              }}
            >
              Undo
            </Button>
          ) : null}
          {/* Shown, but not read out on every save: only a failed save interrupts. */}
          <p className={styles.saveState}>{SAVE_LABELS[store.saveState]}</p>
          <p className="visually-hidden" role="status">
            {store.saveState === "local" ? SAVE_LABELS.local : ""}
          </p>
        </div>

        {store.loadError ? (
          <Alert
            tone="warning"
            title="Your saved workspace could not be loaded."
            action={<Button onClick={store.reload}>Try again</Button>}
          >
            {store.loadError} Until it loads, changes are kept in this browser only.
          </Alert>
        ) : null}

        {store.ready && !empty ? <Grid panels={panels} fresh={fresh} onReorder={onReorder} onDragEnd={onDragEnd} renderPanel={renderPanel} /> : null}
      </div>

      <FolderRail
        folders={folders}
        ready={store.ready}
        loadError={store.loadError}
        openCount={panels.length}
        onOpen={openFolder}
        onSave={store.saveFolder}
        onRename={(folder, name) => store.renameFolder(folder.id, name)}
        onDelete={(folder) => store.deleteFolder(folder.id)}
      />
    </div>
  );
}
