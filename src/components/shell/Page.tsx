// The top of every page: the page's <h1>, one opening sentence, optional controls, then the sections.
//
//   <Page title="Tag a filing" intro="A filing is sent back. The clerk tags what was wrong in a few clicks, with no names or case numbers.">
//     <Card title="Tag a filing problem" boxed>...</Card>
//     <Card title="Recent entries" note="this desk">...</Card>
//   </Page>
//   <Page title="Dashboard" width="full" actions={<Button>...</Button>}>...</Page>
//
// What is drawn: the intro, as one sentence in the heading face. Keep it short enough for one line on a
// desktop screen. The title is not drawn: the highlighted tab already names the page. It is still the
// page's <h1> for screen readers and for the document outline, so every page must pass one.
// The direct children are the page's sections; Page spaces them with --section-gap (48px, 36px on a phone).
//
// width: "narrow" 720px (text and small forms), "wide" the 1088px page column (default), "full" no limit (grids).
// Works in Server and Client Components. Render exactly one Page per route so there is one <h1>.

import type { ReactNode } from "react";
import styles from "./Page.module.css";

export interface PageProps {
  /** The page's <h1>. Read by screen readers; not drawn. */
  title: string;
  /** One plain sentence that opens the page. */
  intro?: ReactNode;
  /** Controls shown to the right of the intro. */
  actions?: ReactNode;
  /** Default "wide". */
  width?: "narrow" | "wide" | "full";
  children: ReactNode;
}

export function Page({ title, intro, actions, width = "wide", children }: PageProps) {
  return (
    <div className={[styles.page, styles[width]].join(" ")}>
      {/* Out of the flow (position: absolute), so it takes no row in the grid of sections. */}
      <h1 className="visually-hidden">{title}</h1>
      {intro || actions ? (
        <div className={styles.head}>
          {intro ? <p className={`intro ${styles.intro}`}>{intro}</p> : null}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
