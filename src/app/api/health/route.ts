import type { HealthResponse } from "@/lib/api";
import { AI_ENABLED, APP_MODE } from "@/server/config";
import { handle } from "@/server/http";

// No sign-in needed. Says the server is up and which mode it runs in.
export const GET = handle(async (): Promise<HealthResponse> => {
  return { ok: true, mode: APP_MODE, ai: AI_ENABLED, time: new Date().toISOString() };
});
