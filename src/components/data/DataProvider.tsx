// The client-side data context. Mounted once in the root layout, so every page shares one copy.
//
// It loads GET /api/me, /api/flags and /api/events, loads them again every 30 seconds while the tab is
// visible, and again whenever a page calls refresh() after it changed something. Panels compute their
// numbers from `records` and `events` with computePanel, so they update without asking the server.
//
//   const data = useData();
//   data.status      "loading" | "ready" | "error" | "signed-out"
//   data.loading     true until the first load has finished (ready or error)
//   data.error       null, or a sentence to show. With status "ready" it means the last refresh failed
//                    and the data on screen is the last good copy.
//   data.records     LeanFlag[]: every flag this user may see. [] until loaded. The array keeps its
//                    identity when a reload brings back the same data, so memoized panels do not recompute.
//   data.events      ChangeEvent[]. [] until loaded. Same identity rule.
//   data.user        SessionUser | null (null until loaded, and when signed out)
//   data.mode        "demo" | "supabase" | null
//   data.ai          true when the server has AI features switched on
//   data.todayIso    the app's today, "YYYY-MM-DD", from the server ("" until loaded). Pass it to
//                    computePanel; never use the browser's clock for "today".
//   data.refresh()   reloads everything; resolves when done. Call it after every successful mutation.
//                    The load it resolves with always began after the call, so it holds the change: when
//                    a background load is already running, one more is run after it (see loadQueue.ts).
//   data.refreshing  true while a reload started by refresh() or the timer is running
//   data.signOut()   ends the session and loads /login (a full page load, so nothing stays in memory).
//                    Rejects, and stays on the page, when the server could not end the session.
//
//   <DataGate>...</DataGate>
//     Renders its children only when status is "ready". Before that it shows a loading line, and on a
//     failed first load an error with a "Try again" button. Inside it, useLoadedData() returns the same
//     values with `user` and `todayIso` guaranteed to be set:
//
//   const { records, events, user, todayIso, mode, ai, refresh } = useLoadedData();
//
// On the sign-in pages nothing is loaded. A 401 anywhere else means the session ended: the provider sends the
// browser to /login?next=<current page>.

"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { MeResponse, OkResponse } from "@/lib/api";
import type { AppMode, ChangeEvent, LeanFlag, SessionUser } from "@/lib/domain";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { isSignInPath } from "@/components/shell/nav";
import { ApiError, apiFetch, errorMessage } from "./apiClient";
import { createLoadQueue } from "./loadQueue";
import type { LoadQueue } from "./loadQueue";

export type DataStatus = "loading" | "ready" | "error" | "signed-out";

export interface DataContextValue {
  status: DataStatus;
  loading: boolean;
  error: string | null;
  records: LeanFlag[];
  events: ChangeEvent[];
  user: SessionUser | null;
  mode: AppMode | null;
  ai: boolean;
  todayIso: string;
  refresh: () => Promise<void>;
  refreshing: boolean;
  signOut: () => Promise<void>;
}

export interface LoadedData extends DataContextValue {
  status: "ready";
  user: SessionUser;
  mode: AppMode;
}

/** How often the data is reloaded while the tab is visible. */
export const REFRESH_INTERVAL_MS = 30_000;

/** How long one load may take. A request that never answers would otherwise block every later load without an error. */
export const LOAD_TIMEOUT_MS = 20_000;

/** In Supabase mode the sign-out route belongs to the auth routes; in demo mode it is the demo one. */
const SIGN_OUT_PATH: Record<AppMode, string> = { demo: "/api/demo/logout", supabase: "/api/auth/sign-out" };

interface State {
  status: DataStatus;
  error: string | null;
  records: LeanFlag[];
  events: ChangeEvent[];
  me: MeResponse | null;
}

const INITIAL: State = { status: "loading", error: null, records: [], events: [], me: null };

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used inside DataProvider.");
  return value;
}

/** The loaded data. Only call this under <DataGate>, which renders its children once the data is ready. */
export function useLoadedData(): LoadedData {
  const value = useData();
  if (value.status !== "ready" || !value.user || !value.mode) {
    throw new Error("useLoadedData must be used inside DataGate.");
  }
  return value as LoadedData;
}

/** True when both lists hold the same rows in the same order. Rows are flat apart from `tags`. */
function sameRows<T extends { id: string }>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => row === b[index] || JSON.stringify(row) === JSON.stringify(b[index]));
}

export function DataProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onLogin = isSignInPath(pathname);
  const [state, setState] = useState<State>(INITIAL);
  const [refreshing, setRefreshing] = useState(false);
  const lastLoadedAt = useRef(0);

  // One load. It never rejects: a failure goes into the state.
  const run = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const signal = AbortSignal.timeout(LOAD_TIMEOUT_MS);
      const [me, records, events] = await Promise.all([
        apiFetch<MeResponse>("/api/me", { signal }),
        apiFetch<LeanFlag[]>("/api/flags", { signal }),
        apiFetch<ChangeEvent[]>("/api/events", { signal }),
      ]);
      lastLoadedAt.current = Date.now();
      setState((previous) => ({
        status: "ready",
        error: null,
        me,
        records: sameRows(previous.records, records) ? previous.records : records,
        events: sameRows(previous.events, events) ? previous.events : events,
      }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ ...INITIAL, status: "signed-out" });
        // The session ended. A full navigation also clears anything still in memory.
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
        return;
      }
      const message = errorMessage(error);
      // Keep showing the last good data when a later reload fails.
      setState((previous) => (previous.me ? { ...previous, error: message } : { ...previous, status: "error", error: message }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // One load at a time. The timer joins a load that is already running; refresh() never does, because
  // that load may have read the server before the change that refresh() was called for.
  const queueRef = useRef<LoadQueue | null>(null);
  const queue = useCallback((): LoadQueue => (queueRef.current ??= createLoadQueue(run)), [run]);
  const load = useCallback(() => queue().join(), [queue]);
  const refresh = useCallback(() => queue().fresh(), [queue]);

  // First load, and a load whenever the person arrives from /login.
  useEffect(() => {
    if (onLogin) return;
    void load();
  }, [onLogin, load]);

  // Reload every 30 seconds while the tab is visible, and when the tab becomes visible after a while.
  useEffect(() => {
    if (onLogin) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoadedAt.current >= REFRESH_INTERVAL_MS) void load();
    };
    const timer = window.setInterval(tick, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onLogin, load]);

  const mode = state.me?.mode ?? null;
  const signOut = useCallback(async () => {
    try {
      await apiFetch<OkResponse>(SIGN_OUT_PATH[mode ?? "demo"], { method: "POST" });
    } catch (error) {
      // 401: the session had already ended, which is what was asked for. Anything else means the server
      // did not end the session and its cookie is still in the browser. Going to the sign-in page then
      // would look like being signed out while the next person at this computer could walk straight
      // back in, so the caller is told and the person stays where they are.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    // A full page load on purpose: a client-side navigation would keep the signed-out account's data in
    // memory and in the router cache.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, [mode]);

  const value = useMemo<DataContextValue>(
    () => ({
      status: state.status,
      loading: state.status === "loading",
      error: state.error,
      records: state.records,
      events: state.events,
      user: state.me?.user ?? null,
      mode,
      ai: state.me?.ai ?? false,
      todayIso: state.me?.today ?? "",
      refresh,
      refreshing,
      signOut,
    }),
    [state, mode, refresh, refreshing, signOut],
  );

  return <DataContext value={value}>{children}</DataContext>;
}

export interface DataGateProps {
  children: ReactNode;
  /** Shown while the first load runs. Default: a "Loading the tracker" line. */
  fallback?: ReactNode;
}

/** Renders children once the data is loaded; until then a loading line, or the error with a retry. */
export function DataGate({ children, fallback }: DataGateProps) {
  const { status, error, refresh, refreshing } = useData();
  if (status === "ready") {
    return (
      <>
        {error ? (
          <Alert tone="warning" title="Could not refresh the data." live>
            {error} What you see is the last copy that loaded.
          </Alert>
        ) : null}
        {children}
      </>
    );
  }
  if (status === "error") {
    return (
      <Alert
        tone="error"
        title="The tracker could not load."
        live
        action={
          <Button loading={refreshing} onClick={() => void refresh()}>
            Try again
          </Button>
        }
      >
        {error}
      </Alert>
    );
  }
  return <>{fallback ?? <Spinner label="Loading the tracker" announce />}</>;
}
