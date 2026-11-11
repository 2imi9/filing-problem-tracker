// The courthouse mark: our own drawing, not a court seal or logo. The same paths as public/brand/mark.svg
// and src/app/icon.svg.
//
//   <Mark className={styles.mark} />
//
// It takes the text color; the lamp in the pediment takes --hero-flag. Decorative: the name it sits
// beside says what it is.

import styles from "./Mark.module.css";

export function Mark({ className }: { className?: string }) {
  return (
    <svg className={[styles.mark, className].filter(Boolean).join(" ")} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 2.5 30 11H2z" />
      <circle className={styles.lamp} cx="16" cy="7.9" r="1.7" />
      <path d="M4 12.5h24v2H4zM5.5 16h3v8.5h-3zM11.5 16h3v8.5h-3zM17.5 16h3v8.5h-3zM23.5 16h3v8.5h-3zM4 25.5h24v2H4zM2 28.5h28v2H2z" />
    </svg>
  );
}
