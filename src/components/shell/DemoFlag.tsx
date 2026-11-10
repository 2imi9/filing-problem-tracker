// The notice shown on every page in demo mode. The wording is fixed by the spec.

import styles from "./DemoFlag.module.css";

export const DEMO_FLAG_TEXT = "Prototype. All data is made up.";

export function DemoFlag({ className }: { className?: string }) {
  return <p className={[styles.flag, className].filter(Boolean).join(" ")}>{DEMO_FLAG_TEXT}</p>;
}
