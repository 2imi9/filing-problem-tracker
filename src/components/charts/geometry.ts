// Geometry for the SVG charts. Pure numbers in, pure numbers out.

import { daysInMonth } from "@/lib/time";

export interface PlotBox {
  /** The drawing area, in SVG user units. */
  left: number;
  top: number;
  width: number;
  height: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The top of the value axis: the smallest of 1, 2, 4, 5 or 10 times a power of ten that holds `max`. */
export function axisMax(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 4, 5, 10]) {
    if (max <= step * power) return step * power;
  }
  return 10 * power;
}

/** Evenly spaced values from 0 to `top` for the grid lines: whole numbers only, at most five. */
export function axisTicks(top: number): number[] {
  const divisions = [4, 5, 2, 1].find((count) => Number.isInteger(top / count)) ?? 1;
  return Array.from({ length: divisions + 1 }, (_, i) => (top / divisions) * i);
}

/** Each month gets an equal slot across the plot. This is the middle of slot `index`. */
export function slotX(index: number, count: number, box: PlotBox): number {
  if (count <= 0) return box.left;
  return round1(box.left + ((index + 0.5) * box.width) / count);
}

export function valueY(value: number, top: number, box: PlotBox): number {
  const share = top > 0 ? Math.min(1, Math.max(0, value / top)) : 0;
  return round1(box.top + box.height * (1 - share));
}

/**
 * Where a date falls across the month slots, or null when its month is not on the chart. The 1st is the
 * left edge of the month's slot, so the months before the date sit to its left.
 */
export function dateX(date: string, months: readonly string[], box: PlotBox): number | null {
  const index = months.indexOf(date.slice(0, 7));
  if (index < 0) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const into = (day - 1) / daysInMonth(year, month);
  return round1(box.left + ((index + into) * box.width) / months.length);
}

/** Show every nth month label so labels about `labelWidth` wide do not run into each other. */
export function labelStep(count: number, plotWidth: number, labelWidth: number): number {
  if (count <= 0 || plotWidth <= 0) return 1;
  return Math.max(1, Math.ceil((count * labelWidth) / plotWidth));
}

/** Shade step for a heat table cell: 0 for none, then 1 to 4 as the count nears `max`. */
export function heatStep(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!(value > 0) || !(max > 0)) return 0;
  const step = Math.ceil((value / max) * 4);
  return step >= 4 ? 4 : step <= 1 ? 1 : step === 2 ? 2 : 3;
}
