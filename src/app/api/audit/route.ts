import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { LIMITS } from "@/server/config";
import { handle } from "@/server/http";
import { getRepository } from "@/server/repo";

const Limit = z.coerce.number().int().min(1).max(LIMITS.auditMax);

// The audit log, newest first. Admins only. ?limit=1..500, default 100.
export const GET = handle(async ({ query }) => {
  const session = await requireSession(["admin"]);
  const raw = query.get("limit");
  const limit = raw === null ? LIMITS.auditDefault : Limit.parse(raw);
  const repo = await getRepository(session);
  return repo.listAudit(limit);
});
