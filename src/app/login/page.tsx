import type { Metadata } from "next";
import { LoginPanel } from "./LoginPanel";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className={styles.wrap}>
      <h1>Sign in</h1>
      <LoginPanel />
    </div>
  );
}
