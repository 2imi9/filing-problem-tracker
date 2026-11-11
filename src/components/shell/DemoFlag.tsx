// The notice shown in the header band on every page in demo mode, the sign-in pages included. The wording
// is fixed by the spec. The shell already shows it; a page does not need its own.

import styles from "./DemoFlag.module.css";

export const DEMO_FLAG_TEXT = "Prototype. All data is made up.";

export function DemoFlag({ className }: { className?: string }) {
  return <p className={[styles.flag, className].filter(Boolean).join(" ")}>{DEMO_FLAG_TEXT}</p>;
}
