import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { LIMITS } from "@/server/config";
import { handle } from "@/server/http";
import { getRepository } from "@/server/repo";

const Limit = z.coerce.number().int().min(1).max(LIMITS.recentMax);

// The caller's own latest entries, with notes. ?limit=1..50, default 10.
export const GET = handle(async ({ query }) => {
  const session = await requireSession();
  const raw = query.get("limit");
  const limit = raw === null ? LIMITS.recentDefault : Limit.parse(raw);
  const repo = await getRepository(session);
  return repo.listMyRecent(limit);
});
