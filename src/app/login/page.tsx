import type { Metadata } from "next";
import { LoginPanel } from "./LoginPanel";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className={styles.page}>
      {/* Not drawn: the header band names the product and the section below names the task. */}
      <h1 className="visually-hidden">Sign in</h1>
      <LoginPanel />
    </div>
  );
}
