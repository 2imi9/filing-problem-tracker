import type { OkResponse } from "@/lib/api";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// Deletes one of the caller's own folders.
export const DELETE = handle<{ id: string }>(async ({ params }): Promise<OkResponse> => {
  const session = await requireSession();
  await enforceRateLimit(session.id, "mutation");
  const repo = await getRepository(session);
  await repo.deleteFolder(params.id);
  await audit(session, "folder.delete", "folder", params.id);
  return { ok: true };
});
