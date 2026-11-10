// The account button in the header: who is signed in, with what role, and the way to sign out.
// In demo mode signing out is also how you switch to another role.

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "@/components/data/apiClient";
import { useData } from "@/components/data/DataProvider";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { roleLabel } from "./nav";
import styles from "./UserMenu.module.css";

export function UserMenu() {
  const { user, mode, signOut } = useData();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Close on a click or tap outside, and on Escape (focus goes back to the button).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!user) return null;
  const label = roleLabel(user.role, user.county);

  const leave = async () => {
    setLeaving(true);
    setLeaveError(null);
    try {
      await signOut();
    } catch (error) {
      // Still signed in: say so, and leave the button ready for another try.
      setLeaveError(errorMessage(error));
      setLeaving(false);
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="user" size={20} />
        <span className={styles.triggerLabel}>
          <span className="visually-hidden">Account: </span>
          {label}
        </span>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={16} />
      </button>
      <div id={panelId} className={styles.panel} hidden={!open}>
        <dl className={styles.details}>
          <div>
            <dt>Signed in as</dt>
            <dd className={styles.email}>{user.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{label}</dd>
          </div>
        </dl>
        {leaveError ? (
          <Alert tone="error" title="Could not sign out. You are still signed in." live>
            {leaveError}
          </Alert>
        ) : null}
        <Button block icon="logout" loading={leaving} onClick={() => void leave()}>
          {mode === "demo" ? "Sign out or switch role" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}
