import type { OkResponse } from "@/lib/api";
import { audit } from "@/server/audit";
import { endDemoSession, getSession } from "@/server/auth/session";
import { APP_MODE } from "@/server/config";
import { HttpError, handle } from "@/server/http";

// Demo mode only: signs out. Safe to call when nobody is signed in.
export const POST = handle(async (): Promise<OkResponse> => {
  if (APP_MODE !== "demo") throw new HttpError(404, "Not found.");
  const session = await getSession();
  await endDemoSession();
  if (session) await audit(session, "demo.logout", "session", null);
  return { ok: true };
});
