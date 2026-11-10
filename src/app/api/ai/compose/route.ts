import { ComposeInput, composeWorkspace } from "@/server/ai/compose";
import type { ComposeResult } from "@/server/ai/compose";
import { requireSession } from "@/server/auth/session";
import { appToday } from "@/server/clock";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// One Claude request of up to 20 seconds, retried at most once.
export const maxDuration = 60;

// Turns a request typed into the workspace command bar into panels: `{ panels, notice?, source }`.
// With AI off, or when it fails or chooses nothing, the keyword matcher answers and `source` is "rules".
// Either way the panels hold filters only. Their numbers are counted in the browser from the records.
// A clerk's records hold one county, so a clerk is given panels for that county and its changes only.
export const POST = handle(async ({ json }): Promise<ComposeResult> => {
  const session = await requireSession();
  await enforceRateLimit(session.id, "ai");
  const { request } = ComposeInput.parse(await json());

  const repo = await getRepository(session);
  const [flags, events] = await Promise.all([repo.listFlags(), repo.listEvents()]);
  const viewerCounty = session.role === "clerk" ? session.county : null;
  return composeWorkspace(request, { flags, events, todayIso: appToday(), viewerCounty });
});
