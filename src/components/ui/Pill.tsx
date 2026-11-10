// Small labels for a status or a category. Not interactive.
//
//   <Pill tone="success">Fixed at counter</Pill>
//   <OutcomePill outcome={record.outcome} />     picks the tone for an outcome
//   <TagPill tag={tag} />                        a problem label; "Needs review" gets the warning look
//
// The label text always says the status; the color only supports it.

import type { ReactNode } from "react";
import { NEEDS_REVIEW } from "@/lib/domain";
import type { FlagTag, Outcome } from "@/lib/domain";
import styles from "./Pill.module.css";

export type PillTone = "neutral" | "primary" | "danger" | "warning" | "success";

export interface PillProps {
  /** Default "neutral". */
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}

export function Pill({ tone = "neutral", children, className }: PillProps) {
  return <span className={[styles.pill, styles[tone], className].filter(Boolean).join(" ")}>{children}</span>;
}

const OUTCOME_TONES: Record<Outcome, PillTone> = {
  Rejected: "danger",
  "Returned to fix": "warning",
  "Fixed at counter": "success",
};

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  return <Pill tone={OUTCOME_TONES[outcome]}>{outcome}</Pill>;
}

export function TagPill({ tag }: { tag: FlagTag }) {
  return <Pill tone={tag === NEEDS_REVIEW ? "warning" : "primary"}>{tag}</Pill>;
}
