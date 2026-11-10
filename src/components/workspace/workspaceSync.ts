// Keeps one user's open panels and saved folders in step with the folders API. No React in here, so the
// rules can be tested with a fake API and fake timers:
//
// - The record is the server. The open panels are saved there under the reserved folder name "__current",
//   a moment after the last change, one save at a time.
// - Local storage is a fallback only. It holds a copy for when the server cannot be reached, and a
//   change that had not reached the server when the page closed ("dirty"), which is sent on the next visit.
// - After a failed load nothing is saved to the server: that could overwrite a workspace this page never saw.

import type { Folder, PanelSpec } from "@/lib/panels";
import { ApiError, errorMessage } from "@/components/data/apiClient";
import { CURRENT_FOLDER_NAME, findFolderByName, folderNameError, parsePanels, readCache, samePanels, splitFolders, writeCache } from "./model";

/** How long the workspace waits after the last change before saving it. */
export const SAVE_DELAY_MS = 800;

/** "local" means the latest change is kept in this browser only: the server could not be reached. */
export type SaveState = "idle" | "saving" | "saved" | "local";

export interface FolderPayload {
  id?: string;
  name: string;
  panels: readonly PanelSpec[];
}

/** The three calls the workspace makes. The real one talks to /api/folders. */
export interface FoldersApi {
  list: () => Promise<Folder[]>;
  save: (folder: FolderPayload) => Promise<Folder>;
  remove: (id: string) => Promise<void>;
}

export interface SyncState {
  /** False until the saved workspace has been asked for. */
  ready: boolean;
  panels: readonly PanelSpec[];
  /** The user's saved folders, without the reserved one that holds the open panels. */
  folders: readonly Folder[];
  saveState: SaveState;
  /** Set when the saved workspace could not be loaded. */
  loadError: string | null;
}

export interface WorkspaceSync {
  getState: () => SyncState;
  subscribe: (listener: () => void) => () => void;
  /** Loads the saved workspace. Call again after `stop`, or to retry a failed load. */
  start: () => Promise<void>;
  /** Sends a change that is still waiting, and ignores a load that has not come back. */
  stop: () => void;
  /** Changes the open panels. The change is saved a moment later. Ignored until the workspace is ready. */
  update: (change: (panels: readonly PanelSpec[]) => readonly PanelSpec[]) => void;
  /** Each returns null on success, or a sentence saying what went wrong. */
  saveFolder: (name: string) => Promise<string | null>;
  renameFolder: (id: string, name: string) => Promise<string | null>;
  deleteFolder: (id: string) => Promise<string | null>;
}

export const INITIAL_SYNC_STATE: SyncState = { ready: false, panels: [], folders: [], saveState: "idle", loadError: null };

interface SyncOptions {
  userId: string;
  api: FoldersApi;
  /** Returns the browser's local storage, or null where it is switched off or blocked. */
  storage: () => Pick<Storage, "getItem" | "setItem"> | null;
  delayMs?: number;
}

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();
const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

export function createWorkspaceSync({ userId, api, storage, delayMs = SAVE_DELAY_MS }: SyncOptions): WorkspaceSync {
  let state = INITIAL_SYNC_STATE;
  const listeners = new Set<() => void>();
  /** Id of the user's "__current" folder once it exists on the server. */
  let currentId: string | null = null;
  /** The panels the server is known to hold. Null when that is not known. */
  let synced: readonly PanelSpec[] | null = null;
  /** The panels the newest save that is queued or on its way will leave on the server. Null when none is. */
  let pending: readonly PanelSpec[] | null = null;
  let canSync = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Saves run one at a time, in order. */
  let queue: Promise<void> = Promise.resolve();
  /** Goes up on every start and stop, so a load from before is recognized and dropped. */
  let generation = 0;

  const set = (patch: Partial<SyncState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const send = (panels: readonly PanelSpec[]) => {
    if (!canSync) {
      set({ saveState: "local" });
      return;
    }
    set({ saveState: "saving" });
    pending = panels;
    queue = queue.then(async () => {
      const post = (id: string | null) => api.save({ ...(id ? { id } : {}), name: CURRENT_FOLDER_NAME, panels });
      try {
        let saved: Folder;
        try {
          saved = await post(currentId);
        } catch (error) {
          // The folder is gone (the demo data was reset, for one). Save it as a new one.
          if (!(currentId && isNotFound(error))) throw error;
          currentId = null;
          saved = await post(null);
        }
        currentId = saved.id;
        synced = panels;
        // Otherwise a newer change is waiting its turn; it will report when it is saved.
        if (timer === null && samePanels(state.panels, panels)) {
          writeCache(storage(), userId, { panels: state.panels, dirty: false });
          set({ saveState: "saved" });
        }
      } catch {
        set({ saveState: "local" });
      } finally {
        // Settled either way. A newer save that is queued behind this one keeps its own claim.
        if (pending === panels) pending = null;
      }
    });
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const panels = state.panels;
    if (pending !== null && samePanels(pending, panels)) {
      // Back to what the save on its way will leave: nothing more to send. The copy in this browser stays
      // marked as unsent until that save lands, because it can still fail.
      writeCache(storage(), userId, { panels, dirty: true });
      return;
    }
    if (pending === null && synced !== null && samePanels(synced, panels)) {
      // Back to what the server holds: nothing to send.
      writeCache(storage(), userId, { panels, dirty: false });
      return;
    }
    writeCache(storage(), userId, { panels, dirty: true });
    timer = setTimeout(() => {
      timer = null;
      send(panels);
    }, delayMs);
  };

  const start = async () => {
    generation += 1;
    const mine = generation;
    const cached = readCache(storage(), userId);
    try {
      const all = await api.list();
      if (mine !== generation) return;
      const { current, saved } = splitFolders(all);
      const serverPanels = parsePanels(current?.panels ?? []);
      // A change that never reached the server is newer than what the server holds.
      const unsent = cached !== null && cached.dirty;
      currentId = current?.id ?? null;
      synced = serverPanels;
      canSync = true;
      set({ ready: true, panels: unsent ? cached.panels : serverPanels, folders: saved, loadError: null });
      if (unsent) schedule();
    } catch (error) {
      if (mine !== generation) return;
      canSync = false;
      synced = null;
      set({ ready: true, panels: cached?.panels ?? [], folders: [], saveState: cached?.dirty ? "local" : state.saveState, loadError: errorMessage(error) });
    }
  };

  const stop = () => {
    generation += 1;
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    send(state.panels);
  };

  const update = (change: (panels: readonly PanelSpec[]) => readonly PanelSpec[]) => {
    if (!state.ready) return;
    const next = change(state.panels);
    if (next === state.panels) return;
    set({ panels: next });
    schedule();
  };

  const saveFolder = async (name: string): Promise<string | null> => {
    const problem = folderNameError(name);
    if (problem) return problem;
    const existing = findFolderByName(state.folders, name);
    try {
      const saved = await api.save({ ...(existing ? { id: existing.id } : {}), name: cleanName(name), panels: state.panels });
      set({ folders: existing ? state.folders.map((folder) => (folder.id === saved.id ? saved : folder)) : [...state.folders, saved] });
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  };

  const renameFolder = async (id: string, name: string): Promise<string | null> => {
    const problem = folderNameError(name);
    if (problem) return problem;
    const folder = state.folders.find((f) => f.id === id);
    if (!folder) return "That folder is no longer on the list.";
    const taken = findFolderByName(state.folders, name);
    if (taken && taken.id !== id) return "Another folder already has that name.";
    try {
      const saved = await api.save({ id, name: cleanName(name), panels: folder.panels });
      set({ folders: state.folders.map((f) => (f.id === id ? saved : f)) });
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  };

  const deleteFolder = async (id: string): Promise<string | null> => {
    try {
      await api.remove(id);
    } catch (error) {
      // Already gone is the result that was asked for.
      if (!isNotFound(error)) return errorMessage(error);
    }
    set({ folders: state.folders.filter((folder) => folder.id !== id) });
    return null;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    update,
    saveFolder,
    renameFolder,
    deleteFolder,
  };
}
