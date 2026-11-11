"use client";

import { useState } from "react";
import { ApiError, apiFetch, errorMessage } from "@/components/data/apiClient";
import { parseSummaryReply } from "@/components/panels/summaryReply";
import type { SummaryRequest } from "@/components/panels/summaryReply";
import { Button, Card, Spinner } from "@/components/ui";
import styles from "./dashboard.module.css";

interface AiSummaryProps {
  /** What the summary is about: the dashboard's filters and the change picked below. */
  request: SummaryRequest;
  /** The filters in words, printed with the summary so it is clear what it describes. */
  scope: string;
  /** False when the server has AI switched off. Then nothing can be generated. */
  enabled: boolean;
}

type Result = { kind: "text"; text: string } | { kind: "unavailable"; reason: string | null };

/**
 * An optional summary in plain sentences. Nothing is sent until the person chooses Generate. The server
 * recomputes the numbers itself and gives the model counts only; the page shows what comes back and says
 * to check it against the panels. Changing a filter clears the summary, because it would no longer
 * describe the numbers on the page.
 *
 * With AI switched off it is one quiet line and nothing to press. With AI on it is a plain section
 * under a rule, like the others on the page.
 */
export function AiSummary({ request, scope, enabled }: AiSummaryProps) {
  const signature = JSON.stringify(request);
  const [answer, setAnswer] = useState<{ signature: string; result: Result } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const result = answer && answer.signature === signature ? answer.result : null;
  const busy = pending === signature;

  if (!enabled) {
    return (
      <p className={styles.summaryOff}>
        Summary unavailable. AI features are switched off on this server. Every number on this page is complete without it.
      </p>
    );
  }

  const generate = async () => {
    if (busy) return;
    setPending(signature);
    let next: Result;
    try {
      const reply = parseSummaryReply(await apiFetch<unknown>("/api/ai/summary", { method: "POST", body: request }));
      next = reply.text ? { kind: "text", text: reply.text } : { kind: "unavailable", reason: reply.reason };
    } catch (error) {
      const missing = error instanceof ApiError && (error.status === 404 || error.status === 501);
      next = { kind: "unavailable", reason: missing ? null : errorMessage(error) };
    }
    setAnswer({ signature, result: next });
    setPending((current) => (current === signature ? null : current));
  };

  return (
    <Card
      title="AI summary"
      actions={
        // Quiet: reading the page is the main thing here, and a summary is an extra.
        <Button icon={result ? "refresh" : undefined} loading={busy} onClick={() => void generate()}>
          {result ? "Regenerate" : "Generate"}
        </Button>
      }
    >
      <div className={styles.summaryStack}>
        {/* The label that goes with every summary. The heading already says "AI summary" in view. */}
        <p className={styles.summaryHint}>
          <span className="visually-hidden">AI summary. </span>Check against the numbers below.
        </p>
        <div className={styles.summaryBody} aria-live="polite" aria-busy={busy}>
          {busy ? (
            <Spinner label="Writing the summary" />
          ) : result === null ? (
            <p className={styles.summaryHint}>
              Three to five plain sentences about the numbers on this page. Nothing is sent until you choose Generate, and then only counts are sent: no
              notes and no rows.
            </p>
          ) : result.kind === "text" ? (
            <>
              <p className={styles.summaryText}>{result.text}</p>
              <p className={styles.summaryHint}>Written for: {scope}. It is cleared when you change a filter.</p>
            </>
          ) : (
            <p>
              <strong>Summary unavailable.</strong> {result.reason ?? "No summary could be written this time."} The panels below are not affected.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
