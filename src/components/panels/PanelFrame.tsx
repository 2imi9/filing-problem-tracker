import { useId } from "react";
import type { ReactNode } from "react";
import styles from "./panels.module.css";

export interface PanelFrameProps {
  title: string;
  /** Heading level of the title. Default 2. */
  headingLevel?: 2 | 3;
  /** One sentence saying what the panel shows. Printed above the chart or table. */
  summary: string;
  /** The panel's filters in words. Printed as the caption under the content. */
  scope: string;
  /** Goes before the title: the workspace's drag handle. */
  lead?: ReactNode;
  /** Buttons at the right of the heading row. */
  actions?: ReactNode;
  /** A row under the heading: filter chips, selects and other controls for this panel. */
  toolbar?: ReactNode;
  /** Extra text under the content, such as a hint about how to read it. */
  note?: ReactNode;
  /** Only the heading row is shown. */
  minimized?: boolean;
  children: ReactNode;
}

/**
 * The shell every panel sits in, on the dashboard and in the workspace: title, controls, a summary
 * sentence, the content, and a caption that says which filings were counted.
 */
export function PanelFrame({ title, headingLevel = 2, summary, scope, lead, actions, toolbar, note, minimized = false, children }: PanelFrameProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <article className={styles.frame} aria-labelledby={headingId}>
      <header className={styles.head}>
        {lead}
        <Heading id={headingId} className={styles.title}>
          {title}
        </Heading>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      {minimized ? null : (
        <>
          {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
          <div className={styles.body}>
            <p className={styles.summary}>{summary}</p>
            {children}
            {note ? <div className={styles.note}>{note}</div> : null}
          </div>
          {scope ? (
            <footer className={styles.foot}>
              <span className="visually-hidden">Counted: </span>
              {scope}
            </footer>
          ) : null}
        </>
      )}
    </article>
  );
}
