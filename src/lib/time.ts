// Date and month helpers. Dates are plain strings (YYYY-MM-DD) and months are YYYY-MM, so they sort and
// compare as text. Nothing here reads the system clock: the caller passes "now" in.

import type { AppMode } from "./domain";
import { SAMPLE_TODAY } from "./sample";

/** The courts' calendar day is taken in Indianapolis time. */
export const APP_TIME_ZONE = "America/Indiana/Indianapolis";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The app's "today" as YYYY-MM-DD. In demo mode it is always SAMPLE_TODAY, so the sample data is never
 * stale. Otherwise it is the calendar day of `now` in Indianapolis time.
 */
export function todayIso(mode: AppMode, now: Date): string {
  if (mode === "demo") return SAMPLE_TODAY;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isMonth(value: string): boolean {
  return ISO_MONTH.test(value);
}

/** "2026-06-15" -> "2026-06". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `from` to `to`, both included. Empty when `from` is after `to`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** "2026-06" -> "Jun". */
export function monthShort(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** "2026-06" -> "Jun 2026". */
export function monthLabel(month: string): string {
  return `${monthShort(month)} ${month.slice(0, 4)}`;
}

/** "2026-06-01" -> "Jun 1, 2026". */
export function formatDate(date: string): string {
  return `${monthShort(date)} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}
