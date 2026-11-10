"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, errorMessage } from "@/components/data/apiClient";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { OutcomePill, Pill, TagPill } from "@/components/ui/Pill";
import { Spinner } from "@/components/ui/Spinner";
import type { FlagRecord } from "@/lib/domain";
import { formatDate } from "@/lib/time";
import styles from "./log.module.css";

const RECENT_LIMIT = 6;
// The access rule: a clerk can remove their own entry for 5 minutes. The server decides; this only
// hides the button once it would be refused.
const REMOVE_WINDOW_MS = 5 * 60 * 1000;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: FlagRecord[]; loadedAt: number; refreshError: string | null };

export interface RecentEntriesProps {
  /** Change this number to load the list again. */
  version: number;
  /** Admins can remove an entry at any time; clerks for 5 minutes. */
  canRemoveAnyTime: boolean;
  /** Removes the entry and reports the result to the person. Resolves when done. */
  onRemove: (id: string) => Promise<void>;
}

export function RecentEntries({ version, canRemoveAnyTime, onRemove }: RecentEntriesProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  // The entry whose Remove button was used. When the list no longer holds it, that button is gone, so
  // focus moves to the card instead of being left on nothing.
  const removed = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await apiFetch<FlagRecord[]>(`/api/flags/recent?limit=${RECENT_LIMIT}`);
        if (!cancelled) setState({ status: "ready", entries, loadedAt: Date.now(), refreshError: null });
      } catch (caught) {
        if (cancelled) return;
        const message = errorMessage(caught);
        // Keep the list that is already showing when a reload fails.
        setState((previous) => (previous.status === "ready" ? { ...previous, refreshError: message } : { status: "error", message }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, retry]);

  useEffect(() => {
    if (state.status !== "ready" || removed.current === null) return;
    const gone = !state.entries.some((entry) => entry.id === removed.current);
    removed.current = null;
    if (gone && (document.activeElement === document.body || cardRef.current?.contains(document.activeElement) === true)) {
      cardRef.current?.focus({ preventScroll: true });
    }
  }, [state]);

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await onRemove(id);
      removed.current = id;
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card ref={cardRef} title="Recent entries" note="yours">
      {state.status === "loading" ? <Spinner label="Loading your recent entries" announce /> : null}

      {state.status === "error" ? (
        <Alert tone="error" title="Your recent entries could not load." action={<Button onClick={() => setRetry((value) => value + 1)}>Try again</Button>}>
          {state.message}
        </Alert>
      ) : null}

      {state.status === "ready" && state.refreshError ? (
        <Alert tone="warning" title="This list may be out of date." action={<Button onClick={() => setRetry((value) => value + 1)}>Try again</Button>}>
          {state.refreshError}
        </Alert>
      ) : null}

      {state.status === "ready" && state.entries.length === 0 ? (
        <EmptyState title="No entries yet" icon="tag" compact>
          Entries you save appear here, newest first.
        </EmptyState>
      ) : null}

      {state.status === "ready" && state.entries.length > 0 ? (
        <ul className={styles.recent}>
          {state.entries.map((entry) => {
            const removable = canRemoveAnyTime || state.loadedAt - Date.parse(entry.createdAt) < REMOVE_WINDOW_MS;
            return (
              <li key={entry.id} className={styles.entry}>
                <div className={styles.entryHead}>
                  <strong>{entry.form}</strong>
                  <OutcomePill outcome={entry.outcome} />
                  {entry.source === "import" ? <Pill>Imported</Pill> : null}
                </div>
                <p className={`${styles.meta} num`}>
                  <time dateTime={entry.date}>{formatDate(entry.date)}</time> · {entry.county} · {entry.caseType}
                </p>
                <ul className={styles.tags} aria-label="Problems">
                  {entry.tags.map((tag) => (
                    <li key={tag}>
                      <TagPill tag={tag} />
                    </li>
                  ))}
                </ul>
                {entry.note ? <p className={styles.entryNote}>Note: {entry.note}</p> : null}
                {removable ? (
                  <div>
                    <Button size="sm" variant="ghost" icon="undo" loading={removing === entry.id} disabled={removing !== null && removing !== entry.id} onClick={() => void remove(entry.id)}>
                      Remove<span className="visually-hidden">: {entry.form}, {formatDate(entry.date)}</span>
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className={styles.hint}>
        Each saved entry is added to the dashboard right away. {canRemoveAnyTime ? "An administrator can remove an entry at any time." : "You can remove an entry for 5 minutes after saving it."}
      </p>
    </Card>
  );
}
