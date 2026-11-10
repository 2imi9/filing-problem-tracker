"use client";

import { useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/components/data/apiClient";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import type { AuditAction, AuditEntry } from "@/lib/domain";
import styles from "./admin.module.css";

const AUDIT_LIMIT = 100;

// Plain words for the actions this screen knows. An action added later shows under its own code.
const ACTION_LABELS: Partial<Record<AuditAction, string>> = {
  "flag.create": "Tagged a filing",
  "flag.delete": "Removed an entry",
  "flag.restore": "Put an entry back",
  "import.commit": "Imported rows",
  "event.save": "Saved a change",
  "event.delete": "Deleted a change",
  "folder.save": "Saved a folder",
  "folder.delete": "Deleted a folder",
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "demo.login": "Signed in (demo)",
  "demo.logout": "Signed out (demo)",
  "demo.reset": "Reset the demo data",
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: AuditEntry[]; refreshError: string | null };

const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" });

/** "2026-10-30T14:05:09.000Z" in the reader's own time zone. Falls back to the raw text if it is not a date. */
function formatTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : timeFormat.format(time);
}

/** Who did what, newest first. Details hold counts and reference values only, never note text. */
export function AuditLog({ version }: { version: number }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await apiFetch<AuditEntry[]>(`/api/audit?limit=${AUDIT_LIMIT}`);
        if (!cancelled) setState({ status: "ready", entries, refreshError: null });
      } catch (caught) {
        if (cancelled) return;
        const message = errorMessage(caught);
        setState((previous) => (previous.status === "ready" ? { ...previous, refreshError: message } : { status: "error", message }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, reload]);

  const refresh = () => {
    setLoading(true);
    setReload((value) => value + 1);
  };

  return (
    <Card
      title="Audit log"
      note={`newest first, up to ${AUDIT_LIMIT} entries`}
      actions={
        <Button size="sm" loading={loading} onClick={refresh}>
          Refresh
        </Button>
      }
    >
      <p className={styles.lead}>Every change to the data is recorded here with who made it. Notes and imported reasons are never copied into this log.</p>

      {state.status === "loading" ? <Spinner label="Loading the audit log" announce /> : null}

      {state.status === "error" ? (
        <Alert tone="error" title="The audit log could not load." action={<Button onClick={refresh}>Try again</Button>}>
          {state.message}
        </Alert>
      ) : null}

      {state.status === "ready" && state.refreshError ? (
        <Alert tone="warning" title="This log may be out of date.">
          {state.refreshError}
        </Alert>
      ) : null}

      {state.status === "ready" && state.entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" icon="table" compact>
          The first change anyone makes will appear here.
        </EmptyState>
      ) : null}

      {state.status === "ready" && state.entries.length > 0 ? (
        <div className={`table-scroll ${styles.auditScroll}`} tabIndex={0} role="region" aria-label="Audit log entries">
          <table className={`data-table ${styles.auditTable}`}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Role</th>
                <th scope="col">What</th>
                <th scope="col">On</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((entry) => {
                const details = Object.entries(entry.detail);
                return (
                  <tr key={entry.id}>
                    <td className={styles.when}>
                      <time dateTime={entry.at} className="code">
                        {formatTime(entry.at)}
                      </time>
                    </td>
                    <td className="code">{entry.userId}</td>
                    <td>{entry.role}</td>
                    <td className={styles.when}>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td>
                      <span className="code">{entry.entity}</span>
                      {entry.entityId ? (
                        <>
                          {" "}
                          <span className={styles.entityId}>{entry.entityId}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {details.length === 0 ? (
                        <span className="muted">None</span>
                      ) : (
                        <ul className={styles.details}>
                          {details.map(([key, value]) => (
                            <li key={key}>
                              {key}: <span className="num">{value === null ? "none" : String(value)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
