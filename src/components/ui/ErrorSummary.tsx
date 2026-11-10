// The list of problems at the top of a form after a failed submit.
//
//   const summaryRef = useRef<HTMLDivElement>(null);
//   ...on a failed submit: setErrors(next); then focus it once it has rendered:
//   useEffect(() => { if (errors.length) summaryRef.current?.focus(); }, [errors]);
//
//   <ErrorSummary ref={summaryRef} errors={[
//     { message: "Choose at least one problem.", fieldId: "log-tags" },
//     { message: "The note looks like it contains a phone number.", fieldId: "log-note" },
//   ]} />
//
// It renders nothing when `errors` is empty. It has role="alert" and tabIndex -1, so it is announced and
// can take focus. Each item with a `fieldId` is a link that moves focus to that control (the element with
// that id; a ChipGroup id works too). Inline errors next to the fields should stay as well.

"use client";

import { useId } from "react";
import type { MouseEvent, Ref } from "react";
import { Icon } from "./Icon";
import styles from "./ErrorSummary.module.css";

export interface SummaryError {
  message: string;
  /** Id of the control (or group) to send focus to. Without it the item is plain text. */
  fieldId?: string;
}

export interface ErrorSummaryProps {
  errors: readonly SummaryError[];
  /** Default "There is a problem" (or "There are N problems"). */
  title?: string;
  ref?: Ref<HTMLDivElement>;
}

function focusField(event: MouseEvent<HTMLAnchorElement>, fieldId: string) {
  const target = document.getElementById(fieldId);
  if (!target) return;
  event.preventDefault();
  target.focus();
  target.scrollIntoView({ block: "center" });
}

export function ErrorSummary({ errors, title, ref }: ErrorSummaryProps) {
  const titleId = useId();
  if (errors.length === 0) return null;
  const heading = title ?? (errors.length === 1 ? "There is a problem" : `There are ${errors.length} problems`);
  return (
    <div ref={ref} className={styles.summary} role="alert" tabIndex={-1} aria-labelledby={titleId}>
      <p id={titleId} className={styles.title}>
        <Icon name="alert" size={20} />
        <span>{heading}</span>
      </p>
      <ul className={styles.list}>
        {errors.map(({ message, fieldId }, index) => (
          <li key={`${fieldId ?? "form"}-${index}`}>
            {fieldId ? (
              <a href={`#${fieldId}`} onClick={(event) => focusField(event, fieldId)}>
                {message}
              </a>
            ) : (
              message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
