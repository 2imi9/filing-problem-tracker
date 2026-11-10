"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { PanelSpec } from "@/lib/panels";
import { loneSmallPanels } from "./model";
import styles from "./workspace.module.css";

/** What a panel needs to offer dragging: put `onPointerDown` on its handle. */
export interface DragHandle {
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface GridProps {
  panels: readonly PanelSpec[];
  /** Ids of panels that were just added. They are outlined once. */
  fresh: ReadonlySet<string>;
  /** Called while dragging, when the dragged panel should take the place of another. */
  onReorder: (id: string, targetId: string) => void;
  /** Called once when a drag ends. `moved` is false when the panel was let go where it started. */
  onDragEnd: (moved: boolean) => void;
  renderPanel: (panel: PanelSpec, index: number, drag: DragHandle) => ReactNode;
}

/**
 * The panel grid: twelve columns, a panel spans 4 (small), 8 (wide) or 12 (full width), fewer on narrow
 * screens. When the grid is two panels wide, a small panel with no small neighbor takes the whole row. Dragging a panel's handle over another panel reorders them as you go. Dragging is never the
 * only way: every panel also has Move earlier and Move later buttons.
 */
export function Grid({ panels, fresh, onReorder, onDragEnd, renderPanel }: GridProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** The panel last swapped with. Stops two panels of different sizes trading places back and forth. */
  const lastTarget = useRef<string | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (draggingId === null) return;
    lastTarget.current = null;
    moved.current = false;
    const onMove = (event: PointerEvent) => {
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-panel-id]");
      const targetId = under?.dataset.panelId ?? null;
      if (targetId === null || targetId === draggingId) {
        lastTarget.current = null;
        return;
      }
      if (targetId === lastTarget.current) return;
      lastTarget.current = targetId;
      moved.current = true;
      onReorder(draggingId, targetId);
    };
    const end = () => {
      lastTarget.current = null;
      setDraggingId(null);
      onDragEnd(moved.current);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") end();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [draggingId, onReorder, onDragEnd]);

  const lone = loneSmallPanels(panels);

  return (
    <ol className={styles.grid} aria-label="Open panels" data-dragging={draggingId !== null}>
      {panels.map((panel, index) => (
        <li
          key={panel.id}
          className={styles.cell}
          data-panel-id={panel.id}
          data-size={panel.size}
          data-lone={lone.has(panel.id)}
          data-fresh={fresh.has(panel.id)}
          data-dragging={draggingId === panel.id}
        >
          {renderPanel(panel, index, {
            dragging: draggingId === panel.id,
            onPointerDown: (event) => {
              // Primary button, touch or pen only.
              if (event.button === 0) setDraggingId(panel.id);
            },
          })}
        </li>
      ))}
    </ol>
  );
}
