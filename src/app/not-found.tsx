import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/Button";
import styles from "./status.module.css";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className={styles.status}>
      <h1>Page not found</h1>
      <p className={styles.lead}>There is no page at this address. It may have been typed wrong, or the link may be old.</p>
      <div className={styles.actions}>
        <LinkButton href="/" variant="primary">
          Go to the start page
        </LinkButton>
      </div>
    </div>
  );
}
