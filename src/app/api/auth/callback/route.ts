import { homeFor, safeNextPath } from "@/components/shell/nav";
import { audit } from "@/server/audit";
import { sessionUserOf } from "@/server/auth/supabase";
import { clientAddress } from "@/server/clientAddress";
import { APP_MODE } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { currentRequestId, noteRequestUser } from "@/server/requestContext";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** The kinds of emailed link that sign a person in: a sign-in link, and an administrator's invitation. */
const LINK_TYPES = ["email", "magiclink", "invite"] as const;
type LinkType = (typeof LINK_TYPES)[number];

const isLinkType = (value: string | null): value is LinkType => LINK_TYPES.some((type) => type === value);

/**
 * Sends the browser to a path inside this app. The Location is relative on purpose: behind a reverse
 * proxy the request's own URL can carry an internal host name, and the browser resolves a relative
 * Location against the address the person actually used.
 */
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}

// Supabase mode only: where the emailed sign-in link lands. It trades the link's one-time code for a
// session (set as httpOnly cookies), then sends the person to the page they asked for or to their
// role's start page. Two link forms are accepted: ?code= (the link was opened in the browser that asked
// for it) and ?token_hash=&type= (the email template in supabase/templates, which works in any browser).
//
// A link that is used, expired or malformed goes back to /login?error=link. A person Supabase knows
// but who has no profile is signed out again and goes to /login?error=no_access: accounts are invite
// only, and signing in does not create one.
export const GET = handle(async ({ request, query }) => {
  if (APP_MODE !== "supabase") throw new HttpError(404, "Not found.");
  const address = clientAddress(request);
  await enforceRateLimit(address, "login");

  const code = query.get("code");
  const tokenHash = query.get("token_hash");
  const type = query.get("type");
  const supabase = await createSupabaseServerClient();

  let failure: string | null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failure = error ? (error.code ?? "exchange_failed") : null;
  } else if (tokenHash && isLinkType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failure = error ? (error.code ?? "verify_failed") : null;
  } else {
    failure = "malformed_link";
  }
  if (failure) {
    console.log(JSON.stringify({ level: "info", event: "sign_in_link_refused", requestId: currentRequestId(), reason: failure }));
    return redirectTo("/login?error=link");
  }

  const user = await sessionUserOf(supabase);
  if (!user) {
    await supabase.auth.signOut({ scope: "local" });
    console.log(JSON.stringify({ level: "info", event: "sign_in_without_profile", requestId: currentRequestId() }));
    return redirectTo("/login?error=no_access");
  }
  noteRequestUser(user.id);
  await audit(user, "auth.login", "session", null);
  return redirectTo(safeNextPath(query.get("next")) ?? homeFor(user.role));
});
