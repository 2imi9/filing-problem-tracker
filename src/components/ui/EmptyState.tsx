// What a list, table or panel shows when it has nothing to show: a bold line, a sentence in secondary
// text and, when there is one, the button that fixes it. Plain text on the page: no box and no picture.
//
//   <EmptyState title="No entries yet">Entries you save appear here.</EmptyState>
//   <EmptyState title="Nothing matches these filters" action={<Button onClick={clear}>Clear filters</Button>}>
//     Try a wider date range.
//   </EmptyState>
//
// `title` is rendered as a paragraph, not a heading, so it never disturbs the page outline.

import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: string;
  /** One or two plain sentences: why it is empty and what to do. */
  children?: ReactNode;
  /** A button or link that fixes the empty state. */
  action?: ReactNode;
  /** Less space above and below, for small panels. */
  compact?: boolean;
}

export function EmptyState({ title, children, action, compact = false }: EmptyStateProps) {
  return (
    <div className={[styles.empty, compact ? styles.compact : ""].filter(Boolean).join(" ")}>
      <p className={styles.title}>{title}</p>
      {children ? <div className={styles.body}>{children}</div> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
