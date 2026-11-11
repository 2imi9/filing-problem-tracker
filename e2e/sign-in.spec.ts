import { expect, test } from "@playwright/test";
import { DEMO_USERS } from "@/lib/sample";
import { resetDemoData } from "./helpers";

test.beforeEach(resetDemoData);

const HOME: Record<string, { path: string; heading: string }> = {
  clerk: { path: "/log", heading: "Tag a filing" },
  leader: { path: "/dashboard", heading: "Dashboard" },
  admin: { path: "/dashboard", heading: "Dashboard" },
};

test.describe("sign in by role", () => {
  for (const user of DEMO_USERS) {
    test(`${user.label} lands on ${HOME[user.role].path}`, async ({ page }) => {
      await page.goto("/");
      // Nobody is signed in, so the front door is the sign-in page. It says it is a prototype too, once.
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toHaveCount(1);
      await expect(page.getByRole("banner").getByText("Prototype. All data is made up.")).toBeVisible();
      await expect(page.getByText("Prototype. All data is made up.")).toHaveCount(1);
      await page.getByRole("button", { name: user.label }).click();

      await expect(page).toHaveURL(new RegExp(`${HOME[user.role].path}$`));
      await expect(page.getByRole("heading", { level: 1, name: HOME[user.role].heading })).toBeVisible();
      // Said once, in the header.
      await expect(page.getByText("Prototype. All data is made up.")).toHaveCount(1);
      await expect(page.getByRole("banner").getByText("Prototype. All data is made up.")).toBeVisible();

      // The navigation offers what the role can use, and nothing else.
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Tag a filing" })).toHaveCount(user.role === "leader" ? 0 : 1);
      await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(user.role === "admin" ? 1 : 0);
    });
  }

  test("a signed-out visitor is sent to sign in, then on to the page they asked for", async ({ page }) => {
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/login\?next=%2Fworkspace$/);
    await page.getByRole("button", { name: "Court leader, all counties" }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
  });

  test("the page an emailed sign-in link opens says it is a prototype, once, in demo mode", async ({ page }) => {
    // A complete link: the page offers the button that finishes signing in.
    await page.goto("/auth/confirm?token_hash=0123456789abcdef&type=email");
    await expect(page.getByRole("heading", { level: 1, name: "Finish signing in" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Prototype. All data is made up.")).toBeVisible();
    await expect(page.getByText("Prototype. All data is made up.")).toHaveCount(1);
    // The same frame as the sign-in page: no tabs for someone who is not signed in.
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    // An incomplete link: the way back to the sign-in page, under the same line.
    await page.goto("/auth/confirm");
    await expect(page.getByRole("link", { name: "Go to the sign-in page" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Prototype. All data is made up.")).toBeVisible();
    await expect(page.getByText("Prototype. All data is made up.")).toHaveCount(1);
  });

  test("signing out returns to the sign-in page and ends the session", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Court leader, all counties" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: /Account: Court leader/ }).click();
    await page.getByRole("button", { name: "Sign out or switch role" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });
});
