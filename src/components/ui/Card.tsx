// A section of a page: a rule across the top, a heading in the heading face, then the content, straight
// on the page background. It draws no frame. Pages are built from these.
//
//   <Card title="Recent entries" note="this desk">...</Card>
//   <Card title="Preview" headingLevel={3} actions={<Button size="sm">Refresh</Button>}>...</Card>
//   <Card>plain content</Card>                         no heading, so no rule: only the spacing
//   <Card title="Tag a filing problem" boxed>...</Card> the ONE boxed section a page may have: its main task
//
// With a title the card is a <section> named by its heading; without one it is a plain <div>.
// The rule is dark under a level 2 heading and light under levels 3 and 4, which sit inside a section.

import { useId } from "react";
import type { ReactNode, Ref } from "react";
import styles from "./Card.module.css";

export interface CardProps {
  title?: string;
  /** Small secondary text after the title. */
  note?: ReactNode;
  /** Heading level of the title. Default 2. */
  headingLevel?: 2 | 3 | 4;
  /** Controls on the right of the heading row. */
  actions?: ReactNode;
  children: ReactNode;
  /** Tighter spacing, for dense screens. */
  dense?: boolean;
  /** A white box with a thin outline in place of the top rule. At most one per page, for the main task. Default false. */
  boxed?: boolean;
  id?: string;
  className?: string;
  /** With a ref the card can be given focus from code (tabindex -1), as a landing place after a control inside it goes away. */
  ref?: Ref<HTMLElement>;
}

export function Card({ title, note, headingLevel = 2, actions, children, dense = false, boxed = false, id, className, ref }: CardProps) {
  const headingId = useId();
  const classes = [styles.card, boxed ? styles.boxed : title ? styles.ruled : "", headingLevel > 2 ? styles.sub : "", dense ? styles.dense : "", className]
    .filter(Boolean)
    .join(" ");
  if (!title) {
    return (
      <div id={id} className={classes} ref={ref as Ref<HTMLDivElement> | undefined} tabIndex={ref ? -1 : undefined}>
        {children}
      </div>
    );
  }
  const Heading = `h${headingLevel}` as const;
  return (
    <section id={id} className={classes} aria-labelledby={headingId} ref={ref} tabIndex={ref ? -1 : undefined}>
      <div className={styles.head}>
        <Heading id={headingId} className={styles.title}>
          {title}
          {note ? <small className={styles.note}> {note}</small> : null}
        </Heading>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
