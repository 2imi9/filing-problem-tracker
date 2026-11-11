"use client";

import { useEffect, useState } from "react";
import { apiFetch, errorMessage } from "@/components/data/apiClient";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import type { FlagRecord } from "@/lib/domain";
import styles from "./import.module.css";

const ROWS_SHOWN = 200;

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: FlagRecord[] };

/** Imported rows no rule (or the AI) could sort, with the reason as typed. Clerks see their own county. */
export function NeedsReviewList({ version }: { version: number }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await apiFetch<FlagRecord[]>("/api/flags/needs-review");
        if (!cancelled) setState({ status: "ready", rows });
      } catch (caught) {
        if (!cancelled) setState({ status: "error", message: errorMessage(caught) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, retry]);

  const total = state.status === "ready" ? state.rows.length : 0;
  const shown = state.status === "ready" ? state.rows.slice(0, ROWS_SHOWN) : [];

  return (
    <Card title="Needs review" note={state.status === "ready" ? `${total.toLocaleString("en-US")} imported ${total === 1 ? "row" : "rows"}` : undefined}>
      <p className="hint">Imported rows that could not be sorted into a problem. They are counted on the dashboard under Needs review.</p>

      {state.status === "loading" ? <Spinner label="Loading rows that need review" announce /> : null}

      {state.status === "error" ? (
        <Alert tone="error" title="The list could not load." action={<Button onClick={() => setRetry((value) => value + 1)}>Try again</Button>}>
          {state.message}
        </Alert>
      ) : null}

      {state.status === "ready" && total === 0 ? (
        <EmptyState title="Nothing is waiting for review" compact>
          Every imported row has been sorted into at least one problem.
        </EmptyState>
      ) : null}

      {state.status === "ready" && total > 0 ? (
        <>
          <div className={`table-scroll ${styles.tallScroll}`} tabIndex={0} role="region" aria-label="Imported rows that need review">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">County</th>
                  <th scope="col">Case type</th>
                  <th scope="col">Form</th>
                  <th scope="col">Clerk&apos;s reason (as typed)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td className="code">{row.date}</td>
                    <td className={styles.shortCell}>{row.county}</td>
                    <td className={styles.shortCell}>{row.caseType}</td>
                    <td className={styles.formCell}>{row.form}</td>
                    <td className={styles.reasonCell}>{row.reason || "(blank)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > shown.length ? (
            <p className="hint">
              Showing the first {shown.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")} rows.
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
