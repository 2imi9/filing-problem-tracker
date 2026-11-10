import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { apiPost, dashboardCount, dashboardTotal, resetDemoData, signInAs, visibleFlagCount } from "./helpers";

test.beforeEach(resetDemoData);

/** Opens Tag a filing as the Marion clerk and waits until the form can be used. */
async function openTagForm(page: Page): Promise<void> {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/log");
  await expect(page.getByRole("button", { name: "Save tags" })).toBeVisible();
}

test("a clerk tags a filing with the keyboard and the leader's total goes up by exactly one", async ({ page, browser }) => {
  // The leader's dashboard before.
  const leaderContext = await browser.newContext();
  const leader = await leaderContext.newPage();
  await signInAs(leader, "demo-leader");
  await leader.goto("/dashboard");
  const before = await dashboardTotal(leader);

  // The clerk: 1 and 3 choose two problems, Enter saves. No mouse.
  await openTagForm(page);
  await page.keyboard.press("1");
  await page.keyboard.press("3");
  await expect(page.getByRole("button", { name: /Missing signature/, pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Wrong county or court/, pressed: true })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(page.getByText(/Saved\. 2 problems logged in \d+ seconds?\./)).toBeVisible();
  // The form is ready for the next filing, and the entry is in the clerk's recent list.
  await expect(page.getByRole("button", { pressed: true, name: /Missing signature/ })).toHaveCount(0);
  const recent = page.getByRole("region", { name: /^Recent entries/ });
  await expect(recent.getByRole("list", { name: "Problems" }).getByRole("listitem")).toHaveText(["Missing signature", "Wrong county or court"]);

  // The leader's dashboard after.
  await leader.reload();
  await expect(dashboardCount(leader)).toContainText(`${before + 1} flagged filings`);
  expect(await dashboardTotal(leader)).toBe(before + 1);
  await leaderContext.close();
});

test("Undo on the saved message removes the entry again", async ({ page }) => {
  await openTagForm(page);
  const before = await visibleFlagCount(page);

  await page.keyboard.press("5");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Saved\. 1 problem logged/)).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before + 1);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Entry removed.")).toBeVisible();
  await expect(page.getByText("No entries yet")).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before);

  // And the removal can itself be taken back.
  await page.getByRole("button", { name: "Put back" }).click();
  await expect(page.getByText("Entry put back.")).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before + 1);
});

test("a note that looks like it holds personal data is refused, in the form and by the API", async ({ page }) => {
  await openTagForm(page);
  const before = await visibleFlagCount(page);
  const saves: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/flags") saves.push(request.url());
  });

  await page.keyboard.press("1");
  await page.getByLabel("Note").fill("Case 49D01-2401-SC-000123, call 317-555-0142");
  // The warning appears while typing, before anything is sent.
  await expect(page.getByText(/looks like it contains a case number and a phone number/).first()).toBeVisible();
  await page.getByRole("button", { name: "Save tags" }).click();

  const summary = page.getByRole("alert").filter({ hasText: "This entry was not saved" });
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(summary.getByRole("link", { name: /case number and a phone number/ })).toBeVisible();
  expect(saves).toEqual([]);
  expect(await visibleFlagCount(page)).toBe(before);

  // The server refuses the same note when the form is bypassed.
  const direct = await apiPost(page, "/api/flags", {
    date: "2026-10-30",
    county: "Marion",
    caseType: "Small claims",
    form: "Small claims notice of claim",
    tags: ["Missing signature"],
    outcome: "Rejected",
    note: "Case 49D01-2401-SC-000123, call 317-555-0142",
  });
  expect(direct.status()).toBe(422);
  const body = (await direct.json()) as { error: { code: string; findings: { kind: string }[] } };
  expect(body.error.code).toBe("personal_data");
  expect(body.error.findings.map((finding) => finding.kind).sort()).toEqual(["case_number", "phone"]);
  expect(await visibleFlagCount(page)).toBe(before);

  // Taking the personal data out lets the entry save.
  await page.getByLabel("Note").fill("second page was not signed");
  await page.getByRole("button", { name: "Save tags" }).click();
  await expect(page.getByText(/Saved\. 1 problem logged/)).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before + 1);
});

test("saving with no problem chosen shows what is missing and saves nothing", async ({ page }) => {
  await openTagForm(page);
  const before = await visibleFlagCount(page);
  await page.getByRole("button", { name: "Save tags" }).click();
  const summary = page.getByRole("alert").filter({ hasText: "This entry was not saved" });
  await expect(summary).toBeFocused();
  await expect(summary.getByRole("link", { name: "Choose at least one problem." })).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before);
});

test("Enter on an outcome chip chooses that outcome, and the entry is saved with it", async ({ page }) => {
  await openTagForm(page);
  const bodies: { outcome: string; tags: string[] }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/flags") bodies.push(request.postDataJSON() as { outcome: string; tags: string[] });
  });

  await page.keyboard.press("1");
  const fixed = page.getByRole("button", { name: "Fixed at counter" });
  await expect(fixed).toHaveAttribute("aria-pressed", "false");
  await fixed.focus();
  await page.keyboard.press("Enter");
  // Enter did what Enter does on a button: it chose the outcome. Nothing was saved behind the person's back.
  await expect(fixed).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Rejected", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(bodies).toEqual([]);

  await page.getByRole("button", { name: "Save tags" }).click();
  await expect(page.getByText(/Saved\. 1 problem logged/)).toBeVisible();
  expect(bodies).toEqual([expect.objectContaining({ outcome: "Fixed at counter", tags: ["Missing signature"] })]);
  const recent = page.getByRole("region", { name: /^Recent entries/ });
  await expect(recent.getByText("Fixed at counter")).toBeVisible();

  // On a problem chip Enter still saves, as the hint on that group says (Space chooses).
  await page.keyboard.press("2");
  await page.getByRole("button", { name: /Missing fee or fee waiver/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Saved\. 1 problem logged/).last()).toBeVisible();
  expect(bodies).toHaveLength(2);
});

test("the number keys work on the form only, say what they did, and can be turned off", async ({ page }) => {
  await openTagForm(page);
  const chip = (name: RegExp) => page.getByRole("button", { name });

  // Outside the entry (the menu, the header) a digit does nothing.
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Tag a filing" }).focus();
  await page.keyboard.press("5");
  await page.getByRole("button", { name: /^Switch to (dark|light) theme/ }).focus();
  await page.keyboard.press("6");
  await expect(chip(/Missing fee or fee waiver/)).toHaveAttribute("aria-pressed", "false");
  await expect(chip(/Citation not found or wrong/)).toHaveAttribute("aria-pressed", "false");

  // On the form it chooses the problem and says so to a screen reader, since focus does not move.
  await page.getByRole("button", { name: "Save tags" }).focus();
  await page.keyboard.press("1");
  await expect(chip(/Missing signature/)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Missing signature selected." })).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(chip(/Missing signature/)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("status").filter({ hasText: "Missing signature cleared." })).toHaveCount(1);

  // The switch turns the keys off, takes the key hints off the chips, and is remembered in this browser.
  const keys = page.getByLabel("Number-key shortcuts");
  await expect(keys).toBeChecked();
  await expect(page.getByText("Keyboard: press 1 to 9 to choose problems, then Enter to save.")).toBeVisible();
  await keys.uncheck();
  await expect(page.getByText("Keyboard: Space chooses a problem, Enter saves.")).toBeVisible();
  await page.getByRole("button", { name: "Save tags" }).focus();
  await page.keyboard.press("1");
  await page.keyboard.press("3");
  await expect(chip(/Missing signature/)).toHaveAttribute("aria-pressed", "false");
  await expect(chip(/Wrong county or court/)).toHaveAttribute("aria-pressed", "false");
  await expect(chip(/Missing signature/)).not.toHaveAttribute("aria-keyshortcuts", /./);

  await page.reload();
  await expect(page.getByRole("button", { name: "Save tags" })).toBeVisible();
  await expect(page.getByLabel("Number-key shortcuts")).not.toBeChecked();
  await page.keyboard.press("1");
  await expect(chip(/Missing signature/)).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Number-key shortcuts").check();
  await page.getByRole("button", { name: "Save tags" }).focus();
  await page.keyboard.press("1");
  await expect(chip(/Missing signature/)).toHaveAttribute("aria-pressed", "true");
});

test("the place where saved messages are announced is on the page before the first message", async ({ page }) => {
  await openTagForm(page);
  // A live region that only appears together with its first message is not reliably read out.
  const messages = page.getByRole("region", { name: "Messages" });
  await expect(messages).toHaveCount(1);
  await expect(messages).toHaveAttribute("aria-live", "polite");
  expect(await messages.evaluate((region) => getComputedStyle(region).display)).not.toBe("none");
  expect(await messages.evaluate((region) => region.childElementCount)).toBe(0);
  // Empty, it takes no room and does not widen the page.
  expect(await messages.evaluate((region) => region.getBoundingClientRect().height)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(messages.getByText(/Saved\. 1 problem logged/)).toBeVisible();
});

test("Undo, Put back and Remove do not drop keyboard focus onto nothing", async ({ page }) => {
  await openTagForm(page);
  const focusIsOnBody = () => page.evaluate(() => document.activeElement === document.body);

  await page.keyboard.press("5");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Saved\. 1 problem logged/)).toBeVisible();

  // Undo is inside a message that goes away when it is used.
  const undo = page.getByRole("button", { name: "Undo" });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Entry removed.")).toBeVisible();
  await expect(page.locator("#main")).toBeFocused();

  const putBack = page.getByRole("button", { name: "Put back" });
  await putBack.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Entry put back.")).toBeVisible();
  expect(await focusIsOnBody()).toBe(false);

  // Remove takes its own row out of the list of recent entries: focus stays with the list.
  const recent = page.getByRole("region", { name: /^Recent entries/ });
  const remove = recent.getByRole("button", { name: /^Remove\b/ });
  await expect(remove).toHaveCount(1);
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("No entries yet")).toBeVisible();
  await expect(recent).toBeFocused();
  expect(await focusIsOnBody()).toBe(false);
});
