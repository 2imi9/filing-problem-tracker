// What a list, table or panel shows when it has nothing to show.
//
//   <EmptyState title="No entries yet">Entries you save appear here.</EmptyState>
//   <EmptyState title="Nothing matches these filters" icon="filter" action={<Button onClick={clear}>Clear filters</Button>}>
//     Try a wider date range.
//   </EmptyState>
//
// `title` is rendered as a paragraph, not a heading, so it never disturbs the page outline.

import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: string;
  /** One or two plain sentences: why it is empty and what to do. */
  children?: ReactNode;
  /** Default "info". */
  icon?: IconName;
  /** A button or link that fixes the empty state. */
  action?: ReactNode;
  /** Less padding, for small panels. */
  compact?: boolean;
}

export function EmptyState({ title, children, icon = "info", action, compact = false }: EmptyStateProps) {
  return (
    <div className={[styles.empty, compact ? styles.compact : ""].filter(Boolean).join(" ")}>
      <Icon name={icon} size={28} className={styles.icon} />
      <p className={styles.title}>{title}</p>
      {children ? <div className={styles.body}>{children}</div> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
