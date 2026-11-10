"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * The rendered width of an element, kept up to date as it resizes. Charts draw at their real pixel
 * width so text stays a readable size on a phone. `initial` is used until the element is measured.
 */
export function useElementWidth<T extends HTMLElement>(initial: number): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = Math.round(entries[0]?.contentRect.width ?? 0);
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
