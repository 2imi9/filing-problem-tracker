import { useId } from "react";
import type { ReactNode } from "react";
import styles from "./panels.module.css";

/**
 * How a panel sits on the page.
 * - "section": a rule across the top, then the heading. The usual look.
 * - "boxed": a white box with a thin outline. At most one per page, as in the approved design.
 * - "bare": the content only. The heading, the summary sentence and the caption are still there for
 *   screen readers, for a panel whose content already says all three in view (the key numbers).
 */
export type PanelLook = "section" | "boxed" | "bare";

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
  /** The "View as table" button. It sits at the end of the summary line, so the heading row stays a plain heading. */
  viewSwitch?: ReactNode;
  /** A row under the heading: filters, selects and other controls for this panel. */
  toolbar?: ReactNode;
  /** Extra text under the content, such as a hint about how to read it. */
  note?: ReactNode;
  /** Only the heading row is shown. */
  minimized?: boolean;
  /** Default "section". */
  look?: PanelLook;
  /** A smaller heading and tighter spacing, for panels on the workspace grid. */
  dense?: boolean;
  children: ReactNode;
}

/**
 * The shell every panel sits in, on the dashboard and in the workspace: title, controls, a summary
 * sentence, the content, and a caption that says which filings were counted. It draws no card: a
 * panel is a section under a rule.
 */
export function PanelFrame({
  title,
  headingLevel = 2,
  summary,
  scope,
  lead,
  actions,
  viewSwitch,
  toolbar,
  note,
  minimized = false,
  look = "section",
  dense = false,
  children,
}: PanelFrameProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const bare = look === "bare";
  const quiet = bare ? "visually-hidden" : undefined;
  return (
    <article className={[styles.frame, styles[look], dense ? styles.dense : ""].filter(Boolean).join(" ")} aria-labelledby={headingId}>
      {bare ? (
        <Heading id={headingId} className="visually-hidden">
          {title}
        </Heading>
      ) : (
        <header className={styles.head}>
          {lead}
          <Heading id={headingId} className={styles.title}>
            {title}
          </Heading>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      )}
      {minimized ? null : (
        <>
          {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
          <div className={styles.body}>
            {bare ? (
              <p className="visually-hidden">{summary}</p>
            ) : (
              <div className={styles.lead}>
                <p className={styles.summary}>{summary}</p>
                {viewSwitch}
              </div>
            )}
            {children}
            {note || scope ? (
              <div className={styles.tail}>
                {note ? <div className={styles.note}>{note}</div> : null}
                {scope ? (
                  <footer className={quiet ?? styles.foot}>
                    <span className="visually-hidden">Counted: </span>
                    {scope}
                  </footer>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}
