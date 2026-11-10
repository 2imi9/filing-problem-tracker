// The top of every page: the <h1>, an optional intro paragraph and optional controls, then the content.
//
//   <Page title="Tag a filing" intro="When a filing is rejected or sent back, pick what was wrong and save.">
//     ...
//   </Page>
//   <Page title="Dashboard" width="full" actions={<Button>...</Button>}>...</Page>
//
// width: "narrow" 720px (text and small forms), "wide" 1200px (default), "full" no limit (grids).
// Works in Server and Client Components. Render exactly one Page per route so there is one <h1>.

import type { ReactNode } from "react";
import styles from "./Page.module.css";

export interface PageProps {
  /** The page's <h1>. */
  title: string;
  /** One or two plain sentences under the title. */
  intro?: ReactNode;
  /** Controls shown to the right of the title. */
  actions?: ReactNode;
  /** Default "wide". */
  width?: "narrow" | "wide" | "full";
  children: ReactNode;
}

export function Page({ title, intro, actions, width = "wide", children }: PageProps) {
  return (
    <div className={[styles.page, styles[width]].join(" ")}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <h1>{title}</h1>
          {intro ? <p className={styles.intro}>{intro}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
