import { z } from "zod";
import type { DemoLoginResponse } from "@/lib/api";
import { DEMO_USER_IDS, demoUserById } from "@/lib/sample";
import { audit } from "@/server/audit";
import { startDemoSession } from "@/server/auth/session";
import { clientAddress } from "@/server/clientAddress";
import { APP_MODE } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";

const Body = z.strictObject({ userId: z.enum(DEMO_USER_IDS, { error: "That demo account does not exist." }) });

// Demo mode only: signs in as one of the fixed demo accounts. In Supabase mode this route does not exist.
export const POST = handle(async ({ request, json }): Promise<DemoLoginResponse> => {
  if (APP_MODE !== "demo") throw new HttpError(404, "Not found.");
  const address = clientAddress(request);
  await enforceRateLimit(address, "login");
  const { userId } = Body.parse(await json());
  const user = demoUserById(userId);
  if (!user) throw new HttpError(400, "That demo account does not exist.");

  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  await startDemoSession(userId, proto === "https");
  await audit(user, "demo.login", "session", null);
  return { user };
});
