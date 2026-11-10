"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChangeEvent, County } from "@/lib/domain";
import { PANEL_SIZES } from "@/lib/panels";
import type { PanelSize, PanelSpec } from "@/lib/panels";
import type { StatFlag } from "@/lib/stats";
import { Panel } from "@/components/panels/Panel";
import { Button, Icon, IconButton, RemovableChip, Select, buttonAfterRemoval, useFocusAfterUpdate } from "@/components/ui";
import { FilterChipEditor } from "./FilterChipEditor";
import type { DragHandle } from "./Grid";
import { SIZE_LABELS, panelChips, removeChip } from "./model";
import styles from "./workspace.module.css";

/** The controls focus can be sent back to after the panel list changes. */
export type PanelControl = "handle" | "earlier" | "later";

interface WorkspacePanelProps {
  spec: PanelSpec;
  /** Place in the grid, from 0. */
  index: number;
  count: number;
  records: readonly StatFlag[];
  /** Every change, so a panel can find its own by id. */
  events: readonly ChangeEvent[];
  /** The changes this viewer can usefully pick in the editor. */
  offeredEvents: readonly ChangeEvent[];
  todayIso: string;
  /** The one county the viewer can see (a clerk's own), or null for everyone else. */
  viewerCounty: County | null;
  counties: readonly County[];
  months: readonly string[];
  minimized: boolean;
  /** True when the workspace holds as many panels as it can. */
  full: boolean;
  drag: DragHandle;
  /** A filter or setting changed. Local: the panel recomputes from the records already loaded. */
  onChange: (next: PanelSpec) => void;
  onMove: (delta: -1 | 1, control: PanelControl) => void;
  onResize: (size: PanelSize) => void;
  onMinimize: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}

const isSize = (value: string): value is PanelSize => (PANEL_SIZES as readonly string[]).includes(value);

/** A panel on the workspace grid: the shared Panel, plus the controls to filter, size, move and close it. */
export function WorkspacePanel({
  spec,
  index,
  count,
  records,
  events,
  offeredEvents,
  todayIso,
  viewerCounty,
  counties,
  months,
  minimized,
  full,
  drag,
  onChange,
  onMove,
  onResize,
  onMinimize,
  onDuplicate,
  onClose,
}: WorkspacePanelProps) {
  const [editing, setEditing] = useState(false);
  const editorId = useId();
  const chipList = useRef<HTMLUListElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const focusAfterUpdate = useFocusAfterUpdate();
  const chips = panelChips(spec, events);
  const removable = chips.filter((chip) => chip.removable);
  const first = index === 0;
  const last = index === count - 1;

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onMove(-1, "handle");
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onMove(1, "handle");
    }
  };

  return (
    <Panel
      spec={spec}
      records={records}
      events={events}
      todayIso={todayIso}
      viewerCounty={viewerCounty}
      minimized={minimized}
      lead={
        <button
          type="button"
          className={styles.handle}
          data-control="handle"
          data-dragging={drag.dragging}
          aria-label={`Reorder ${spec.title}. Drag, or press the arrow keys. Position ${index + 1} of ${count}.`}
          title="Drag to reorder, or use the arrow keys"
          onPointerDown={drag.onPointerDown}
          onKeyDown={onHandleKey}
        >
          <Icon name="grip" />
        </button>
      }
      actions={
        <>
          <IconButton
            icon={minimized ? "maximize" : "minimize"}
            label={minimized ? `Show ${spec.title}` : `Minimize ${spec.title}`}
            aria-expanded={!minimized}
            onClick={onMinimize}
          />
          <IconButton icon="close" label={`Close ${spec.title}`} onClick={onClose} />
        </>
      }
      toolbar={
        <div className={styles.panelTools}>
          <div className={styles.chipRow}>
            {chips.length > 0 ? (
              <ul ref={chipList} className={styles.chipList} aria-label={`Filters on ${spec.title}`}>
                {chips.map((chip) => (
                  <li key={chip.key}>
                    {chip.removable ? (
                      <RemovableChip
                        label={chip.label}
                        onRemove={() => {
                          onChange(removeChip(spec, chip.key, events));
                          // The chip is gone once this is drawn: land on the one that took its place.
                          const place = removable.indexOf(chip);
                          focusAfterUpdate(() => buttonAfterRemoval(chipList.current, place) ?? editButton.current);
                        }}
                      />
                    ) : (
                      <span className={styles.fixedChip}>{chip.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className={styles.noChips}>No filters</span>
            )}
            <Button
              ref={editButton}
              size="sm"
              variant="ghost"
              icon="filter"
              aria-expanded={editing}
              aria-controls={editing ? editorId : undefined}
              aria-label={`Edit filters: ${spec.title}`}
              onClick={() => setEditing((value) => !value)}
            >
              Edit filters
            </Button>
          </div>
          {editing ? (
            <div id={editorId}>
              <FilterChipEditor
                spec={spec}
                events={events}
                offeredEvents={offeredEvents}
                counties={counties}
                months={months}
                onChange={onChange}
                onDone={() => {
                  setEditing(false);
                  focusAfterUpdate(() => editButton.current);
                }}
              />
            </div>
          ) : null}
          <div className={styles.layoutTools} role="group" aria-label={`Layout of ${spec.title}`}>
            <IconButton
              icon="arrowLeft"
              size="sm"
              label={`Move earlier: ${spec.title}`}
              data-control="earlier"
              aria-disabled={first || undefined}
              onClick={() => {
                if (!first) onMove(-1, "earlier");
              }}
            />
            <IconButton
              icon="arrowRight"
              size="sm"
              label={`Move later: ${spec.title}`}
              data-control="later"
              aria-disabled={last || undefined}
              onClick={() => {
                if (!last) onMove(1, "later");
              }}
            />
            <Select
              compact
              hideLabel
              label={`Size of ${spec.title}`}
              className={styles.sizeSelect}
              value={spec.size}
              options={PANEL_SIZES.map((size) => ({ value: size, label: SIZE_LABELS[size] }))}
              onChange={(value) => {
                if (isSize(value)) onResize(value);
              }}
            />
            <IconButton
              icon="copy"
              size="sm"
              label={`Duplicate ${spec.title}`}
              aria-disabled={full || undefined}
              onClick={() => {
                if (!full) onDuplicate();
              }}
            />
          </div>
        </div>
      }
    />
  );
}
