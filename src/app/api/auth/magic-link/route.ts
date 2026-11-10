import { createHash } from "node:crypto";
import { z } from "zod";
import type { OkResponse } from "@/lib/api";
import { safeNextPath } from "@/components/shell/nav";
import { clientAddress } from "@/server/clientAddress";
import { APP_MODE, APP_ORIGIN } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit, limit } from "@/server/ratelimit";
import { currentRequestId } from "@/server/requestContext";
import { createSupabaseServerClient } from "@/server/supabase/server";

const Body = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Enter an email address, like name@example.gov." }).max(254, { error: "That email address is too long." })),
  /** Where to go after signing in. Anything that is not a path inside this app is ignored. */
  next: z.string().max(512).optional(),
});

/** Sign-in emails one network address may ask for. Tighter than the general sign-in limit: each one sends mail. */
const PER_ADDRESS = { max: 10, windowMs: 10 * 60_000 };
/** Sign-in emails for one mailbox, whoever asks. */
const PER_EMAIL = { max: 3, windowMs: 10 * 60_000 };

// Supabase mode only: emails a sign-in link. Accounts are invite only, so no account is ever created
// here. The answer is the same whether or not the address has an account, whether or not a link was
// sent, and whether or not the mail provider accepted it, so the endpoint cannot be used to find out
// who has an account. What actually happened goes to the server log, without the address.
export const POST = handle(async ({ request, json }): Promise<OkResponse> => {
  if (APP_MODE !== "supabase") throw new HttpError(404, "Not found.");
  const address = clientAddress(request);
  await enforceRateLimit(address, "login");
  const { email, next } = Body.parse(await json());

  const perAddress = await limit(`magic-link:address:${address}`, PER_ADDRESS);
  if (!perAddress.ok) {
    throw new HttpError(429, `Too many sign-in emails were requested. Try again in ${perAddress.retryAfterSeconds} seconds.`, {
      headers: { "Retry-After": String(perAddress.retryAfterSeconds) },
    });
  }
  // Past the per-mailbox limit nothing is sent and the answer does not change. A refusal here would
  // let anyone block another person's sign-in by asking for links in their name, and the links already
  // sent still work.
  const mailbox = createHash("sha256").update(email).digest("hex");
  const perEmail = await limit(`magic-link:email:${mailbox}`, PER_EMAIL);

  let outcome = "skipped_mailbox_limit";
  if (perEmail.ok) {
    // The origin was already checked against the app's own by handle(), so it is safe to build the link from.
    const origin = APP_ORIGIN ?? request.headers.get("origin") ?? new URL(request.url).origin;
    const callback = new URL("/api/auth/callback", origin);
    const target = safeNextPath(next ?? null);
    if (target) callback.searchParams.set("next", target);

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: callback.toString() } });
    outcome = error ? `not_sent:${error.code ?? error.status ?? "unknown"}` : "sent";
  }
  console.log(JSON.stringify({ level: "info", event: "magic_link", requestId: currentRequestId(), outcome }));
  return { ok: true };
});
