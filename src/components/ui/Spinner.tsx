// A small loading indicator with a text label.
//
//   <Spinner />                          shows "Loading" next to the ring
//   <Spinner label="Saving" />           another label
//   <Spinner label="Saving" hideLabel /> ring only; the label is still read by screen readers
//
// Put it inside an element with role="status" (or use `announce`) when the loading state should be read aloud.

import styles from "./Spinner.module.css";

export interface SpinnerProps {
  /** Default "Loading". */
  label?: string;
  /** Hide the label visually. It stays available to screen readers. */
  hideLabel?: boolean;
  /** Ring size in px. Default 18. */
  size?: number;
  /** Wrap in role="status" so the label is announced when it appears. Default false. */
  announce?: boolean;
  className?: string;
}

export function Spinner({ label = "Loading", hideLabel = false, size = 18, announce = false, className }: SpinnerProps) {
  return (
    <span className={[styles.spinner, className].filter(Boolean).join(" ")} role={announce ? "status" : undefined}>
      <svg className={styles.ring} width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={3} strokeLinecap="round" aria-hidden="true" focusable="false">
        <circle className={styles.track} cx="12" cy="12" r="9" />
        <path className={styles.arc} d="M21 12a9 9 0 0 0-9-9" />
      </svg>
      <span className={hideLabel ? "visually-hidden" : styles.label}>{label}</span>
    </span>
  );
}
