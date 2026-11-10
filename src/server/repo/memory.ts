import "server-only";
import { randomUUID } from "node:crypto";
import { NEEDS_REVIEW, toLean } from "@/lib/domain";
import type { AuditEntry, ChangeEvent, County, FlagRecord, SessionUser } from "@/lib/domain";
import { MAX_CSV_ROWS } from "@/lib/csv";
import { CURRENT_FOLDER_NAME, exampleFoldersFor } from "@/lib/panels";
import type { Folder } from "@/lib/panels";
import { describePersonalData, findPersonalData } from "@/lib/pii";
import { SAMPLE_EVENTS, makeSampleRecords } from "@/lib/sample";
import { FolderInput, parseChangeEventInput, parseImportRow, parseNewFlagInput } from "@/lib/schemas";
import { todayIso } from "@/lib/time";
import { LIMITS } from "../config";
import { HttpError } from "../http";
import type { Repository } from "./types";

// The demo repository. Data lives in this process and starts from the sample data. It enforces the same
// access rules as the SQL policies, in code, so demo mode and the tests exercise authorization.

interface StoredFlag extends FlagRecord {
  deletedAt: string | null;
  /** Who removed the entry. Null while it is not removed. */
  deletedBy: string | null;
}

interface ImportBatch {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  rows: number;
}

export interface MemoryStore {
  flags: StoredFlag[];
  events: ChangeEvent[];
  /** Folders by owner. A user with no entry has not opened the workspace yet. */
  folders: Map<string, Folder[]>;
  batches: ImportBatch[];
  audit: AuditEntry[];
}

const AUDIT_KEEP = 5_000;

/** A fresh store holding the sample data. */
export function createMemoryStore(): MemoryStore {
  return {
    flags: makeSampleRecords().map((record) => ({ ...record, deletedAt: null, deletedBy: null })),
    events: SAMPLE_EVENTS.map((event) => ({ ...event })),
    folders: new Map(),
    batches: [],
    audit: [],
  };
}

// One store per process, kept across module reloads in development.
const GLOBAL_KEY = Symbol.for("fpt.memoryStore");
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: MemoryStore };

function globalStore(): MemoryStore {
  const g = globalThis as GlobalWithStore;
  g[GLOBAL_KEY] ??= createMemoryStore();
  return g[GLOBAL_KEY];
}

/** Puts the demo data back to the sample data. Every flag, event, folder, batch and audit entry added since is dropped. */
export function resetMemoryStore(): void {
  (globalThis as GlobalWithStore)[GLOBAL_KEY] = createMemoryStore();
}

export interface MemoryRepositoryOptions {
  /** Defaults to the process-wide store. */
  store?: MemoryStore;
  /** The clock for timestamps and the delete window. Defaults to the system clock. */
  now?: () => Date;
}

const forbidden = (message: string) => new HttpError(403, message);
const notFound = (what: string) => new HttpError(404, `${what} was not found.`);

/** The record as callers see it: a copy, without the store's own bookkeeping. */
function toRecord(flag: StoredFlag): FlagRecord {
  return { ...toLean(flag), note: flag.note, reason: flag.reason };
}

export function createMemoryRepository(session: SessionUser, options: MemoryRepositoryOptions = {}): Repository {
  const store = options.store ?? globalStore();
  const now = options.now ?? (() => new Date());
  // The memory repository only ever serves demo mode, where today is the sample data's fixed today.
  const today = () => todayIso("demo", now());
  const isAdmin = session.role === "admin";

  /** The county a clerk works in. A clerk without one cannot read or write anything. */
  function clerkCounty(): County {
    if (!session.county) throw forbidden("Your account has no county assigned.");
    return session.county;
  }

  function canRead(flag: StoredFlag): boolean {
    return session.role === "clerk" ? flag.county === clerkCounty() : true;
  }

  /** Create and import: clerks for their own county, admins for any, leaders never. */
  function assertCanWrite(counties: readonly County[]): void {
    if (session.role === "leader") throw forbidden("Court leaders can view the tracker but cannot add filings.");
    if (session.role === "clerk") {
      const own = clerkCounty();
      const other = counties.find((county) => county !== own);
      if (other) throw forbidden(`You can add filings for ${own} County only. This request names ${other} County.`);
    }
  }

  function assertAdmin(): void {
    if (!isAdmin) throw forbidden("Only an administrator can do this.");
  }

  function findFlag(id: string): StoredFlag {
    const flag = store.flags.find((f) => f.id === id);
    if (!flag) throw notFound("That entry");
    return flag;
  }

  /** Delete and restore: an admin any entry; a clerk only an entry they made. */
  function assertOwnsOrAdmin(flag: StoredFlag): void {
    if (isAdmin) return;
    if (session.role !== "clerk" || flag.createdBy !== session.id) {
      throw forbidden("You can only remove or restore entries you added yourself.");
    }
  }

  function withinWindow(sinceIso: string): boolean {
    return now().getTime() - new Date(sinceIso).getTime() <= LIMITS.softDeleteWindowMs;
  }

  function myFolders(): Folder[] {
    let folders = store.folders.get(session.id);
    if (!folders) {
      folders = structuredClone(exampleFoldersFor(session));
      store.folders.set(session.id, folders);
    }
    return folders;
  }

  const demoFull = () => new HttpError(409, "The demo is full. Reset the demo data to add more.");

  /** The store lives in this process's memory, so it has a ceiling: without one, anyone could grow it until the server fails. */
  function assertRoomFor(count: number): void {
    if (store.flags.length + count > LIMITS.demoMaxFlags) throw demoFull();
  }

  function assertNoPersonalData(text: string | null | undefined): void {
    if (!text) return;
    const findings = findPersonalData(text);
    if (findings.length > 0) {
      throw new HttpError(422, describePersonalData(findings), { code: "personal_data", details: { findings } });
    }
  }

  return {
    async listFlags() {
      return store.flags.filter((f) => f.deletedAt === null && canRead(f)).map(toLean);
    },

    async listMyRecent(limit) {
      // Newest first. The store is in insertion order, so walking it backwards also orders entries that
      // share a timestamp.
      return store.flags
        .filter((f) => f.deletedAt === null && f.createdBy === session.id)
        .reverse()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(0, limit))
        .map(toRecord);
    },

    async listNeedsReview() {
      if (session.role === "leader") throw forbidden("Court leaders cannot read the raw rejection reasons.");
      return store.flags
        .filter((f) => f.deletedAt === null && f.source === "import" && f.tags.includes(NEEDS_REVIEW) && canRead(f))
        .map(toRecord);
    },

    async createFlag(input) {
      const data = parseNewFlagInput(input, today());
      assertCanWrite([data.county]);
      assertNoPersonalData(data.note);
      const flag: StoredFlag = {
        id: randomUUID(),
        date: data.date,
        county: data.county,
        caseType: data.caseType,
        form: data.form,
        tags: [...data.tags],
        outcome: data.outcome,
        source: "clerk",
        batchId: null,
        createdBy: session.id,
        createdAt: now().toISOString(),
        note: data.note ?? null,
        reason: null,
        deletedAt: null,
        deletedBy: null,
      };
      assertRoomFor(1);
      store.flags.push(flag);
      return toRecord(flag);
    },

    async createFlags(rows, batchName) {
      if (rows.length === 0) throw new HttpError(400, "There are no rows to add.");
      if (rows.length > MAX_CSV_ROWS) throw new HttpError(413, `At most ${MAX_CSV_ROWS.toLocaleString("en-US")} rows can be added at once.`);
      const day = today();
      const data = rows.map((row) => parseImportRow(row, day));
      assertCanWrite(data.map((row) => row.county));
      for (const row of data) assertNoPersonalData(row.reason);
      assertNoPersonalData(batchName);
      assertRoomFor(data.length);
      if (store.batches.length >= LIMITS.demoMaxBatches) throw demoFull();

      const batchId = randomUUID();
      const createdAt = now().toISOString();
      store.batches.push({ id: batchId, name: batchName, createdBy: session.id, createdAt, rows: data.length });
      for (const row of data) {
        store.flags.push({
          id: randomUUID(),
          date: row.date,
          county: row.county,
          caseType: row.caseType,
          form: row.form,
          tags: [...row.tags],
          outcome: "Rejected",
          source: "import",
          batchId,
          createdBy: session.id,
          createdAt,
          note: null,
          reason: row.reason || null,
          deletedAt: null,
          deletedBy: null,
        });
      }
      return { batchId, inserted: data.length };
    },

    async softDeleteFlag(id) {
      const flag = findFlag(id);
      assertOwnsOrAdmin(flag);
      if (flag.deletedAt !== null) return;
      if (!isAdmin && !withinWindow(flag.createdAt)) {
        throw forbidden("Entries can be removed for 5 minutes after they are added. Ask an administrator to remove this one.");
      }
      flag.deletedAt = now().toISOString();
      flag.deletedBy = session.id;
    },

    async restoreFlag(id) {
      const flag = findFlag(id);
      assertOwnsOrAdmin(flag);
      if (flag.deletedAt === null) return;
      if (!isAdmin && !withinWindow(flag.deletedAt)) {
        throw forbidden("An entry can be restored for 5 minutes after it is removed. Ask an administrator to restore this one.");
      }
      // A clerk takes back their own removal only. Putting back what an administrator removed is not theirs to do.
      if (!isAdmin && flag.deletedBy !== session.id) {
        throw forbidden("This entry was removed by someone else. Ask an administrator to restore it.");
      }
      flag.deletedAt = null;
      flag.deletedBy = null;
    },

    async listEvents() {
      return store.events.map((event) => ({ ...event }));
    },

    async upsertEvent(input) {
      assertAdmin();
      const data = parseChangeEventInput(input, today());
      const event: ChangeEvent = {
        id: data.id ?? randomUUID(),
        name: data.name,
        date: data.date,
        county: data.county,
        caseType: data.caseType,
        tag: data.tag,
        description: data.description,
      };
      if (data.id) {
        const index = store.events.findIndex((e) => e.id === data.id);
        if (index < 0) throw notFound("That change");
        store.events[index] = event;
      } else {
        store.events.push(event);
      }
      return { ...event };
    },

    async deleteEvent(id) {
      assertAdmin();
      const index = store.events.findIndex((e) => e.id === id);
      if (index < 0) throw notFound("That change");
      store.events.splice(index, 1);
    },

    async listFolders() {
      return structuredClone(myFolders());
    },

    async saveFolder(input) {
      const data = FolderInput.parse(input);
      const folders = myFolders();
      // The folder that holds the open panels is one per person. Saved without an id (two tabs that both
      // loaded before it existed), it replaces the one already there, so a second can never appear.
      const current = data.name === CURRENT_FOLDER_NAME ? folders.find((f) => f.name === CURRENT_FOLDER_NAME) : undefined;
      if (current && data.id && data.id !== current.id) throw new HttpError(409, "That name is reserved. Choose another.");
      const id = data.id ?? current?.id;
      const folder: Folder = { id: id ?? randomUUID(), name: data.name, panels: data.panels };
      if (id) {
        // Another user's folder with the same id is invisible here, so it reads as not found.
        const index = folders.findIndex((f) => f.id === id);
        if (index < 0) throw notFound("That folder");
        folders[index] = folder;
      } else {
        if (folders.length >= LIMITS.foldersPerUser) {
          throw new HttpError(409, `You can keep up to ${LIMITS.foldersPerUser} folders. Delete one to save another.`);
        }
        folders.push(folder);
      }
      return structuredClone(folder);
    },

    async deleteFolder(id) {
      const folders = myFolders();
      const index = folders.findIndex((f) => f.id === id);
      if (index < 0) throw notFound("That folder");
      folders.splice(index, 1);
    },

    async appendAudit(entry) {
      if (entry.userId !== session.id || entry.role !== session.role) {
        throw forbidden("An audit entry can only be written for the signed-in user.");
      }
      store.audit.push({ ...entry, detail: { ...entry.detail } });
      if (store.audit.length > AUDIT_KEEP) store.audit.splice(0, store.audit.length - AUDIT_KEEP);
    },

    async listAudit(limit) {
      assertAdmin();
      if (limit <= 0) return [];
      return store.audit
        .slice(-limit)
        .reverse()
        .map((entry) => ({ ...entry, detail: { ...entry.detail } }));
    },
  };
}
