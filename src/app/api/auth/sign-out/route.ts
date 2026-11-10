import type { OkResponse } from "@/lib/api";
import { audit } from "@/server/audit";
import { sessionUserOf } from "@/server/auth/supabase";
import { APP_MODE } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { currentRequestId, noteRequestUser } from "@/server/requestContext";
import { createSupabaseServerClient } from "@/server/supabase/server";

// Supabase mode only: signs out of this browser. Safe to call when nobody is signed in.
// "local" scope: the person's sessions on other devices are left alone.
//
// Removing the session cookies is the one thing this route must always do, so nothing before it may stop
// it. Finding out who is signing out and writing the audit entry both need Supabase to answer; when it
// does not, that is logged and the sign-out goes ahead without the entry. A person who pressed Sign out
// on a shared computer must never be left signed in because the database was slow.
export const POST = handle(async (): Promise<OkResponse> => {
  if (APP_MODE !== "supabase") throw new HttpError(404, "Not found.");
  const supabase = await createSupabaseServerClient();
  try {
    // The audit entry is written as the person, so it has to happen while they are still signed in.
    const user = await sessionUserOf(supabase);
    if (user) {
      noteRequestUser(user.id);
      await audit(user, "auth.logout", "session", null);
    }
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "sign_out_not_recorded", requestId: currentRequestId(), reason: error instanceof Error ? error.name : "unknown" }));
  }
  // Removes the cookies first, then asks the Auth server to revoke the refresh token.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    // The cookies are gone either way. Only revoking the refresh token on the server failed.
    console.error(JSON.stringify({ level: "error", event: "sign_out_revoke_failed", requestId: currentRequestId(), reason: error.code ?? error.name }));
  }
  return { ok: true };
});
