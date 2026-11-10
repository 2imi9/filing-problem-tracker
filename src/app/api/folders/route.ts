import { FolderInput } from "@/lib/schemas";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// The caller's own workspace folders.
export const GET = handle(async () => {
  const session = await requireSession();
  const repo = await getRepository(session);
  return repo.listFolders();
});

// Saves a folder, or replaces the caller's folder with the given id.
export const POST = handle(async ({ json }) => {
  const session = await requireSession();
  await enforceRateLimit(session.id, "mutation");
  const input = FolderInput.parse(await json());
  const repo = await getRepository(session);
  const folder = await repo.saveFolder(input);
  await audit(session, "folder.save", "folder", folder.id, { panels: folder.panels.length, replaced: input.id !== undefined });
  return Response.json(folder, { status: input.id === undefined ? 201 : 200 });
});
