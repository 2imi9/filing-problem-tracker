import type { MeResponse } from "@/lib/api";
import { requireSession } from "@/server/auth/session";
import { appToday } from "@/server/clock";
import { AI_ENABLED, APP_MODE } from "@/server/config";
import { handle } from "@/server/http";

export const GET = handle(async (): Promise<MeResponse> => {
  const user = await requireSession();
  return { user, mode: APP_MODE, ai: AI_ENABLED, today: appToday() };
});
