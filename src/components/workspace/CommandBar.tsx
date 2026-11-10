"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Alert, Button, useFocusAfterUpdate } from "@/components/ui";
import { errorMessage } from "@/components/data/apiClient";
import { REQUEST_MAX } from "./model";
import styles from "./workspace.module.css";

/** What came of a request: whether panels opened, and a sentence to show. */
export interface CommandResult {
  ok: boolean;
  message: string | null;
}

interface CommandBarProps {
  /** "hero": large and centered, for an empty workspace. "docked": one compact row above the panels. */
  mode: "hero" | "docked";
  /** Requests to try, shown as chips in hero mode. */
  examples: readonly string[];
  /** Sends the request. Resolves when the panels are open; throws when the server cannot be reached. */
  onSubmit: (request: string) => Promise<CommandResult>;
  /** Shown next to the submit button: the Add panel menu. */
  children?: ReactNode;
}

export const COMMAND_INPUT_ID = "workspace-request";

/**
 * A command bar, not a chat: one line saying what to look at, answered with panels. The request is the
 * only thing sent; the numbers in the panels are counted here from the data.
 */
export function CommandBar({ mode, examples, onSubmit, children }: CommandBarProps) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hintId = useId();
  const problemId = useId();
  const input = useRef<HTMLInputElement>(null);
  const focusAfterUpdate = useFocusAfterUpdate();

  /** `fromExample`: the request came from an example chip, which is switched off and then usually removed. */
  const send = async (text: string, fromExample = false) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (busy) return;
    if (clean === "") {
      setProblem("Type what you want to see, or choose Add panel.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await onSubmit(clean);
      if (result.ok) setRequest("");
      else setProblem(result.message ?? "Nothing matched that request.");
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
      // The chip that was pressed is gone or was switched off meanwhile. The field is where the answer is said.
      if (fromExample) focusAfterUpdate(() => input.current);
    }
  };

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send(request);
  };

  return (
    <section className={mode === "hero" ? styles.commandHero : styles.commandDock} aria-label="Ask for panels">
      <form className={styles.commandForm} onSubmit={onFormSubmit} noValidate>
        <label htmlFor={COMMAND_INPUT_ID} className={mode === "hero" ? styles.commandLabelHero : styles.commandLabel}>
          What do you want to see?
        </label>
        <div className={styles.commandRow}>
          <input
            ref={input}
            id={COMMAND_INPUT_ID}
            className={styles.commandInput}
            type="text"
            value={request}
            maxLength={REQUEST_MAX}
            autoComplete="off"
            enterKeyHint="go"
            placeholder="Missing signatures in Marion small claims"
            aria-describedby={problem ? `${hintId} ${problemId}` : hintId}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => {
              setRequest(event.target.value);
              if (problem) setProblem(null);
            }}
          />
          <Button type="submit" variant="accent" loading={busy}>
            Open panels
          </Button>
          {children}
        </div>
        <p id={hintId} className={styles.commandHint}>
          Name a county, a case type, a problem or a change. Panels open below and you can change their filters by hand.
        </p>
      </form>
      {problem ? (
        <Alert tone="warning" live id={problemId}>
          {problem}
        </Alert>
      ) : null}
      {mode === "hero" ? (
        <div className={styles.examples}>
          <p className={styles.examplesLabel} id={`${hintId}-examples`}>
            Or try one of these
          </p>
          <ul className={styles.exampleList} aria-labelledby={`${hintId}-examples`}>
            {examples.map((example) => (
              <li key={example}>
                <button type="button" className={styles.exampleChip} disabled={busy} onClick={() => void send(example, true)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
