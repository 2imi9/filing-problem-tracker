// An inline message inside the page: a warning under a field, an error above a table, a result after a save.
//
//   <Alert tone="warning" title="This looks like it contains a phone number.">Remove it before saving.</Alert>
//   <Alert tone="error" live>Could not load the audit log.</Alert>
//   <Alert tone="success" live>Added 9 rows.</Alert>
//
// `live` makes screen readers announce it when it appears: role="alert" for errors, role="status" otherwise.
// Leave `live` off for messages that are present when the page loads.

import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import styles from "./Alert.module.css";

export type AlertTone = "info" | "success" | "warning" | "error";

export interface AlertProps {
  /** Default "info". */
  tone?: AlertTone;
  /** A short bold first line. */
  title?: string;
  children?: ReactNode;
  /** Announce when it appears. Default false. */
  live?: boolean;
  /** A button or link shown under the text, for example "Try again". */
  action?: ReactNode;
  id?: string;
}

const ICONS: Record<AlertTone, IconName> = { info: "info", success: "check", warning: "alert", error: "alert" };

export function Alert({ tone = "info", title, children, live = false, action, id }: AlertProps) {
  return (
    <div id={id} className={[styles.alert, styles[tone]].join(" ")} role={live ? (tone === "error" ? "alert" : "status") : undefined}>
      <Icon name={ICONS[tone]} size={20} className={styles.icon} />
      <div className={styles.text}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children ? <div>{children}</div> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    </div>
  );
}
