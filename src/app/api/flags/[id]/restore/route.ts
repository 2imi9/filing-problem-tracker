import type { OkResponse } from "@/lib/api";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// Undo of a soft delete.
export const POST = handle<{ id: string }>(async ({ params }): Promise<OkResponse> => {
  const session = await requireSession(["clerk", "admin"]);
  await enforceRateLimit(session.id, "mutation");
  const repo = await getRepository(session);
  await repo.restoreFlag(params.id);
  await audit(session, "flag.restore", "flag", params.id);
  return { ok: true };
});
