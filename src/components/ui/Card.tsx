// A bordered surface with an optional heading row. Pages are built from these.
//
//   <Card title="Recent entries" note="this desk">...</Card>
//   <Card title="Preview" headingLevel={3} actions={<Button size="sm">Refresh</Button>}>...</Card>
//   <Card>plain content</Card>
//
// With a title the card is a <section> named by its heading; without one it is a plain <div>.

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
  /** 12px padding instead of 16 to 20px, for dense screens. */
  dense?: boolean;
  id?: string;
  className?: string;
  /** With a ref the card can be given focus from code (tabindex -1), as a landing place after a control inside it goes away. */
  ref?: Ref<HTMLElement>;
}

export function Card({ title, note, headingLevel = 2, actions, children, dense = false, id, className, ref }: CardProps) {
  const headingId = useId();
  const classes = [styles.card, dense ? styles.dense : "", className].filter(Boolean).join(" ");
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
