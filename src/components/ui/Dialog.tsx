// A modal dialog built on the native <dialog> element (focus is trapped, Escape closes, focus returns
// to the element that opened it).
//
//   <Dialog open={open} onClose={() => setOpen(false)} title="Choose the problems"
//           footer={<><Button onClick={close}>Cancel</Button><Button variant="accent" onClick={apply}>Apply</Button></>}>
//     ...content...
//   </Dialog>
//
//   <ConfirmDialog open={open} title="Delete this change?" confirmLabel="Delete" tone="danger"
//                  busy={deleting} onConfirm={remove} onCancel={() => setOpen(false)}>
//     The before and after panel will no longer offer it.
//   </ConfirmDialog>
//
// The parent owns `open`. onClose is called for Escape, the close button and a click on the backdrop;
// set `open` to false there. Content is mounted only while the dialog is open, so its state resets.

"use client";

import { useEffect, useId, useRef } from "react";
import type { MouseEvent, ReactNode, SyntheticEvent } from "react";
import { Button, IconButton } from "./Button";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Buttons at the bottom, right aligned. */
  footer?: ReactNode;
  /** Max width: "sm" 420px, "md" 560px (default), "lg" 760px. */
  size?: "sm" | "md" | "lg";
}

export function Dialog({ open, onClose, title, children, footer, size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape: keep the dialog under the parent's control instead of letting the browser close it.
  const onEscape = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };

  // A click that lands on the dialog element itself is a click on the backdrop.
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === ref.current) onClose();
  };

  return (
    <dialog ref={ref} className={[styles.dialog, styles[size]].join(" ")} aria-labelledby={titleId} onCancel={onEscape} onClick={onBackdrop}>
      {open ? (
        <div className={styles.inner}>
          <div className={styles.head}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
          <div className={styles.body}>{children}</div>
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in a sentence or two. */
  children?: ReactNode;
  confirmLabel: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** "danger" for deletes, "primary" otherwise. Default "primary". */
  tone?: "primary" | "danger";
  /** Shows the confirm button as loading. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "Cancel", tone = "primary", busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>{cancelLabel}</Button>
          {/* The dialog is a screen of its own, so its main action is the gold button; a delete is quiet and red. */}
          <Button variant={tone === "danger" ? "danger" : "accent"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
