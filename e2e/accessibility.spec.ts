import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { DemoUserId } from "@/lib/sample";
import { askWorkspace, resetDemoData, signInAs } from "./helpers";

test.beforeEach(resetDemoData);

interface Screen {
  name: string;
  path: string;
  /** Who is signed in, or null for a page that needs no session. */
  user: DemoUserId | null;
  /** Brings the page to the state to check, and returns once it is fully drawn. */
  ready: (page: Page) => Promise<void>;
}

/** Every page of the app, plus the states that put the most on screen. */
const SCREENS: Screen[] = [
  { name: "sign in", path: "/login", user: null, ready: async (page) => expect(page.getByRole("button", { name: "Administrator" })).toBeVisible() },
  {
    name: "finish signing in",
    path: "/auth/confirm?token_hash=0123456789abcdef&type=email",
    user: null,
    ready: async (page) => expect(page.getByRole("button", { name: "Sign in" })).toBeVisible(),
  },
  { name: "tag a filing", path: "/log", user: "demo-clerk-marion", ready: async (page) => expect(page.getByText("No entries yet")).toBeVisible() },
  {
    name: "tag a filing, with errors",
    path: "/log",
    user: "demo-clerk-marion",
    ready: async (page) => {
      await page.getByLabel("Note").fill("call 317-555-0142");
      await page.getByRole("button", { name: "Save tags" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "This entry was not saved" })).toBeVisible();
    },
  },
  { name: "import", path: "/import", user: "demo-clerk-marion", ready: async (page) => expect(page.getByText("Nothing is waiting for review")).toBeVisible() },
  {
    name: "import, with a preview",
    path: "/import",
    user: "demo-clerk-marion",
    ready: async (page) => {
      await page.getByRole("button", { name: "Fill with the made-up example" }).click();
      await page.getByRole("button", { name: "Sort into categories" }).click();
      await expect(page.getByRole("button", { name: "Add 10 rows to the tracker" })).toBeVisible();
    },
  },
  { name: "dashboard", path: "/dashboard", user: "demo-leader", ready: async (page) => expect(page.getByRole("heading", { name: "Before and after a change" })).toBeVisible() },
  { name: "dashboard, as a clerk", path: "/dashboard", user: "demo-clerk-lake", ready: async (page) => expect(page.getByText("You see Lake County only.")).toBeVisible() },
  { name: "workspace, empty", path: "/workspace", user: "demo-leader", ready: async (page) => expect(page.getByRole("button", { name: /^Open folder County comparison/ })).toBeVisible() },
  {
    name: "workspace, with panels",
    path: "/workspace",
    user: "demo-leader",
    ready: async (page) => {
      await expect(page.locator("#workspace-request")).toBeVisible();
      await askWorkspace(page, "Missing signatures in Marion small claims", 3);
      await page.getByRole("button", { name: /^Open folder County comparison/ }).click();
      await expect(page.getByText(/^Opened the folder County comparison/)).toBeVisible();
      await page.getByRole("button", { name: /^Edit filters/ }).first().click();
      await expect(page.getByText("Layout saved")).toBeVisible();
    },
  },
  { name: "how it's used", path: "/how-it-works", user: "demo-leader", ready: async (page) => expect(page.getByRole("heading", { name: "What the tracker does not do" })).toBeVisible() },
  { name: "admin", path: "/admin", user: "demo-admin", ready: async (page) => expect(page.getByRole("region", { name: "Audit log entries" })).toBeVisible() },
  { name: "admin, refused to a clerk", path: "/admin", user: "demo-clerk-marion", ready: async (page) => expect(page.getByText("This page is for administrators")).toBeVisible() },
  { name: "page not found", path: "/no/such/page", user: "demo-leader", ready: async (page) => expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible() },
];

async function open(page: Page, screen: Screen): Promise<void> {
  if (screen.user) await signInAs(page, screen.user);
  await page.goto(screen.path);
  await screen.ready(page);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility, ${colorScheme} theme`, () => {
    // Reduced motion: the checks look at the finished page, not at a toast or an outline part-way through fading.
    test.use({ colorScheme, reducedMotion: "reduce" });

    for (const screen of SCREENS) {
      test(`${screen.name}: axe finds no serious or critical issue`, async ({ page }) => {
        await open(page, screen);
        const results = await new AxeBuilder({ page }).analyze();
        const blocking = results.violations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .map((violation) => ({
            rule: violation.id,
            impact: violation.impact,
            help: violation.help,
            where: violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? ""}`),
          }));
        expect(blocking).toEqual([]);
      });
    }
  });
}

test.describe("at 375px wide", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  for (const screen of SCREENS) {
    test(`${screen.name}: the page does not scroll sideways`, async ({ page }) => {
      await open(page, screen);
      const { content, viewport } = await page.evaluate(() => ({
        content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        viewport: document.documentElement.clientWidth,
      }));
      expect(viewport).toBe(375);
      expect(content).toBeLessThanOrEqual(viewport);
    });
  }

  test("the navigation is a bottom tab bar, and every tab is at least 44px tall", async ({ page }) => {
    await signInAs(page, "demo-admin");
    await page.goto("/dashboard");
    const tabs = page.getByRole("navigation", { name: "Main" }).last().getByRole("link");
    await expect(tabs).toHaveCount(6);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
