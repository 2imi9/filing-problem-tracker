import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/ui/Spinner";
import styles from "../../login/login.module.css";
import { ConfirmSignIn } from "./ConfirmSignIn";

export const metadata: Metadata = { title: "Finish signing in" };

// Supabase mode: where the emailed sign-in link lands. The one-time token is only used when the person
// presses the button. Mail systems that open every link in a message to check it (common in government
// mail) load this page and go no further, so they cannot use the link up before the person does.
export default function ConfirmPage() {
  return (
    <div className={styles.page}>
      {/* Not drawn: the header band names the product and the sentence below says what to do. */}
      <h1 className="visually-hidden">Finish signing in</h1>
      <Suspense fallback={<Spinner label="Reading the sign-in link" announce />}>
        <ConfirmSignIn />
      </Suspense>
    </div>
  );
}
