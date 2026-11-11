import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { apiPost, dashboardCount, dashboardTotal, resetDemoData, signInAs, visibleFlagCount } from "./helpers";

test.beforeEach(resetDemoData);

/** Opens Tag a filing as the Marion clerk and waits until the form can be used. Nothing is chosen yet. */
async function openEmptyTagForm(page: Page): Promise<void> {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/log");
  await expect(page.getByRole("button", { name: "Save tags" })).toBeVisible();
}

/**
 * Chooses the case type and form of the filing, then puts focus back on the page. The dropdowns start
 * on "Select case type" and "Select form", and a key pressed while a dropdown has focus belongs to it.
 */
async function chooseFiling(page: Page, caseType = "Small claims", form = "Small claims notice of claim"): Promise<void> {
  await page.getByLabel("Case type").selectOption(caseType);
  await page.getByLabel("Form", { exact: true }).selectOption(form);
  await page.locator("#main").focus();
}

/** Opens Tag a filing as the Marion clerk with a small claims notice of claim chosen, ready for the problems. */
async function openTagForm(page: Page): Promise<void> {
  await openEmptyTagForm(page);
  await chooseFiling(page);
}

test("the dropdowns start on a general choice, and the form list follows the case type", async ({ page }) => {
  await openEmptyTagForm(page);
  const before = await visibleFlagCount(page);
  const saves: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/flags") saves.push(request.url());
  });
  const caseType = page.getByLabel("Case type");
  const form = page.getByLabel("Form", { exact: true });
  const chosen = (select: typeof caseType) => select.evaluate((element: HTMLSelectElement) => element.selectedOptions[0]?.textContent ?? "");

  // Nothing is chosen for the clerk, and there are no forms to pick from yet.
  await expect(caseType).toHaveValue("");
  expect(await chosen(caseType)).toBe("Select case type");
  await expect(form).toHaveValue("");
  expect(await chosen(form)).toBe("Select form");
  await expect(form).toBeDisabled();
  // The county comes from the account and cannot be changed here.
  const county = page.getByLabel("County");
  await expect(county).toHaveValue("Marion");
  await expect(county).not.toBeEditable();

  // Saving like this says what is missing and sends nothing.
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "Save tags" }).click();
  const summary = page.getByRole("alert").filter({ hasText: "This entry was not saved" });
  await expect(summary).toBeFocused();
  await expect(summary.getByRole("link", { name: "Choose a case type." })).toBeVisible();
  await expect(summary.getByRole("link", { name: "Choose a form." })).toHaveCount(0);
  // The link in the summary goes to the field it names.
  await summary.getByRole("link", { name: "Choose a case type." }).click();
  await expect(caseType).toBeFocused();
  expect(saves).toEqual([]);

  // A case type with one form chooses it.
  await caseType.selectOption("Eviction");
  await expect(form).toBeEnabled();
  await expect(form).toHaveValue("Tenant answer or request for hearing");
  // A case type with several leaves the choice to the clerk, and asks for it on Save.
  await caseType.selectOption("Small claims");
  await expect(form).toHaveValue("");
  await expect(form.getByRole("option")).toHaveText(["Select form", "Small claims notice of claim", "Small claims counterclaim"]);
  await page.getByRole("button", { name: "Save tags" }).click();
  await expect(summary.getByRole("link", { name: "Choose a form." })).toBeVisible();
  expect(saves).toEqual([]);
  expect(await visibleFlagCount(page)).toBe(before);

  // With both chosen the entry saves, and the two choices stay for the next filing of the same kind.
  await form.selectOption("Small claims counterclaim");
  await page.getByRole("button", { name: "Save tags" }).click();
  await expect(page.getByText(/Saved\. 1 problem logged/)).toBeVisible();
  expect(saves).toHaveLength(1);
  await expect(caseType).toHaveValue("Small claims");
  await expect(form).toHaveValue("Small claims counterclaim");
  await expect(page.getByRole("region", { name: /^Recent entries/ }).getByText("Small claims counterclaim", { exact: true })).toBeVisible();
});

test("a clerk tags a filing with the keyboard and the leader's total goes up by exactly one", async ({ page, browser }) => {
  // The leader's dashboard before.
  const leaderContext = await browser.newContext();
  const leader = await leaderContext.newPage();
  await signInAs(leader, "demo-leader");
  await leader.goto("/dashboard");
  const before = await dashboardTotal(leader);

  // The clerk: the case type and form from the dropdowns, 1 and 3 choose two problems, Enter saves. No mouse.
  await openEmptyTagForm(page);
  const caseType = page.getByLabel("Case type");
  await caseType.focus();
  // On a closed dropdown the arrow keys step through its choices: "Small claims" is the first one.
  await page.keyboard.press("ArrowDown");
  await expect(caseType).toHaveValue("Small claims");
  await page.keyboard.press("Tab");
  const form = page.getByLabel("Form", { exact: true });
  await expect(form).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(form).toHaveValue("Small claims notice of claim");
  // A digit typed on the dropdown is left to the dropdown. One Tab on, at the first problem, it chooses.
  await page.keyboard.press("1");
  await expect(page.getByRole("button", { name: /Missing signature/ })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Missing signature/ })).toBeFocused();
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
  // In the list the outcome is one short word, with the full name for a screen reader and on hover.
  await expect(recent.getByTitle("Fixed at counter")).toHaveText("Pass (Fixed at counter)");

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

  // Outside the entry (the tab bar and the controls at its end) a digit does nothing.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tag a filing" }).focus();
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

test("outcome labels in Recent entries: the dots line up, and each outline hugs its own word", async ({ page }) => {
  await signInAs(page, "demo-clerk-marion");
  // One entry for each outcome, with form names of different lengths.
  const entries = [
    { caseType: "Eviction", form: "Tenant answer or request for hearing", outcome: "Rejected" },
    { caseType: "Small claims", form: "Small claims counterclaim", outcome: "Returned to fix" },
    { caseType: "Name change", form: "Petition for change of name", outcome: "Fixed at counter" },
  ];
  for (const entry of entries) {
    const saved = await apiPost(page, "/api/flags", { date: "2026-10-30", county: "Marion", tags: ["Missing signature"], ...entry });
    expect(saved.status()).toBe(201);
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/log");
    const recent = page.getByRole("region", { name: /^Recent entries/ });
    await expect(recent.getByRole("list", { name: "Problems" })).toHaveCount(3);
    // The short word is what is drawn; the full name is there for a screen reader and on hover.
    await expect(recent.getByTitle("Rejected")).toHaveText("Reject (Rejected)");
    await expect(recent.getByTitle("Returned to fix")).toHaveText("Fix (Returned to fix)");
    await expect(recent.getByTitle("Fixed at counter")).toHaveText("Pass (Fixed at counter)");

    const measure = (title: string) =>
      recent.getByTitle(title).evaluate((label) => {
        const slot = label.parentElement as HTMLElement;
        const labelBox = label.getBoundingClientRect();
        const slotBox = slot.getBoundingClientRect();
        const dot = getComputedStyle(label, "::before");
        const style = getComputedStyle(label);
        return {
          slotLeft: slotBox.left,
          slotWidth: slotBox.width,
          labelLeft: labelBox.left,
          labelWidth: labelBox.width,
          // The dot is the first thing inside the outline, after its border and left padding.
          dotLeft: labelBox.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
          dotColor: dot.backgroundColor,
          dotWidth: dot.width,
          outline: style.borderTopColor,
        };
      });
    const reject = await measure("Rejected");
    const fix = await measure("Returned to fix");
    const pass = await measure("Fixed at counter");

    // Every label starts at the same left edge and has the same room kept for it, so the dots line up down the list.
    for (const label of [fix, pass]) {
      expect(label.slotLeft).toBe(reject.slotLeft);
      expect(label.slotWidth).toBe(reject.slotWidth);
      expect(label.labelLeft).toBe(reject.labelLeft);
      expect(label.dotLeft).toBe(reject.dotLeft);
    }
    expect(reject.slotWidth).toBeGreaterThan(0);
    // Each outline is as wide as its own word needs and no wider: "Fix" is the narrowest, "Reject" fills the room.
    expect(reject.labelWidth).toBe(reject.slotWidth);
    expect(pass.labelWidth).toBeLessThan(reject.labelWidth);
    expect(fix.labelWidth).toBeLessThan(pass.labelWidth);
    // One dot per label, a different color for each outcome, inside the same thin neutral outline.
    expect(new Set([reject.dotColor, fix.dotColor, pass.dotColor]).size).toBe(3);
    expect(new Set([reject.dotWidth, fix.dotWidth, pass.dotWidth])).toEqual(new Set(["9px"]));
    expect(new Set([reject.outline, fix.outline, pass.outline]).size).toBe(1);
  }
});
