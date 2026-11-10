import type { OkResponse } from "@/lib/api";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// Soft delete: the caller's own entry within 5 minutes, or any entry for an admin.
export const DELETE = handle<{ id: string }>(async ({ params }): Promise<OkResponse> => {
  const session = await requireSession(["clerk", "admin"]);
  await enforceRateLimit(session.id, "mutation");
  const repo = await getRepository(session);
  await repo.softDeleteFlag(params.id);
  await audit(session, "flag.delete", "flag", params.id);
  return { ok: true };
});
