// Choice rows: a checkbox row (choose any), a radio row (choose one), and a removable row for active filters.
// They are square-cornered rows with a mark at the left, not rounded pills.
//
//   <ChipGroup label="What was wrong? Choose all that apply.">
//     <Chip pressed={on} onPressedChange={setOn} shortcut="1">Missing signature</Chip>
//   </ChipGroup>
//
//   <ChipGroup label="What happened to the filing?">
//     <Chip radio tone="danger" pressed={outcome === "Rejected"} onPressedChange={() => setOutcome("Rejected")}>Rejected</Chip>
//   </ChipGroup>
//
//   <RemovableChip label="County: Marion" onRemove={() => ...} />
//
// Chip is a <button aria-pressed>. Checkbox row: a 16px square that becomes a tick when pressed.
// Radio row: a round mark that becomes a thick ring when pressed, in the color of `tone`
// ("danger" red for Rejected, "warning" gold for Returned to fix, "success" green for Fixed at counter,
// "primary" navy). Pressed rows also get a soft fill and an accent outline, so color is never the only signal.
// A chip with a tone other than "primary" is drawn as a radio row unless `radio` says otherwise.
// `shortcut` only prints a key hint on the chip; the page that owns the chips listens for the key.

"use client";

import type { ReactNode, Ref } from "react";
import { Icon } from "./Icon";
import styles from "./Chip.module.css";

export type ChipTone = "primary" | "danger" | "warning" | "success";

export interface ChipProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  /** A key hint printed on the chip, for example "1". */
  shortcut?: string;
  /** Color of a radio row's ring when pressed. Default "primary". */
  tone?: ChipTone;
  /** Draw the round mark of a choose-one row. Default: true when `tone` is not "primary". */
  radio?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Chip({ pressed, onPressedChange, children, shortcut, tone = "primary", radio, disabled, id, className, ref }: ChipProps) {
  const round = radio ?? tone !== "primary";
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      className={[styles.chip, round ? styles.radio : styles.check, styles[tone], className].filter(Boolean).join(" ")}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
    >
      <span className={styles.mark} aria-hidden="true">
        {pressed && !round ? (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <path d="M3 8.5l3.2 3.2L13 4.8" />
          </svg>
        ) : null}
      </span>
      <span>{children}</span>
      {shortcut ? (
        <kbd className={styles.key} aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

export interface ChipGroupProps {
  /** Names the group for screen readers and is shown above the chips. */
  label: string;
  /** Extra text under the label, for example a keyboard hint. */
  hint?: string;
  /** An error for the whole group, shown under the chips. */
  error?: string;
  /** Id of the group element, so an error summary can link to it. */
  id?: string;
  children: ReactNode;
}

/** A labelled group of chips. The group can receive focus from an error summary link. */
export function ChipGroup({ label, hint, error, id, children }: ChipGroupProps) {
  const labelId = id ? `${id}-label` : undefined;
  const hintId = id && hint ? `${id}-hint` : undefined;
  const errorId = id && error ? `${id}-error` : undefined;
  return (
    <div
      id={id}
      role="group"
      tabIndex={-1}
      className={styles.group}
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : label}
      aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
    >
      <div className={`label-sm ${styles.groupLabel}`} id={labelId}>
        {label}
      </div>
      {hint ? (
        <p className={styles.groupHint} id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className={styles.chips}>{children}</div>
      {error ? (
        <p className={styles.groupError} id={errorId}>
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface RemovableChipProps {
  /** The chip text, for example "County: Marion". */
  label: string;
  onRemove: () => void;
  className?: string;
}

/** A row for an active filter. The whole row is one button that removes it. */
export function RemovableChip({ label, onRemove, className }: RemovableChipProps) {
  return (
    <button type="button" className={[styles.chip, styles.removable, className].filter(Boolean).join(" ")} onClick={onRemove}>
      <span>{label}</span>
      <Icon name="close" size={16} />
      <span className="visually-hidden">Remove filter</span>
    </button>
  );
}
