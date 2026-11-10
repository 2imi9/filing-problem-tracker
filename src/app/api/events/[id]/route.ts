import type { OkResponse } from "@/lib/api";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// Removes a change. Admins only.
export const DELETE = handle<{ id: string }>(async ({ params }): Promise<OkResponse> => {
  const session = await requireSession(["admin"]);
  await enforceRateLimit(session.id, "mutation");
  const repo = await getRepository(session);
  await repo.deleteEvent(params.id);
  await audit(session, "event.delete", "event", params.id);
  return { ok: true };
});
