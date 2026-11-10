import type { OkResponse } from "@/lib/api";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { APP_MODE, DEMO_RESET_CLEARS_LIMITS } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit, resetRateLimits } from "@/server/ratelimit";
import { resetMemoryStore } from "@/server/repo/memory";

// Demo mode only: puts the data back to the sample data. Any signed-in demo user can do this; it is how
// a demo starts clean. It counts as a change like any other, and it leaves the rate limits alone: a reset
// that cleared them would let any demo account lift every limit, for everyone, as often as it liked.
// A test server sets DEMO_RESET_CLEARS_LIMITS=1 so that a long run of tests from one address starts each
// test with full allowances.
export const POST = handle(async (): Promise<OkResponse> => {
  if (APP_MODE !== "demo") throw new HttpError(404, "Not found.");
  const session = await requireSession();
  await enforceRateLimit(session.id, "mutation");
  resetMemoryStore();
  if (DEMO_RESET_CLEARS_LIMITS) await resetRateLimits();
  await audit(session, "demo.reset", "demo_data", null);
  return { ok: true };
});
