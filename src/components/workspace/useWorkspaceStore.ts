"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Folder, PanelSpec } from "@/lib/panels";
import { apiFetch } from "@/components/data/apiClient";
import { INITIAL_SYNC_STATE, createWorkspaceSync } from "./workspaceSync";
import type { FoldersApi, SyncState } from "./workspaceSync";

export type { SaveState } from "./workspaceSync";

export interface WorkspaceStore extends SyncState {
  /** Changes the open panels. The change is saved a moment later. */
  update: (change: (panels: readonly PanelSpec[]) => readonly PanelSpec[]) => void;
  /** The open panels right now, including a change made a moment ago that has not been drawn yet. */
  current: () => readonly PanelSpec[];
  /** Asks the server again after a failed load. */
  reload: () => void;
  /** Each returns null on success, or a sentence saying what went wrong. */
  saveFolder: (name: string) => Promise<string | null>;
  renameFolder: (id: string, name: string) => Promise<string | null>;
  deleteFolder: (id: string) => Promise<string | null>;
}

const FOLDERS_API: FoldersApi = {
  list: () => apiFetch<Folder[]>("/api/folders"),
  save: (folder) => apiFetch<Folder>("/api/folders", { method: "POST", body: folder }),
  remove: async (id) => {
    await apiFetch<unknown>(`/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

/** The browser's local storage, or null where it is switched off or blocked. */
function browserStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const serverSnapshot = () => INITIAL_SYNC_STATE;

/** The open panels and the saved folders of one user, kept in step with the folders API (see workspaceSync.ts). */
export function useWorkspaceStore(userId: string): WorkspaceStore {
  const sync = useMemo(() => createWorkspaceSync({ userId, api: FOLDERS_API, storage: browserStore }), [userId]);
  const state = useSyncExternalStore(sync.subscribe, sync.getState, serverSnapshot);

  useEffect(() => {
    void sync.start();
    return () => sync.stop();
  }, [sync]);

  const current = useCallback(() => sync.getState().panels, [sync]);
  const reload = useCallback(() => void sync.start(), [sync]);

  return useMemo(
    () => ({ ...state, update: sync.update, current, reload, saveFolder: sync.saveFolder, renameFolder: sync.renameFolder, deleteFolder: sync.deleteFolder }),
    [state, sync, current, reload],
  );
}
