import "server-only";
import type { SessionUser } from "@/lib/domain";
import { APP_MODE } from "../config";
import { createMemoryRepository } from "./memory";
import type { Repository } from "./types";

export type { Repository } from "./types";

/**
 * The repository for this user. Demo mode gets the in-memory one; Supabase mode loads the Supabase one
 * on first use, so demo deployments never load its code.
 */
export async function getRepository(session: SessionUser): Promise<Repository> {
  if (APP_MODE === "demo") return createMemoryRepository(session);
  const { createSupabaseRepository } = await import("./supabase");
  return createSupabaseRepository(session);
}
