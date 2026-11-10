"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import styles from "./status.module.css";

// Shown when a page throws while rendering. The frame around it (navigation, header) stays in place.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Errors from the server arrive with a digest that matches a line in the server log.
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <div className={styles.status}>
      <title>Something went wrong | Filing Problem Tracker</title>
      <h1>Something went wrong</h1>
      <p className={styles.lead} role="alert">
        This page could not be shown. Nothing you saved earlier was lost. Try again, or go back to the start.
      </p>
      {digest ? (
        <p className={styles.reference}>
          Reference for the administrator: <span className="num">{digest}</span>
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" icon="refresh" onClick={() => retry()}>
          Try again
        </Button>
        <LinkButton href="/">Go to the start page</LinkButton>
      </div>
    </div>
  );
}
