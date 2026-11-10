// The app's destinations and who sees them. Shared by the tab bar, the page that redirects by role, and
// the sign-in page. A tab's number is its place in navFor(role), counted from 1.

import type { Role } from "@/lib/domain";
import type { IconName } from "@/components/ui/Icon";

export interface NavItem {
  href: string;
  /** The tab's label, and the link's name. */
  label: string;
  /** One word, for a place too narrow for the label. The tab bar does not use it. */
  shortLabel: string;
  /** Not drawn in the tab bar, which shows the tab's number instead. */
  icon: IconName;
  roles: readonly Role[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/log", label: "Tag a filing", shortLabel: "Tag", icon: "tag", roles: ["clerk", "admin"] },
  { href: "/import", label: "Import", shortLabel: "Import", icon: "upload", roles: ["clerk", "admin"] },
  { href: "/dashboard", label: "Dashboard", shortLabel: "Dashboard", icon: "chart", roles: ["clerk", "leader", "admin"] },
  { href: "/workspace", label: "Workspace", shortLabel: "Workspace", icon: "grid", roles: ["clerk", "leader", "admin"] },
  { href: "/how-it-works", label: "How it's used", shortLabel: "Guide", icon: "book", roles: ["clerk", "leader", "admin"] },
  { href: "/admin", label: "Admin", shortLabel: "Admin", icon: "shield", roles: ["admin"] },
];

/** The destinations this role can use, in menu order. */
export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Where a person lands after signing in: clerks tag filings, everyone else reads the dashboard. */
export function homeFor(role: Role): string {
  return role === "clerk" ? "/log" : "/dashboard";
}

const ROLE_NAMES: Record<Role, string> = { clerk: "Clerk", leader: "Court leader", admin: "Administrator" };

/** "Clerk, Marion County", "Court leader", "Administrator". */
export function roleLabel(role: Role, county: string | null): string {
  return county ? `${ROLE_NAMES[role]}, ${county} County` : ROLE_NAMES[role];
}

// Never resolved by anything: it only gives the URL parser a base, so a value that names another host shows up as a different origin.
const PARSE_BASE = "http://internal.invalid";

/**
 * A path inside this app that is safe to send the browser to after sign-in, or null.
 *
 * Refuses anything that could leave the site ("//host", "/\host", a full URL), control characters
 * (a browser drops a tab or a line break before reading a URL, which turns "/<tab>/host" into "//host"),
 * the sign-in page and API routes. The value is checked by parsing it the way a browser would, and what
 * is returned is the parsed path, so "/x/../login" is judged as the "/login" it would open.
 */
export function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }
  // "/.//host" parses to the path "//host", which would name a host if it were returned.
  if (url.origin !== PARSE_BASE || url.pathname.startsWith("//")) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/login" || path === "/api" || path.startsWith("/api/")) return null;
  return url.pathname + url.search + url.hash;
}

/**
 * True for the pages a signed-out person can open: the sign-in page and the page an emailed sign-in
 * link lands on. They get the plain frame with no navigation, and no data is loaded on them.
 */
export function isSignInPath(pathname: string | null): boolean {
  return pathname === "/login" || (pathname ?? "").startsWith("/auth/");
}

/**
 * The page a person asked for before signing in by email, read from the emailed link.
 *
 * The sign-in email puts the address Supabase was told to return to (`{{ .RedirectTo }}`: this app's
 * callback, with `next` when a page was asked for) in the link's `redirect_to` parameter. An invitation
 * has no such page, and there the value is just the site's address, so the answer is null. Only the
 * `next` inside it is used, and only after safeNextPath has passed it: the rest of the value is ignored.
 */
export function nextFromRedirectTarget(redirectTo: string | null): string | null {
  if (!redirectTo) return null;
  let url: URL;
  try {
    url = new URL(redirectTo);
  } catch {
    return null;
  }
  return safeNextPath(url.searchParams.get("next"));
}
