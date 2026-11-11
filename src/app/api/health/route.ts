import type { HealthResponse } from "@/lib/api";
import { AI_ENABLED, AI_MODEL, APP_MODE } from "@/server/config";
import { handle } from "@/server/http";

// No sign-in needed. Says the server is up, which mode it runs in, and whether AI is on (and with which
// model, so the sign-in page can say so in its footer).
export const GET = handle(async (): Promise<HealthResponse> => {
  return { ok: true, mode: APP_MODE, ai: AI_ENABLED, aiModel: AI_ENABLED ? AI_MODEL : null, time: new Date().toISOString() };
});
