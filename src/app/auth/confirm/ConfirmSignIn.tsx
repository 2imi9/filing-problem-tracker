"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { nextFromRedirectTarget } from "@/components/shell/nav";
import { Alert } from "@/components/ui/Alert";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import styles from "../../login/login.module.css";

/** The link kinds the callback route accepts. Anything else is treated as an incomplete link. */
const LINK_TYPES = ["email", "magiclink", "invite"];

export function ConfirmSignIn() {
  const params = useSearchParams();
  const [submitted, setSubmitted] = useState(false);
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  // The page that was asked for before signing in travels inside the link's redirect_to (see the email template).
  const next = nextFromRedirectTarget(params.get("redirect_to"));

  if (!tokenHash || !type || !LINK_TYPES.includes(type)) {
    return (
      <Alert tone="error" title="This sign-in link is not complete." action={<LinkButton href="/login">Go to the sign-in page</LinkButton>}>
        Part of the link is missing. Open the link from the email again, or ask for a new one on the sign-in page.
      </Alert>
    );
  }

  return (
    <Card title="Sign in to the Filing Problem Tracker">
      <p>Press the button to finish signing in on this device. The link in your email works once.</p>
      {/* A plain form, so the token is sent only when the person presses the button. */}
      <form className={styles.form} method="get" action="/api/auth/callback" onSubmit={() => setSubmitted(true)}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Button type="submit" variant="accent" icon="arrowRight" loading={submitted}>
          Sign in
        </Button>
      </form>
    </Card>
  );
}
