import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { DemoUserId } from "@/lib/sample";
import { askWorkspace, resetDemoData, signInAs } from "./helpers";

// The frame around every page: the navy header, the tab bar that pins to the top of the window, and the
// footer. There is no sidebar and no bar at the bottom of a phone screen.

test.beforeEach(resetDemoData);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

/** The tabs each role gets, in order. A tab's number is its place in this list. */
const TABS: { user: DemoUserId; home: string; tabs: string[] }[] = [
  { user: "demo-clerk-marion", home: "Tag a filing", tabs: ["Tag a filing", "Import", "Dashboard", "Workspace", "How it's used"] },
  { user: "demo-clerk-lake", home: "Tag a filing", tabs: ["Tag a filing", "Import", "Dashboard", "Workspace", "How it's used"] },
  { user: "demo-leader", home: "Dashboard", tabs: ["Dashboard", "Workspace", "How it's used"] },
  { user: "demo-admin", home: "Dashboard", tabs: ["Tag a filing", "Import", "Dashboard", "Workspace", "How it's used", "Admin"] },
];

const mainNav = (page: Page): Locator => page.getByRole("navigation", { name: "Main" });

/** Where the top edge of an element is in the window, and how tall it is. */
async function edges(target: Locator): Promise<{ top: number; bottom: number; left: number; right: number }> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  });
}

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** Scrolls the window and waits until it is there. */
async function scrollWindowTo(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), top);
  await expect.poll(() => scrollY(page)).toBe(top);
}

for (const { user, home, tabs } of TABS) {
  test(`${user}: the tab bar numbers the pages this role can open, 1 to ${tabs.length}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signInAs(page, user);
    await page.goto("/");
    const nav = mainNav(page);
    // One navigation, at the top. No sidebar beside the page and no second bar at the bottom.
    await expect(nav).toHaveCount(1);
    await expect(page.getByRole("navigation")).toHaveCount(1);
    await expect(page.getByRole("complementary")).toHaveCount(0);

    const links = nav.getByRole("link");
    // What is drawn: the number in its circle, then the label.
    await expect(links).toHaveText(tabs.map((label, index) => `${index + 1}${label}`));
    // What a screen reader says: the label alone. The list already gives the position.
    for (const [index, label] of tabs.entries()) await expect(links.nth(index)).toHaveAccessibleName(label);
    const numbers = nav.locator("a > span[aria-hidden='true']");
    await expect(numbers).toHaveText(tabs.map((_, index) => String(index + 1)));

    // The tab of the page that is open is marked, in words for a screen reader and by a filled circle.
    const current = nav.locator("a[aria-current='page']");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName(home);
    const fills = await numbers.evaluateAll((circles) =>
      circles.map((circle) => ({ round: getComputedStyle(circle).borderRadius, filled: getComputedStyle(circle).backgroundColor !== "rgba(0, 0, 0, 0)", current: circle.closest("a")?.getAttribute("aria-current") === "page" })),
    );
    for (const circle of fills) {
      expect(circle.round).toBe("50%");
      expect(circle.filled).toBe(circle.current);
    }

    // Tabs sit in one row, and the theme switch and the account menu are at the right end of the same bar.
    const tops = await links.evaluateAll((tabLinks) => tabLinks.map((link) => Math.round(link.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const lastTab = await edges(links.last());
    const theme = nav.getByRole("button", { name: /^Switch to (dark|light) theme$/ });
    const account = nav.getByRole("button", { name: /^Account: / });
    await expect(theme).toBeVisible();
    await expect(account).toBeVisible();
    expect((await edges(theme)).left).toBeGreaterThanOrEqual(lastTab.right);
    expect((await edges(account)).left).toBeGreaterThanOrEqual((await edges(theme)).right);
  });
}

test("the tab bar stays at the top of the window while the page scrolls, and a new page starts under it", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Before and after a change" })).toBeVisible();
  const nav = mainNav(page);
  const header = page.getByRole("banner");
  const title = header.getByText("Filing Problem Tracker", { exact: true });

  // A fresh load starts at the header, with the tab bar under it.
  expect(await scrollY(page)).toBe(0);
  await expect(title).toBeInViewport();
  const headerHeight = Math.round((await edges(header)).bottom);
  expect(headerHeight).toBeGreaterThan(100);
  expect(Math.round((await edges(nav)).top)).toBe(headerHeight);
  expect(await nav.evaluate((bar) => getComputedStyle(bar).position)).toBe("sticky");

  // Scrolled well past the header, the bar is at the top edge of the window and its tabs can be used.
  await scrollWindowTo(page, headerHeight + 900);
  expect(Math.round((await edges(nav)).top)).toBe(0);
  await expect(title).not.toBeInViewport();
  const workspaceTab = nav.getByRole("link", { name: "Workspace" });
  await expect(workspaceTab).toBeInViewport();
  const barHeight = Math.round((await edges(nav)).bottom);

  // Changing page from there keeps the bar where it is and starts the new page at its first line.
  await workspaceTab.click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator("#workspace-request")).toBeVisible();
  await expect.poll(() => scrollY(page)).toBe(headerHeight);
  expect(Math.round((await edges(nav)).top)).toBe(0);
  expect(Math.round((await edges(page.locator("#main"))).top)).toBe(barHeight);
  await expect(nav.locator("a[aria-current='page']")).toHaveAccessibleName("Workspace");

  // With the header in view, changing page leaves the window where it is.
  await scrollWindowTo(page, 0);
  await nav.getByRole("link", { name: "How it's used" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page.getByRole("heading", { name: "What the tracker does not do" })).toBeVisible();
  expect(await scrollY(page)).toBe(0);
  await expect(title).toBeInViewport();
});

/** Presses Shift+Tab until focus is on the control with this accessible name in the tab bar, checking after every press that the page has not moved. */
async function shiftTabToBarControl(page: Page, name: string, expectedScroll: number): Promise<void> {
  const target = mainNav(page).getByRole("link", { name, exact: true });
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("nav[aria-label='Main']") !== null)).toBe(true);
    expect(await scrollY(page)).toBe(expectedScroll);
    expect(Math.round((await edges(mainNav(page))).top)).toBe(0);
    if (await target.evaluate((link) => link === document.activeElement)) return;
  }
  throw new Error(`Shift+Tab never reached the "${name}" tab`);
}

for (const size of [DESKTOP, PHONE]) {
  test(`at ${size.width}px, keyboard focus moving into the pinned tab bar leaves the page where it is, and Enter on a tab starts the new page under the bar`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAs(page, "demo-leader");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Before and after a change" })).toBeVisible();
    const nav = mainNav(page);
    const headerHeight = Math.round((await edges(page.getByRole("banner"))).bottom);

    // Focus is on the first control of the page, and the person has read on well past the header.
    await page.locator("#main select").first().evaluate((select: HTMLElement) => select.focus({ preventScroll: true }));
    const readingAt = headerHeight + 900;
    await scrollWindowTo(page, readingAt);
    expect(Math.round((await edges(nav)).top)).toBe(0);

    // Back into the bar with the keyboard: account menu, theme switch, then the tabs. The page stays put.
    await shiftTabToBarControl(page, "Workspace", readingAt);
    const barHeight = Math.round((await edges(nav)).bottom);

    // Enter on the tab: the new page starts at its first line, with the bar still at the top of the window.
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.locator("#workspace-request")).toBeVisible();
    await expect.poll(() => scrollY(page)).toBe(headerHeight);
    expect(Math.round((await edges(nav)).top)).toBe(0);
    expect(Math.round((await edges(page.locator("#main"))).top)).toBe(barHeight);
  });
}

/**
 * From the bottom of the page, Shift+Tab walks back up through every control in the page's content.
 * Whatever takes focus must be clear of the pinned tab bar, and of the row pinned under it (`pinnedRow`,
 * a selector) while that row is pinned. Returns how many controls were checked and the ones found covered.
 */
async function walkBackUp(page: Page, pinnedRow: string): Promise<{ checked: number; covered: string[] }> {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>("#main button, #main select, #main a[href], #main input, #main [tabindex='0']");
    controls[controls.length - 1]?.focus();
  });
  const covered: string[] = [];
  let checked = 0;
  for (let step = 0; step < 150; step += 1) {
    const state = await page.evaluate((rowSelector) => {
      const active = document.activeElement as HTMLElement | null;
      const bar = document.querySelector("nav[aria-label='Main']");
      const row = document.querySelector(rowSelector);
      if (!active || !bar || !row) return null;
      const box = active.getBoundingClientRect();
      const barBox = bar.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        name: `${active.tagName.toLowerCase()} "${(active.getAttribute("aria-label") ?? active.textContent ?? "").trim().slice(0, 40)}"`,
        inMain: active.closest("#main") !== null && active.id !== "main",
        inRow: row.contains(active),
        top: box.top,
        height: box.height,
        barPinned: barBox.top === 0,
        barBottom: barBox.bottom,
        // The row is pinned when it is sticky and sits right under the bar.
        rowPinned: getComputedStyle(row).position === "sticky" && barBox.top === 0 && Math.abs(rowBox.top - barBox.bottom) < 1.5,
        rowBottom: rowBox.bottom,
      };
    }, pinnedRow);
    if (!state || !state.inMain) break;
    if (state.height > 0 && !state.inRow && state.barPinned) {
      checked += 1;
      const limit = state.rowPinned ? state.rowBottom : state.barBottom;
      if (state.top < limit - 0.5) covered.push(`${state.name}: top ${Math.round(state.top)}, covered down to ${Math.round(limit)}`);
    }
    await page.keyboard.press("Shift+Tab");
  }
  return { checked, covered };
}

test("dashboard: nothing that takes keyboard focus ends up under the pinned tab bar or the filters pinned below it", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Before and after a change" })).toBeVisible();
  const filters = page.getByRole("region", { name: "Filters" });
  expect(await filters.evaluate((row) => getComputedStyle(row).position)).toBe("sticky");
  const { checked, covered } = await walkBackUp(page, "section[aria-label='Filters']");
  expect(covered).toEqual([]);
  expect(checked).toBeGreaterThan(3);

  // Focus moving along the pinned filters themselves does not move the page.
  await filters.getByLabel("County").evaluate((select: HTMLElement) => select.focus({ preventScroll: true }));
  await scrollWindowTo(page, 1500);
  for (const label of ["Case type", "From", "To"]) {
    await page.keyboard.press("Tab");
    await expect(filters.getByLabel(label, { exact: true })).toBeFocused();
    expect(await scrollY(page)).toBe(1500);
  }
});

test("workspace: nothing that takes keyboard focus ends up under the pinned tab bar or the request row pinned below it", async ({ page }) => {
  // A small laptop: the request row pins, and the status line with Undo sits right under it.
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAs(page, "demo-leader");
  await page.goto("/workspace");
  await expect(page.locator("#workspace-request")).toBeVisible();
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);
  // Closing a panel with the keyboard brings up Undo in the status line.
  const close = page.getByRole("button", { name: /^Close / }).last();
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  const row = page.getByRole("region", { name: "Ask for panels" });
  expect(await row.evaluate((section) => getComputedStyle(section).position)).toBe("sticky");

  const { checked, covered } = await walkBackUp(page, "section[aria-label='Ask for panels']");
  expect(covered).toEqual([]);
  expect(checked).toBeGreaterThan(10);

  // Focus moving along the pinned row itself does not move the page.
  await page.locator("#workspace-request").evaluate((input: HTMLElement) => input.focus({ preventScroll: true }));
  const headerHeight = Math.round((await edges(page.getByRole("banner"))).bottom);
  await scrollWindowTo(page, headerHeight + 300);
  await page.keyboard.press("Tab");
  await expect(row.getByRole("button", { name: "Open panels" })).toBeFocused();
  expect(await scrollY(page)).toBe(headerHeight + 300);
  await page.keyboard.press("Tab");
  await expect(row.getByRole("button", { name: "Add panel" })).toBeFocused();
  expect(await scrollY(page)).toBe(headerHeight + 300);
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test("the tabs stay in one row that scrolls sideways inside the bar, and the bar still pins", async ({ page }) => {
    await signInAs(page, "demo-admin");
    await page.goto("/admin");
    await expect(page.getByRole("region", { name: "Audit log entries" })).toBeVisible();
    const nav = mainNav(page);
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(6);
    // The full labels, not shortened ones, and never wrapped onto a second row.
    await expect(links).toHaveText(["1Tag a filing", "2Import", "3Dashboard", "4Workspace", "5How it's used", "6Admin"]);
    const tops = await links.evaluateAll((tabLinks) => tabLinks.map((link) => Math.round(link.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const row = nav.getByRole("list");
    const sizes = await row.evaluate((list) => ({ content: list.scrollWidth, box: list.clientWidth, overflow: getComputedStyle(list).overflowX }));
    expect(sizes.content).toBeGreaterThan(sizes.box);
    expect(sizes.overflow).toBe("auto");
    // The row scrolls; the page does not.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The tab of the open page (the last one here) is brought into view inside the row.
    const rowBox = await edges(row);
    const within = async (tab: Locator) => {
      const box = await edges(tab);
      return box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1;
    };
    await expect.poll(() => within(nav.locator("a[aria-current='page']"))).toBe(true);
    // A tab that is out of view comes into view when it takes keyboard focus.
    const first = links.first();
    expect(await within(first)).toBe(false);
    await first.focus();
    await expect.poll(() => within(first)).toBe(true);
    // The theme switch and the account menu stay in reach at the right end.
    await expect(nav.getByRole("button", { name: /^Account: / })).toBeInViewport();
    await expect(nav.getByRole("button", { name: /^Switch to (dark|light) theme$/ })).toBeInViewport();

    // No bar at the bottom of the screen: the only fixed or sticky bar is the one at the top.
    const headerHeight = Math.round((await edges(page.getByRole("banner"))).bottom);
    await scrollWindowTo(page, headerHeight + 300);
    const pinned = await edges(nav);
    expect(Math.round(pinned.top)).toBe(0);
    expect(pinned.bottom).toBeLessThan(PHONE.height / 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("header and footer", () => {
  const FOOTER =
    "Student prototype for CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts. Counties are real; every number and entry is made up. This tool does not give legal advice. AI use: none on this copy. Import sorts with keyword rules, and every number is counted by code.";

  test("signed in: the product name with the courthouse mark, the prototype line once, and the footer says where AI is used", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signInAs(page, "demo-clerk-marion");
    await page.goto("/log");
    await expect(page.getByRole("button", { name: "Save tags" })).toBeVisible();
    const header = page.getByRole("banner");
    await expect(header.getByText("Filing Problem Tracker", { exact: true })).toBeVisible();
    await expect(header.getByText("See why court filings from people without lawyers get rejected, and whether fixes work.")).toBeVisible();
    // The mark is the project's own drawing, for the eye only.
    await expect(header.locator("svg[aria-hidden='true']")).toHaveCount(1);
    await expect(page.getByText("Prototype. All data is made up.")).toHaveCount(1);
    await expect(header.getByText("Prototype. All data is made up.")).toBeVisible();
    // The page's own name is its one h1.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tag a filing");
    // AI is off on this server, and the footer says so in plain words.
    await expect(page.getByRole("contentinfo")).toHaveText(FOOTER);
  });

  test("the sign-in page has the same header and footer, and no tabs", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Administrator" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Filing Problem Tracker", { exact: true })).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Switch to (dark|light) theme$/ })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toHaveText(FOOTER);
  });

  for (const path of ["/login", "/auth/confirm"]) {
    test(`${path}: no bar under the header; the theme switch is at the right end of the footer`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const header = page.getByRole("banner");
      // The header is the navy band and nothing else: no row under it that looks like an empty tab bar.
      await expect(header.getByRole("button")).toHaveCount(0);
      const band = await edges(header.getByText("Filing Problem Tracker", { exact: true }).locator("xpath=ancestor::div[2]"));
      expect(Math.round((await edges(header)).bottom)).toBe(Math.round(band.bottom));
      expect(Math.round((await edges(page.locator("#main"))).top)).toBe(Math.round(band.bottom));

      const footer = page.getByRole("contentinfo");
      const theme = footer.getByRole("button", { name: /^Switch to (dark|light) theme$/ });
      await expect(theme).toBeVisible();
      await expect(page.getByRole("button", { name: /^Switch to (dark|light) theme$/ })).toHaveCount(1);
      // Beside the text, not on a row of its own, and it still works.
      const text = await edges(footer.locator("p"));
      const button = await edges(theme);
      expect(button.left).toBeGreaterThanOrEqual(text.right);
      expect(button.top).toBeLessThan(text.bottom);
      expect(button.bottom).toBeGreaterThan(text.top);
      await theme.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(footer.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
    });
  }
});
