"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { ApiError, apiFetch, errorMessage } from "@/components/data/apiClient";
import { homeFor, safeNextPath } from "@/components/shell/nav";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import type { SummaryError } from "@/components/ui/ErrorSummary";
import { TextInput } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import type { DemoLoginResponse, HealthResponse } from "@/lib/api";
import type { Role } from "@/lib/domain";
import { DEMO_USERS } from "@/lib/sample";
import type { DemoUserId } from "@/lib/sample";
import styles from "./login.module.css";

type Health = { status: "loading" } | { status: "ready"; mode: HealthResponse["mode"] } | { status: "error"; message: string };

const ROLE_SUMMARIES: Record<Role, string> = {
  clerk: "Tags filings and imports rejection exports for one county.",
  leader: "Reads the dashboard and the workspace for every county.",
  admin: "Does everything, and manages changes and the audit log.",
};

/** Where to go after signing in: the page that was asked for, or the role's start page. */
function destination(role: Role): string {
  const asked = safeNextPath(new URLSearchParams(window.location.search).get("next"));
  return asked ?? homeFor(role);
}

function DemoSignIn() {
  const [pending, setPending] = useState<DemoUserId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (userId: DemoUserId) => {
    setPending(userId);
    setError(null);
    try {
      const { user } = await apiFetch<DemoLoginResponse>("/api/demo/login", { method: "POST", body: { userId } });
      // A full page load, so every page starts clean for the new account.
      window.location.assign(destination(user.role));
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(null);
    }
  };

  // The header band already says that this is a prototype and that the data is made up.
  return (
    <>
      <p className="intro">This is the demo. There are no passwords: pick a role to see what that person sees.</p>
      <Card title="Choose a demo role" className={styles.section}>
        {error ? (
          <Alert tone="error" title="Could not sign in." live>
            {error}
          </Alert>
        ) : null}
        {/* Plain rows with a rule between them. The whole row is the button. */}
        <ul className={styles.roles}>
          {DEMO_USERS.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className={styles.role}
                aria-busy={pending === user.id || undefined}
                disabled={pending !== null && pending !== user.id}
                onClick={() => {
                  if (pending === null) void signIn(user.id);
                }}
              >
                <span className={styles.roleText}>
                  <span className={styles.roleName}>{user.label}</span>
                  <span className={styles.roleSummary}>{ROLE_SUMMARIES[user.role]}</span>
                </span>
                {pending === user.id ? <Spinner label="Signing in" hideLabel /> : <Icon name="arrowRight" size={20} className={styles.go} />}
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">Changes you make are kept in memory and are gone when the server restarts.</p>
      </Card>
    </>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why the callback route sent the person back here (`/login?error=...`), in plain words. */
const LINK_PROBLEMS: Record<string, { title: string; text: string }> = {
  link: {
    title: "That sign-in link did not work.",
    text: "It may have been used already, or it has expired. Enter your email below and a new link is sent.",
  },
  no_access: {
    title: "This email address has no account here.",
    text: "You were not signed in. Accounts are by invitation: ask your court's administrator to add you.",
  },
};
const EMAIL_FIELD = "login-email";

// The query string does not change while this page is open, so there is nothing to subscribe to.
const subscribeToNothing = () => () => {};
const readSearch = () => window.location.search;
const readNoSearch = () => "";

function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<SummaryError[]>([]);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [problemDismissed, setProblemDismissed] = useState(false);
  // The page itself is the same for everyone; the address is read in the browser, after hydration.
  const search = useSyncExternalStore(subscribeToNothing, readSearch, readNoSearch);
  const problemCode = new URLSearchParams(search).get("error");
  const linkProblem = !problemDismissed && problemCode ? (LINK_PROBLEMS[problemCode] ?? null) : null;
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.length > 0) summaryRef.current?.focus();
  }, [errors]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const address = email.trim();
    setSentTo(null);
    setProblemDismissed(true);
    if (!EMAIL.test(address)) {
      setErrors([{ message: "Enter an email address, like name@example.gov.", fieldId: EMAIL_FIELD }]);
      return;
    }
    setErrors([]);
    setSending(true);
    try {
      const next = safeNextPath(new URLSearchParams(search).get("next"));
      await apiFetch<unknown>("/api/auth/magic-link", { method: "POST", body: next ? { email: address, next } : { email: address } });
      setSentTo(address);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setErrors([{ message: "Email sign-in is not set up on this server. Ask the administrator." }]);
      } else if (caught instanceof ApiError && caught.code === "invalid_input") {
        setErrors([{ message: caught.issues[0]?.message ?? "Enter an email address, like name@example.gov.", fieldId: EMAIL_FIELD }]);
      } else {
        setErrors([{ message: errorMessage(caught) }]);
      }
    } finally {
      setSending(false);
    }
  };

  const fieldError = errors.find((error) => error.fieldId === EMAIL_FIELD)?.message;

  return (
    <>
      <p className="intro">We email you a link that signs you in. There is no password.</p>
      <Card title="Sign in with your work email" className={styles.section}>
        {linkProblem ? (
          <Alert tone="warning" title={linkProblem.title} live>
            {linkProblem.text}
          </Alert>
        ) : null}
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          <ErrorSummary ref={summaryRef} errors={errors} title="The link was not sent" />
          <TextInput
            id={EMAIL_FIELD}
            className={styles.narrowField}
            label="Work email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            error={fieldError}
            required
          />
          {/* The one main action of this screen. */}
          <Button type="submit" variant="accent" loading={sending}>
            Email me a sign-in link
          </Button>
        </form>
        {sentTo ? (
          <Alert tone="success" title="Check your email." live>
            If <span className="num">{sentTo}</span> has an account, a sign-in link is on its way. The link works once. If it does not arrive in a
            few minutes, check the address and send it again.
          </Alert>
        ) : null}
        <p className="hint">Accounts are by invitation: ask your court&apos;s administrator if you need one.</p>
      </Card>
    </>
  );
}

export function LoginPanel() {
  const [health, setHealth] = useState<Health>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Ask the server which kind of sign-in it uses. No session is needed for this.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { mode } = await apiFetch<HealthResponse>("/api/health");
        if (!cancelled) setHealth({ status: "ready", mode });
      } catch (caught) {
        if (!cancelled) setHealth({ status: "error", message: errorMessage(caught) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (health.status === "loading") return <Spinner label="Checking how sign-in works here" announce />;
  if (health.status === "error") {
    return (
      <Alert
        tone="error"
        title="The sign-in page could not load."
        live
        action={
          <Button
            onClick={() => {
              setHealth({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        }
      >
        {health.message}
      </Alert>
    );
  }
  return health.mode === "demo" ? <DemoSignIn /> : <EmailSignIn />;
}
