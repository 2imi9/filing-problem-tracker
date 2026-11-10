import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, homeFor, navFor, nextFromRedirectTarget, roleLabel, safeNextPath } from "@/components/shell/nav";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/components/shell/theme";

describe("navigation by role", () => {
  const hrefs = (role: "clerk" | "leader" | "admin") => navFor(role).map((item) => item.href);

  it("shows a clerk the tagging pages first, and no admin page", () => {
    expect(hrefs("clerk")).toEqual(["/log", "/import", "/dashboard", "/workspace", "/how-it-works"]);
  });

  it("shows a court leader only the pages a leader can use", () => {
    expect(hrefs("leader")).toEqual(["/dashboard", "/workspace", "/how-it-works"]);
  });

  it("shows an administrator everything", () => {
    expect(hrefs("admin")).toEqual(NAV_ITEMS.map((item) => item.href));
    expect(hrefs("admin")).toContain("/admin");
  });

  it("keeps the bottom tab bar labels to one short word", () => {
    for (const item of NAV_ITEMS) expect(item.shortLabel).toMatch(/^\S{1,9}$/);
  });

  it("lands clerks on Tag a filing and everyone else on the dashboard", () => {
    expect(homeFor("clerk")).toBe("/log");
    expect(homeFor("leader")).toBe("/dashboard");
    expect(homeFor("admin")).toBe("/dashboard");
  });

  it("describes a role in words", () => {
    expect(roleLabel("clerk", "Marion")).toBe("Clerk, Marion County");
    expect(roleLabel("leader", null)).toBe("Court leader");
    expect(roleLabel("admin", null)).toBe("Administrator");
  });
});

describe("safeNextPath", () => {
  it("accepts a path inside the app, with its query", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/workspace?folder=example-county-comparison")).toBe("/workspace?folder=example-county-comparison");
  });

  it.each([null, "", "dashboard", "https://example.com/", "//example.com", "/\\example.com", "/a\\b", "javascript:alert(1)"])(
    "refuses %j, which could leave the site",
    (value) => {
      expect(safeNextPath(value)).toBeNull();
    },
  );

  // A browser removes tabs and line breaks before it reads a URL, so "/<tab>/host" is "//host".
  it.each(["/\t/evil.example/phish", "/\n/evil.example/phish", "/\r/evil.example/phish", "/\r\n/evil.example", "/dash\tboard", "/\u0000/evil.example", "/a\u007fb"])(
    "refuses %j, which holds a control character",
    (value) => {
      expect(safeNextPath(value)).toBeNull();
    },
  );

  it("never returns a value that resolves to another site", () => {
    const base = "https://tracker.example.gov";
    for (const value of ["/\t/evil.example/phish", "/\n/evil.example", "/.//evil.example", "/x/..//evil.example", "/%09/evil.example", "/dashboard#//evil.example"]) {
      const safe = safeNextPath(value);
      if (safe !== null) expect(new URL(safe, base).origin).toBe(base);
    }
    expect(safeNextPath("/.//evil.example")).toBeNull();
    expect(safeNextPath("/x/..//evil.example")).toBeNull();
  });

  it("judges the path the browser would open, not the text as typed", () => {
    expect(safeNextPath("/x/../login")).toBeNull();
    expect(safeNextPath("/./login")).toBeNull();
    expect(safeNextPath("/login/")).toBeNull();
    expect(safeNextPath("/x/../api/demo/reset")).toBeNull();
    expect(safeNextPath("/./api/x")).toBeNull();
    expect(safeNextPath("/x/../dashboard?county=Lake#top")).toBe("/dashboard?county=Lake#top");
  });

  it("refuses the sign-in page and API routes", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=/log")).toBeNull();
    expect(safeNextPath("/api/demo/reset")).toBeNull();
  });
});

describe("theme start-up script", () => {
  it("reads the saved choice and accepts only light or dark", () => {
    expect(THEME_INIT_SCRIPT).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(THEME_INIT_SCRIPT).toContain('t==="light"||t==="dark"');
  });

  // A hash-based Content-Security-Policy must list this value. If the script changes, this test fails
  // and the policy has to be updated with the new hash.
  it("has the hash the Content-Security-Policy allows", () => {
    const hash = createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64");
    expect(`sha256-${hash}`).toBe("sha256-AzQdpg7uoJkNid+9v+wjMRvDZDgU6xgJ5Tcv6lhByV4=");
  });
});

describe("the page asked for, carried through the sign-in email", () => {
  const SITE = "https://tracker.example.gov";

  it("reads next from the address Supabase was told to return to", () => {
    expect(nextFromRedirectTarget(`${SITE}/api/auth/callback?next=%2Fadmin`)).toBe("/admin");
    expect(nextFromRedirectTarget(`${SITE}/api/auth/callback?next=%2Fdashboard%3Fcounty%3DLake`)).toBe("/dashboard?county=Lake");
  });

  it("is null when no page was asked for: an invitation, or a sign-in from the sign-in page itself", () => {
    expect(nextFromRedirectTarget(null)).toBeNull();
    expect(nextFromRedirectTarget("")).toBeNull();
    expect(nextFromRedirectTarget(SITE)).toBeNull();
    expect(nextFromRedirectTarget(`${SITE}/api/auth/callback`)).toBeNull();
    expect(nextFromRedirectTarget("not a url")).toBeNull();
  });

  it("uses nothing but a safe path inside this app, whatever the link was edited to say", () => {
    expect(nextFromRedirectTarget("https://evil.example/api/auth/callback?next=%2Fadmin")).toBe("/admin");
    for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example", "/.//evil.example", "/login", "/api/flags"]) {
      expect(nextFromRedirectTarget(`${SITE}/api/auth/callback?next=${encodeURIComponent(next)}`)).toBeNull();
    }
  });
});
