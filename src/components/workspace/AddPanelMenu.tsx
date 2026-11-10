"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { AddPanelOption } from "./model";
import styles from "./workspace.module.css";

interface AddPanelMenuProps {
  options: readonly AddPanelOption[];
  /** Set when no more panels fit. The menu then says why instead of listing the types. */
  full: boolean;
  onAdd: (option: AddPanelOption) => void;
}

/**
 * Adds a panel of any type by hand, with no AI involved. A button that opens a list of the panel types;
 * Escape or a click elsewhere closes it and focus goes back to the button.
 */
export function AddPanelMenu({ options, full, onAdd }: AddPanelMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrap.current && event.target instanceof Node && !wrap.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (option: AddPanelOption) => {
    if (!option.draft) return;
    onAdd(option);
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div
      ref={wrap}
      className={styles.addWrap}
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Button ref={button} icon="plus" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((value) => !value)}>
        Add panel
      </Button>
      {open ? (
        <div id={listId} className={styles.addMenu} role="group" aria-label="Panel types">
          {full ? (
            <p className={styles.addFull}>The workspace is full. Close a panel to add another.</p>
          ) : (
            <ul className={styles.addList}>
              {options.map((option) => (
                <li key={option.type}>
                  <button type="button" className={styles.addOption} aria-disabled={option.draft ? undefined : true} onClick={() => choose(option)}>
                    <span className={styles.addLabel}>{option.label}</span>
                    <span className={styles.addDescription}>{option.unavailable ?? option.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
