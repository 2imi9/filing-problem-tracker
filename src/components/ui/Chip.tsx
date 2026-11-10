// Chips: a toggle chip, and a removable chip for active filters.
//
//   <ChipGroup label="What was wrong? Choose all that apply.">
//     <Chip pressed={on} onPressedChange={setOn} shortcut="1">Missing signature</Chip>
//   </ChipGroup>
//
//   <RemovableChip label="County: Marion" onRemove={() => ...} />
//
// Chip is a <button aria-pressed>. The check mark and the filled background both show the pressed
// state, so color is never the only signal. `shortcut` only prints a key hint on the chip; the page
// that owns the chips listens for the key.
// `tone` colors the pressed state: "primary" (default), "danger", "warning" or "success".

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
  /** Color of the pressed state. Default "primary". */
  tone?: ChipTone;
  disabled?: boolean;
  id?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Chip({ pressed, onPressedChange, children, shortcut, tone = "primary", disabled, id, className, ref }: ChipProps) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      className={[styles.chip, styles[tone], className].filter(Boolean).join(" ")}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
    >
      {shortcut ? (
        <kbd className={styles.key} aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}
      <span>{children}</span>
      {pressed ? <Icon name="check" size={16} /> : null}
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
      <div className={styles.groupLabel} id={labelId}>
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

/** A chip for an active filter. The whole chip is one button that removes it. */
export function RemovableChip({ label, onRemove, className }: RemovableChipProps) {
  return (
    <button type="button" className={[styles.chip, styles.removable, className].filter(Boolean).join(" ")} onClick={onRemove}>
      <span>{label}</span>
      <Icon name="close" size={16} />
      <span className="visually-hidden">Remove filter</span>
    </button>
  );
}
