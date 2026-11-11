// Tells the page how tall a row pinned under the tab bar is, so nothing that takes keyboard focus ends
// up under it.
//
//   const row = useRef<HTMLElement>(null);
//   usePinnedRowHeight(row);
//   <section ref={row} className={styles.filterBar}>...</section>
//
// The dashboard's filters and the workspace's request row stay under the tab bar while the page scrolls
// (position: sticky, on screens with room for it). A control that takes focus is scrolled clear of the
// tab bar by the scroll margin set in globals.css; this adds the row's height to that margin for as long
// as the row is on the page and pinned. Where the row is not pinned (a phone, a short window) it adds
// nothing. One pinned row per page.

"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

/** Read by the scroll margin in globals.css. */
const PROPERTY = "--pinned-row-height";

/** `watch`: a value that changes when the row is drawn differently (a different class), to measure again. */
export function usePinnedRowHeight(row: RefObject<HTMLElement | null>, watch?: unknown): void {
  useEffect(() => {
    const node = row.current;
    if (!node) return;
    const root = document.documentElement;
    const measure = () => {
      if (getComputedStyle(node).position === "sticky") root.style.setProperty(PROPERTY, `${Math.ceil(node.getBoundingClientRect().height)}px`);
      else root.style.removeProperty(PROPERTY);
    };
    measure();
    // The row grows when its content wraps; whether it pins depends on the size of the window.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty(PROPERTY);
    };
  }, [row, watch]);
}
