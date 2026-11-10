// Labels for an outcome, a problem, or another short status. Not interactive.
//
//   <OutcomePill outcome={record.outcome} />   a coloured dot and one short word in a thin outline:
//                                              "Pass" (Fixed at counter, green), "Fix" (Returned to fix, gold),
//                                              "Reject" (Rejected, red). Screen readers get the full name too.
//   <TagPill tag={tag} />                      a problem, as plain text; "Needs review" is red and bold
//   <Pill>Imported</Pill>                      any other status, as plain text
//   <Pill tone="warning">Low</Pill>            `tone` colors the text; the words still carry the meaning
//
// The outcome label is the only capsule shape in the app. Each outline hugs its own word. The label sits
// in a slot as wide as the longest word, so in a list the dots start at the same left edge on every row.
//
// A row of problems reads as text with commas when its parent has the global class "tag-list":
//   <ul className="tag-list">{tags.map((tag) => <li key={tag}><TagPill tag={tag} /></li>)}</ul>

import type { ReactNode } from "react";
import { NEEDS_REVIEW } from "@/lib/domain";
import type { FlagTag, Outcome } from "@/lib/domain";
import styles from "./Pill.module.css";

export type PillTone = "neutral" | "primary" | "danger" | "warning" | "success";

export interface PillProps {
  /** Text color. Default "neutral" (secondary text). */
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}

/** Plain text in the color of its tone. No outline and no fill. */
export function Pill({ tone = "neutral", children, className }: PillProps) {
  return <span className={[styles.text, styles[tone], className].filter(Boolean).join(" ")}>{children}</span>;
}

/** The short word shown for each outcome, and the class that colors its dot. */
const OUTCOME_LABELS: Record<Outcome, { word: string; dot: string }> = {
  "Fixed at counter": { word: "Pass", dot: styles.pass },
  "Returned to fix": { word: "Fix", dot: styles.fix },
  Rejected: { word: "Reject", dot: styles.reject },
};

/** The longest of the short words. An unseen copy of it holds the slot's width. */
const LONGEST_WORD = "Reject";

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  const { word, dot } = OUTCOME_LABELS[outcome];
  return (
    <span className={styles.slot}>
      <span className={[styles.outcome, dot].join(" ")} title={outcome}>
        {word}
        <span className="visually-hidden"> ({outcome})</span>
      </span>
      <span className={[styles.outcome, styles.sizer].join(" ")} aria-hidden="true">
        {LONGEST_WORD}
      </span>
    </span>
  );
}

export function TagPill({ tag }: { tag: FlagTag }) {
  return <span className={[styles.tag, tag === NEEDS_REVIEW ? styles.none : ""].filter(Boolean).join(" ")}>{tag}</span>;
}
