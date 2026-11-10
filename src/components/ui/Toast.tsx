// Short messages that appear at the bottom of the screen and go away on their own, with an optional
// action such as Undo.
//
//   const { toast, dismiss } = useToast();
//   toast({ message: "Saved. 2 problems logged." , tone: "success",
//           action: { label: "Undo", onAction: () => removeEntry(id) } });
//   toast({ message: "Could not save. Try again.", tone: "error" });
//
// ToastProvider is mounted once in the root layout; pages only call useToast().
// A toast stays 5 seconds, or 10 seconds when it has an action, and waits while the pointer or
// keyboard focus is on it. Every toast has a close button. Messages are announced politely by screen
// readers. A toast closed from the keyboard hands focus to the main region, so it is never left on nothing. An action that matters must also be reachable somewhere on the page, because a toast is gone
// after a few seconds.

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { releaseFocusFrom } from "./focus";
import styles from "./Toast.module.css";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  message: string;
  /** Default "info". */
  tone?: ToastTone;
  /** One button on the toast. Choosing it runs onAction and closes the toast. */
  action?: { label: string; onAction: () => void };
  /** How long it stays, in ms. Default 5000, or 10000 with an action. */
  durationMs?: number;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  /** Closes a toast early. */
  dismiss: (id: string) => void;
}

interface ToastItem extends ToastOptions {
  id: string;
}

const MAX_VISIBLE = 3;
const ICONS: Record<ToastTone, IconName> = { success: "check", error: "alert", info: "info" };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider.");
  return api;
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { id, action } = item;
  const duration = item.durationMs ?? (action ? 10_000 : 5_000);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(timer);
  }, [paused, duration, id, onDismiss]);

  // The button being pressed is about to leave the page with the toast.
  const close = () => {
    releaseFocusFrom(root.current);
    onDismiss(id);
  };

  const tone = item.tone ?? "info";
  return (
    <div
      ref={root}
      className={[styles.toast, styles[tone]].join(" ")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={ICONS[tone]} size={20} className={styles.icon} />
      <p className={styles.message}>{item.message}</p>
      {action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            close();
            action.onAction();
          }}
        >
          {action.label}
        </button>
      ) : null}
      <button type="button" className={styles.close} aria-label="Dismiss message" onClick={close}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    setItems((current) => [...current, { ...options, id }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      {/* The live region is always in the page and never hidden, so messages added to it are announced. */}
      <div className={styles.region} role="region" aria-label="Messages" aria-live="polite" aria-relevant="additions text">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}
