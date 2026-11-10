import { requireSession } from "@/server/auth/session";
import { handle } from "@/server/http";
import { getRepository } from "@/server/repo";

// Imported rows that still need a person to choose the problem, with the raw reason.
export const GET = handle(async () => {
  const session = await requireSession(["clerk", "admin"]);
  const repo = await getRepository(session);
  return repo.listNeedsReview();
});
