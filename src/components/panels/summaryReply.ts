// Reading the reply of POST /api/ai/summary. The server writes the summary and checks its numbers; the
// page only decides whether there is text to show.

import type { Tag } from "@/lib/domain";
import type { DashboardFilters } from "./dashboardSpecs";

/** What the dashboard sends: its filters, and the change and problem picked in the before/after panel. */
export interface SummaryRequest {
  filters: DashboardFilters;
  eventId?: string;
  tag?: Tag;
}

export interface SummaryReply {
  /** The summary, or null when the server had none to give. */
  text: string | null;
  /** Why there is none, when the server said. */
  reason: string | null;
}

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export function summaryRequest(filters: DashboardFilters, eventId: string | null, tag: Tag | null): SummaryRequest {
  return { filters, ...(eventId ? { eventId } : {}), ...(eventId && tag ? { tag } : {}) };
}

/**
 * The summary text is `summary` (a string, or null when unavailable). A reply that is marked
 * unavailable, or carries no text, is "Summary unavailable"; `reason` or `notice` may say why.
 */
export function parseSummaryReply(body: unknown): SummaryReply {
  if (typeof body !== "object" || body === null) return { text: null, reason: null };
  const record = body as Record<string, unknown>;
  const reason = nonEmpty(record.reason) ?? nonEmpty(record.notice);
  if (record.available === false) return { text: null, reason };
  return { text: nonEmpty(record.summary), reason };
}
