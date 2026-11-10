import { SummaryInput, buildSummaryAggregates, summarize } from "@/server/ai/summary";
import type { SummaryResult } from "@/server/ai/summary";
import { requireSession } from "@/server/auth/session";
import { appToday } from "@/server/clock";
import { APP_MODE } from "@/server/config";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// One Claude request of up to 30 seconds, retried at most once.
export const maxDuration = 90;

// The optional AI summary on the dashboard. The body names filters and, optionally, a change; it carries
// no numbers. The counts are worked out here from the records this user may see, and only those counts
// go to the model. The answer is `{ available: true, summary, source }` or `{ available: false, reason }`.
export const POST = handle(async ({ json }): Promise<SummaryResult> => {
  const session = await requireSession();
  await enforceRateLimit(session.id, "ai");
  const input = SummaryInput.parse(await json());

  const repo = await getRepository(session);
  const [flags, events] = await Promise.all([repo.listFlags(), repo.listEvents()]);
  // A clerk's records are one county's, and the summary has to say so.
  const viewerCounty = session.role === "clerk" ? session.county : null;
  return summarize(buildSummaryAggregates(input, flags, events, appToday(), APP_MODE, viewerCounty));
});
