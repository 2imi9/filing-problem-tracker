"use client";

import { useEffect } from "react";
import "./globals.css";
import styles from "./status.module.css";

// Shown when the root layout itself fails. It replaces the whole document, so it renders its own <html>
// and <body> and uses plain elements only: nothing here may depend on the providers that just failed.
// The theme follows the system setting, because the saved choice is applied by the layout that is gone.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong | Filing Problem Tracker</title>
        <main className={`${styles.status} ${styles.standalone}`}>
          <h1>Something went wrong</h1>
          <p className={styles.lead} role="alert">
            The tracker could not start. Nothing you saved earlier was lost. Try again in a moment.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.plainButton} onClick={() => retry()}>
              Try again
            </button>
            {/* A full page load on purpose: client-side navigation needs the layout that failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">Go to the start page</a>
          </div>
        </main>
      </body>
    </html>
  );
}
