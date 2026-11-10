import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPanel } from "@/lib/panels";
import type { Folder, PanelSpec } from "@/lib/panels";
import { SAMPLE_EVENTS } from "@/lib/sample";
import { FolderInput } from "@/lib/schemas";
import { ApiError } from "@/components/data/apiClient";
import { CURRENT_FOLDER_NAME, cacheKey, readCache, writeCache } from "@/components/workspace/model";
import { SAVE_DELAY_MS, createWorkspaceSync } from "@/components/workspace/workspaceSync";
import type { FolderPayload, FoldersApi } from "@/components/workspace/workspaceSync";

const USER = "demo-leader";
const KPI = createPanel({ type: "kpi", params: {} }, "a", SAMPLE_EVENTS);
const RANKED = createPanel({ type: "ranked", params: { dimension: "tag" } }, "b", SAMPLE_EVENTS);
const HEAT = createPanel({ type: "heat", params: {} }, "c", SAMPLE_EVENTS);

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

/** A stand-in for the folders API that keeps folders in memory and records every call. */
function fakeServer(initial: Folder[] = []) {
  let folders = structuredClone(initial);
  let nextId = 1;
  const saves: FolderPayload[] = [];
  const failures: { list: unknown; save: unknown[]; remove: unknown } = { list: null, save: [], remove: null };
  let holdSaves: Promise<void> | null = null;
  const api: FoldersApi = {
    list: async () => {
      if (failures.list) throw failures.list;
      return structuredClone(folders);
    },
    save: async (payload) => {
      // Every body sent must be one the real route would accept.
      FolderInput.parse(payload);
      saves.push(structuredClone(payload) as FolderPayload);
      if (holdSaves) await holdSaves;
      const failure = failures.save.shift();
      if (failure) throw failure;
      const panels = structuredClone(payload.panels) as PanelSpec[];
      if (payload.id) {
        const index = folders.findIndex((folder) => folder.id === payload.id);
        if (index < 0) throw new ApiError(404, "not_found", "That folder was not found.");
        folders[index] = { id: payload.id, name: payload.name, panels };
        return structuredClone(folders[index]);
      }
      const created: Folder = { id: `srv-${nextId++}`, name: payload.name, panels };
      folders.push(created);
      return structuredClone(created);
    },
    remove: async (id) => {
      if (failures.remove) throw failures.remove;
      if (!folders.some((folder) => folder.id === id)) throw new ApiError(404, "not_found", "That folder was not found.");
      folders = folders.filter((folder) => folder.id !== id);
    },
  };
  return {
    api,
    saves,
    failures,
    folders: () => folders,
    wipe: () => {
      folders = [];
    },
    /** Makes saves wait until the returned function is called. */
    hold: () => {
      let release: () => void = () => undefined;
      holdSaves = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        holdSaves = null;
        release();
      };
    },
  };
}

const offline = () => new ApiError(0, "network", "Could not reach the server. Check the connection and try again.");
const wait = (ms = SAVE_DELAY_MS) => vi.advanceTimersByTimeAsync(ms);
const ids = (panels: readonly { id: string }[]) => panels.map((panel) => panel.id);

function setup(initial: Folder[] = [], storage = memoryStorage()) {
  const server = fakeServer(initial);
  const sync = createWorkspaceSync({ userId: USER, api: server.api, storage: () => storage });
  return { server, sync, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loading the workspace", () => {
  it("opens the panels saved under the reserved folder and keeps that folder out of the list", async () => {
    const { server, sync } = setup([
      { id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI, RANKED] },
      { id: "f1", name: "Monday review", panels: [HEAT] },
    ]);
    expect(sync.getState().ready).toBe(false);
    await sync.start();
    const state = sync.getState();
    expect(state.ready).toBe(true);
    expect(ids(state.panels)).toEqual(["a", "b"]);
    expect(state.folders.map((folder) => folder.name)).toEqual(["Monday review"]);
    expect(state.loadError).toBeNull();
    await wait(5000);
    expect(server.saves).toEqual([]);
  });

  it("starts empty when nothing has been saved, without saving an empty workspace", async () => {
    const { server, sync } = setup([]);
    await sync.start();
    expect(sync.getState().panels).toEqual([]);
    await wait(5000);
    expect(server.saves).toEqual([]);
  });

  it("ignores changes until it has loaded", async () => {
    const { server, sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    sync.update(() => [HEAT]);
    await sync.start();
    expect(ids(sync.getState().panels)).toEqual(["a"]);
    await wait(5000);
    expect(server.saves).toEqual([]);
  });

  it("drops saved panels that are no longer valid", async () => {
    const broken = { id: "old", type: "pie", title: "Old", size: "s", params: {} } as unknown as PanelSpec;
    const { sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI, broken] }]);
    await sync.start();
    expect(ids(sync.getState().panels)).toEqual(["a"]);
  });

  it("tells its subscribers, and stops telling them once they leave", async () => {
    const { sync } = setup([]);
    const listener = vi.fn();
    const leave = sync.subscribe(listener);
    await sync.start();
    expect(listener).toHaveBeenCalled();
    leave();
    listener.mockClear();
    sync.update(() => [KPI]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("saving the open panels", () => {
  it("waits, then saves once under the reserved name", async () => {
    const { server, sync, storage } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    await sync.start();
    sync.update((panels) => [...panels, RANKED]);
    expect(ids(sync.getState().panels)).toEqual(["a", "b"]);
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, RANKED], dirty: true });
    await wait(SAVE_DELAY_MS - 1);
    expect(server.saves).toEqual([]);
    await wait(1);
    expect(server.saves).toEqual([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI, RANKED] }]);
    expect(sync.getState().saveState).toBe("saved");
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, RANKED], dirty: false });
  });

  it("sends one save for a burst of changes, with the last state", async () => {
    const { server, sync } = setup([]);
    await sync.start();
    sync.update(() => [KPI]);
    await wait(300);
    sync.update((panels) => [...panels, RANKED]);
    await wait(300);
    sync.update((panels) => [...panels, HEAT]);
    await wait(SAVE_DELAY_MS);
    expect(server.saves).toHaveLength(1);
    expect(ids(server.saves[0].panels)).toEqual(["a", "b", "c"]);
  });

  it("creates the reserved folder on the first save and reuses it after", async () => {
    const { server, sync } = setup([]);
    await sync.start();
    sync.update(() => [KPI]);
    await wait();
    sync.update(() => [KPI, RANKED]);
    await wait();
    expect(server.saves.map((save) => save.id)).toEqual([undefined, "srv-1"]);
    expect(server.folders()).toHaveLength(1);
    expect(server.folders()[0]).toMatchObject({ id: "srv-1", name: CURRENT_FOLDER_NAME });
  });

  it("saves an emptied workspace as empty", async () => {
    const { server, sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    await sync.start();
    sync.update(() => []);
    await wait();
    expect(server.saves).toEqual([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [] }]);
  });

  it("does nothing for a change that changes nothing, or one that is undone before the save", async () => {
    const { server, sync, storage } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    await sync.start();
    sync.update((panels) => panels);
    sync.update(() => [KPI, RANKED]);
    await wait(200);
    sync.update(() => [KPI]);
    await wait(5000);
    expect(server.saves).toEqual([]);
    expect(readCache(storage, USER)).toEqual({ panels: [KPI], dirty: false });
  });

  it("runs saves one at a time, so a second change never creates a second reserved folder", async () => {
    const { server, sync } = setup([]);
    await sync.start();
    const release = server.hold();
    sync.update(() => [KPI]);
    await wait();
    expect(server.saves).toHaveLength(1);
    expect(sync.getState().saveState).toBe("saving");
    sync.update(() => [KPI, RANKED]);
    await wait();
    // The first save has not come back, so the second has not been sent.
    expect(server.saves).toHaveLength(1);
    release();
    await wait(0);
    expect(server.saves.map((save) => save.id)).toEqual([undefined, "srv-1"]);
    expect(server.folders()).toHaveLength(1);
    expect(ids(server.folders()[0].panels)).toEqual(["a", "b"]);
    expect(sync.getState().saveState).toBe("saved");
  });

  it("saves again when a change is undone while its save is on the way", async () => {
    const { server, sync, storage } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI, RANKED] }]);
    await sync.start();
    const before = sync.getState().panels;
    const release = server.hold();
    // Close a panel: the save of the shorter list starts and does not come back yet.
    sync.update(() => [KPI]);
    await wait();
    expect(server.saves).toHaveLength(1);
    // Undo. The server is about to hold the shorter list, so the list on screen has to be sent again.
    sync.update(() => before);
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, RANKED], dirty: true });
    await wait();
    release();
    await wait(0);
    expect(ids(sync.getState().panels)).toEqual(["a", "b"]);
    expect(server.saves.map((save) => ids(save.panels))).toEqual([["a"], ["a", "b"]]);
    expect(ids(server.folders()[0].panels)).toEqual(["a", "b"]);
    expect(sync.getState().saveState).toBe("saved");
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, RANKED], dirty: false });
  });

  it("sends nothing more for a change that returns to what the save on the way holds, and reports it saved", async () => {
    const { server, sync, storage } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    await sync.start();
    const release = server.hold();
    sync.update(() => [KPI, RANKED]);
    await wait();
    sync.update(() => [KPI, RANKED, HEAT]);
    await wait(200);
    // An equal list that is a different array, as a filter edit that is put back makes.
    sync.update(() => [KPI, RANKED]);
    // Not marked as sent until the save has landed: it can still fail.
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, RANKED], dirty: true });
    await wait(5000);
    expect(server.saves).toHaveLength(1);
    release();
    await wait(0);
    expect(server.saves).toHaveLength(1);
    expect(sync.getState().saveState).toBe("saved");
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, RANKED], dirty: false });
  });

  it("keeps the change marked as unsent when the save it was waiting on fails", async () => {
    const { server, sync, storage } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    await sync.start();
    const release = server.hold();
    server.failures.save.push(offline());
    sync.update(() => [KPI, RANKED]);
    await wait();
    sync.update(() => [KPI, RANKED, HEAT]);
    sync.update(() => [KPI, RANKED]);
    release();
    await wait(0);
    expect(sync.getState().saveState).toBe("local");
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, RANKED], dirty: true });
    // The failed save claims nothing any more: going back to what the server holds needs no save.
    sync.update(() => [KPI]);
    await wait(5000);
    expect(server.saves).toHaveLength(1);
    expect(readCache(storage, USER)).toEqual({ panels: [KPI], dirty: false });
  });

  it("saves as a new folder when the reserved one has gone from the server", async () => {
    const { server, sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    await sync.start();
    server.wipe();
    sync.update(() => [KPI, HEAT]);
    await wait();
    expect(server.saves.map((save) => save.id)).toEqual(["cur", undefined]);
    expect(server.folders()).toHaveLength(1);
    expect(sync.getState().saveState).toBe("saved");
  });

  it("keeps the change in the browser when the save fails, and sends it on the next visit", async () => {
    const storage = memoryStorage();
    const first = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }], storage);
    await first.sync.start();
    first.server.failures.save.push(offline());
    first.sync.update(() => [KPI, HEAT]);
    await wait();
    expect(first.sync.getState().saveState).toBe("local");
    expect(readCache(storage, USER)).toEqual({ panels: [KPI, HEAT], dirty: true });

    // The next visit: the server still has the old panels, the browser has the unsent change.
    const second = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }], storage);
    await second.sync.start();
    expect(ids(second.sync.getState().panels)).toEqual(["a", "c"]);
    await wait();
    expect(second.server.saves).toEqual([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI, HEAT] }]);
    expect(readCache(storage, USER)?.dirty).toBe(false);
  });

  it("trusts the server over a cache that has nothing unsent", async () => {
    const storage = memoryStorage();
    writeCache(storage, USER, { panels: [HEAT], dirty: false });
    const { server, sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }], storage);
    await sync.start();
    expect(ids(sync.getState().panels)).toEqual(["a"]);
    await wait(5000);
    expect(server.saves).toEqual([]);
  });

  it("sends a waiting change at once when the page is left", async () => {
    const { server, sync } = setup([]);
    await sync.start();
    sync.update(() => [KPI]);
    sync.stop();
    await wait(0);
    expect(server.saves).toEqual([{ name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    await wait(5000);
    expect(server.saves).toHaveLength(1);
  });

  it("works with local storage blocked", async () => {
    const server = fakeServer([]);
    const sync = createWorkspaceSync({ userId: USER, api: server.api, storage: () => null });
    await sync.start();
    sync.update(() => [KPI]);
    await wait();
    expect(server.saves).toHaveLength(1);
    expect(sync.getState().saveState).toBe("saved");
  });
});

describe("when the saved workspace cannot be loaded", () => {
  it("falls back to the browser's copy and saves nothing to the server", async () => {
    const storage = memoryStorage();
    writeCache(storage, USER, { panels: [KPI, RANKED], dirty: false });
    const { server, sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [HEAT] }], storage);
    server.failures.list = offline();
    await sync.start();
    const state = sync.getState();
    expect(state.ready).toBe(true);
    expect(ids(state.panels)).toEqual(["a", "b"]);
    expect(state.loadError).toBe("Could not reach the server. Check the connection and try again.");

    sync.update(() => [KPI]);
    await wait(5000);
    expect(server.saves).toEqual([]);
    expect(sync.getState().saveState).toBe("local");
    expect(readCache(storage, USER)).toEqual({ panels: [KPI], dirty: true });
  });

  it("starts empty when the browser has no copy either", async () => {
    const { server, sync } = setup([]);
    server.failures.list = offline();
    await sync.start();
    expect(sync.getState().panels).toEqual([]);
    expect(sync.getState().loadError).not.toBeNull();
  });

  it("sends what was changed meanwhile once a retry gets through", async () => {
    const { server, sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [HEAT] }]);
    server.failures.list = offline();
    await sync.start();
    sync.update(() => [KPI]);
    await wait();
    server.failures.list = null;
    await sync.start();
    expect(sync.getState().loadError).toBeNull();
    expect(ids(sync.getState().panels)).toEqual(["a"]);
    await wait();
    expect(server.saves).toEqual([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    expect(sync.getState().saveState).toBe("saved");
  });

  it("drops a load that comes back after the page was left", async () => {
    const { sync } = setup([{ id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI] }]);
    const loading = sync.start();
    sync.stop();
    await loading;
    expect(sync.getState().ready).toBe(false);
    await sync.start();
    expect(ids(sync.getState().panels)).toEqual(["a"]);
  });
});

describe("folders", () => {
  const saved: Folder[] = [
    { id: "cur", name: CURRENT_FOLDER_NAME, panels: [KPI, RANKED] },
    { id: "f1", name: "Monday review", panels: [HEAT] },
    { id: "f2", name: "Lake", panels: [KPI] },
  ];

  it("saves the open panels as a new folder", async () => {
    const { server, sync } = setup(saved);
    await sync.start();
    expect(await sync.saveFolder("  Small   claims ")).toBeNull();
    expect(server.saves).toEqual([{ name: "Small claims", panels: [KPI, RANKED] }]);
    expect(sync.getState().folders.map((folder) => folder.name)).toEqual(["Monday review", "Lake", "Small claims"]);
  });

  it("replaces the folder that already has the name", async () => {
    const { server, sync } = setup(saved);
    await sync.start();
    expect(await sync.saveFolder("monday REVIEW")).toBeNull();
    expect(server.saves).toEqual([{ id: "f1", name: "monday REVIEW", panels: [KPI, RANKED] }]);
    expect(sync.getState().folders).toHaveLength(2);
    expect(ids(sync.getState().folders[0].panels)).toEqual(["a", "b"]);
  });

  it("refuses a name that cannot be used, without calling the server", async () => {
    const { server, sync } = setup(saved);
    await sync.start();
    expect(await sync.saveFolder(" ")).toBe("Give the folder a name.");
    expect(await sync.saveFolder(CURRENT_FOLDER_NAME)).toBe("That name is reserved. Choose another.");
    expect(await sync.renameFolder("f1", "")).toBe("Give the folder a name.");
    expect(await sync.renameFolder("f1", "lake")).toBe("Another folder already has that name.");
    expect(await sync.renameFolder("gone", "New name")).toBe("That folder is no longer on the list.");
    expect(server.saves).toEqual([]);
  });

  it("renames a folder and keeps its panels", async () => {
    const { server, sync } = setup(saved);
    await sync.start();
    expect(await sync.renameFolder("f1", "Tuesday review")).toBeNull();
    expect(server.saves).toEqual([{ id: "f1", name: "Tuesday review", panels: [HEAT] }]);
    expect(sync.getState().folders[0]).toEqual({ id: "f1", name: "Tuesday review", panels: [HEAT] });
    // Changing only the case of a folder's own name is allowed.
    expect(await sync.renameFolder("f1", "TUESDAY REVIEW")).toBeNull();
  });

  it("deletes a folder, and treats one that is already gone as deleted", async () => {
    const { server, sync } = setup(saved);
    await sync.start();
    expect(await sync.deleteFolder("f1")).toBeNull();
    expect(sync.getState().folders.map((folder) => folder.id)).toEqual(["f2"]);
    expect(server.folders().map((folder) => folder.id)).toEqual(["cur", "f2"]);
    server.wipe();
    expect(await sync.deleteFolder("f2")).toBeNull();
    expect(sync.getState().folders).toEqual([]);
  });

  it("reports a failure in words and leaves the list as it was", async () => {
    const { server, sync } = setup(saved);
    await sync.start();
    server.failures.save.push(new ApiError(409, "conflict", "You can keep up to 50 folders. Delete one to save another."));
    expect(await sync.saveFolder("One more")).toBe("You can keep up to 50 folders. Delete one to save another.");
    server.failures.remove = offline();
    expect(await sync.deleteFolder("f1")).toBe("Could not reach the server. Check the connection and try again.");
    expect(sync.getState().folders).toHaveLength(2);
  });

  it("does not touch the open panels or their saved copy", async () => {
    const { server, sync } = setup(saved);
    await sync.start();
    await sync.saveFolder("Copy");
    await sync.deleteFolder("f2");
    await wait(5000);
    expect(ids(sync.getState().panels)).toEqual(["a", "b"]);
    expect(server.saves.filter((save) => save.name === CURRENT_FOLDER_NAME)).toEqual([]);
    expect(cacheKey(USER)).toContain(USER);
  });
});
