import "server-only";
import { isIP } from "node:net";
import { TRUSTED_PROXY_HOPS } from "./config";

// The network address a sign-in attempt is counted against.
//
// X-Forwarded-For is a list that every proxy on the way appends to, and the caller can put anything they
// like at the front of it. Only the entries added by proxies this deployment runs behind can be believed,
// and those are at the end. TRUSTED_PROXY_HOPS says how many there are: the address is the entry that
// many places from the right, the one the outermost trusted proxy wrote for whoever connected to it.

/** Everyone shares this bucket when no entry of the header can be trusted. */
export const SHARED_ADDRESS = "shared";

/**
 * The caller's address as the trusted proxies reported it, or SHARED_ADDRESS.
 *
 * With no trusted proxy (the default, right for a server reached directly) the header is whatever the
 * caller sent, so it is ignored and all callers are counted together: the limit still holds, and a caller
 * cannot pick the name of their own bucket. The same happens when the list is shorter than the number of
 * proxies claimed, or the entry is not an IP address.
 */
export function clientAddress(request: Request, hops: number = TRUSTED_PROXY_HOPS): string {
  if (hops < 1) return SHARED_ADDRESS;
  const entries = (request.headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim());
  const entry = entries[entries.length - hops];
  return entry !== undefined && isIP(entry) !== 0 ? entry.toLowerCase() : SHARED_ADDRESS;
}
