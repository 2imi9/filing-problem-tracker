import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { askWorkspace, resetDemoData, signInAs, workspacePanels } from "./helpers";

// A control that removes or replaces itself when used must hand keyboard focus on. Left alone, focus
// falls back to <body>: a screen reader loses its place and the next Tab starts from the top of the page.
// Every step here is done with the keyboard, the way the person affected would do it.

test.beforeEach(resetDemoData);

/** Activates a control the way a keyboard user does: focus is on it, then Enter. */
async function pressEnterOn(target: Locator): Promise<void> {
  await target.focus();
  await target.press("Enter");
}

const focusIsOnBody = (page: Page) => page.evaluate(() => document.activeElement === document.body);

async function openWorkspace(page: Page): Promise<void> {
  await signInAs(page, "demo-leader");
  await page.goto("/workspace");
  await expect(page.locator("#workspace-request")).toBeVisible();
}

test("workspace: an example request, a removed filter, Done and Undo each leave focus on a control", async ({ page }) => {
  await openWorkspace(page);
  const command = page.locator("#workspace-request");

  // An example chip is switched off while the request runs and gone once panels are open.
  await pressEnterOn(page.getByRole("button", { name: "Missing signatures in Marion small claims" }));
  await expect(workspacePanels(page)).toHaveCount(3);
  await expect(command).toBeFocused();

  // Removing a filter chip lands on the chip that took its place.
  const trend = workspacePanels(page).first();
  const filters = trend.getByRole("list", { name: /^Filters on / });
  await pressEnterOn(filters.getByRole("button", { name: "Small claims Remove filter" }));
  await expect(trend.getByRole("heading")).toHaveText("Missing signature by month: Marion");
  await expect(filters.getByRole("button", { name: /Remove filter$/ }).nth(1)).toBeFocused();
  // Removing the last chip in the row lands on the one before it.
  await page.keyboard.press("Enter");
  await expect(filters.getByRole("button", { name: /Remove filter$/ })).toHaveCount(1);
  await expect(filters.getByRole("button", { name: /Remove filter$/ })).toBeFocused();
  // With no chip left, focus goes to the button that opens the filters.
  await page.keyboard.press("Enter");
  const editFilters = trend.getByRole("button", { name: /^Edit filters/ });
  await expect(editFilters).toBeFocused();

  // Done closes the editor it sits in and returns to the button that opened it.
  await page.keyboard.press("Enter");
  await pressEnterOn(trend.getByRole("button", { name: "Done" }));
  await expect(trend.getByRole("button", { name: "Done" })).toHaveCount(0);
  await expect(editFilters).toBeFocused();

  // Undo leaves the page with the step it undoes.
  await pressEnterOn(workspacePanels(page).nth(1).getByRole("button", { name: /^Close / }));
  await expect(workspacePanels(page)).toHaveCount(2);
  await pressEnterOn(page.getByRole("button", { name: "Undo" }));
  await expect(workspacePanels(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(command).toBeFocused();
  expect(await focusIsOnBody(page)).toBe(false);
});

test("workspace folders: saving, renaming, cancelling and deleting each leave focus on a control", async ({ page }) => {
  await openWorkspace(page);
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);
  const saveCurrent = page.getByRole("button", { name: "Save current as folder" });

  // The button is replaced by the form: focus goes to its field.
  await pressEnterOn(saveCurrent);
  const name = page.getByLabel("Folder name");
  await expect(name).toBeFocused();
  // Cancel removes the form and gives focus back to the button.
  await pressEnterOn(page.getByRole("button", { name: "Cancel" }));
  await expect(saveCurrent).toBeFocused();

  // Saving does the same.
  await page.keyboard.press("Enter");
  await expect(name).toBeFocused();
  await page.keyboard.type("Signatures review");
  await page.keyboard.press("Enter");
  const folder = page.getByRole("button", { name: /^Open folder Signatures review / });
  await expect(folder).toBeVisible();
  await expect(saveCurrent).toBeFocused();

  // Rename: into the field, and back to the folder on Cancel and on Rename.
  await pressEnterOn(page.getByRole("button", { name: "Rename folder Signatures review" }));
  const newName = page.getByLabel("New name for Signatures review");
  await expect(newName).toBeFocused();
  await pressEnterOn(page.getByRole("button", { name: "Cancel" }));
  await expect(folder).toBeFocused();
  await pressEnterOn(page.getByRole("button", { name: "Rename folder Signatures review" }));
  await expect(newName).toBeFocused();
  await newName.fill("Marion review");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Open folder Marion review / })).toBeFocused();

  // Delete: the folder's own buttons are gone, so focus goes to the heading of the list.
  await pressEnterOn(page.getByRole("button", { name: "Delete folder Marion review" }));
  await pressEnterOn(page.getByRole("dialog").getByRole("button", { name: "Delete folder" }));
  await expect(page.getByRole("button", { name: /^Open folder Marion review / })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Folders" })).toBeFocused();
});

test("workspace: Undo is withdrawn once the panels have changed again, so it cannot discard that change", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: /^Open folder County comparison / }).click();
  await expect(workspacePanels(page)).toHaveCount(4);
  const undo = page.getByRole("button", { name: "Undo" });

  // Undo straight after a close puts the panel back.
  await workspacePanels(page).nth(3).getByRole("button", { name: /^Close / }).click();
  await expect(workspacePanels(page)).toHaveCount(3);
  await undo.click();
  await expect(workspacePanels(page)).toHaveCount(4);

  // Close it again, then resize another panel. Undo would now put the whole list back as it was
  // before the close, wiping the resize, so it is no longer offered.
  await workspacePanels(page).nth(3).getByRole("button", { name: /^Close / }).click();
  await expect(undo).toBeVisible();
  const heat = workspacePanels(page).nth(1);
  await expect(heat).toHaveAttribute("data-size", "l");
  await heat.getByLabel(/^Size of/).selectOption("s");
  await expect(heat).toHaveAttribute("data-size", "s");
  await expect(undo).toHaveCount(0);
  await expect(workspacePanels(page)).toHaveCount(3);

  // The same for a folder that was opened and then edited.
  await page.getByRole("button", { name: /^Open folder Marion small claims / }).click();
  await expect(undo).toBeVisible();
  const first = workspacePanels(page).first();
  await first.getByRole("button", { name: /^Edit filters/ }).click();
  await first.getByLabel("County", { exact: true }).selectOption("Lake");
  await expect(undo).toHaveCount(0);
});

test("dashboard: removing a filter chip and clearing the filters leave focus on a control", async ({ page }) => {
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  const filters = page.getByRole("region", { name: "Filters" });
  const county = filters.getByLabel("County");
  await county.selectOption("Marion");
  await filters.getByLabel("Case type").selectOption("Small claims");
  const chips = filters.getByRole("list", { name: "Active filters" }).getByRole("button");
  await expect(chips).toHaveCount(2);

  // The first chip goes: the one that was second is now in its place.
  await pressEnterOn(chips.first());
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toBeFocused();
  await expect(chips.first()).toHaveText(/Small claims/);
  // The last chip goes: the list is gone, so focus goes to the first filter.
  await page.keyboard.press("Enter");
  await expect(chips).toHaveCount(0);
  await expect(county).toBeFocused();

  await county.selectOption("Lake");
  await pressEnterOn(filters.getByRole("button", { name: "Clear all filters" }));
  await expect(chips).toHaveCount(0);
  await expect(county).toBeFocused();
  expect(await focusIsOnBody(page)).toBe(false);
});

test("import: discarding the preview and adding the rows leave focus on what comes next", async ({ page }) => {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/import");
  await page.getByRole("button", { name: "Fill with the made-up example" }).click();
  await page.getByRole("button", { name: "Sort into categories" }).click();

  await pressEnterOn(page.getByRole("button", { name: "Discard preview" }));
  await expect(page.getByRole("button", { name: "Discard preview" })).toHaveCount(0);
  await expect(page.getByLabel("CSV text")).toBeFocused();

  await page.getByRole("button", { name: "Sort into categories" }).click();
  await pressEnterOn(page.getByRole("button", { name: "Add 10 rows to the tracker" }));
  await expect(page.getByText("Added 10 rows.")).toBeVisible();
  // Focus is on the message that says what happened, which also holds the link to the dashboard.
  await expect(page.locator(":focus")).toContainText("Added 10 rows.");
  expect(await focusIsOnBody(page)).toBe(false);
});

test("admin: deleting a change leaves focus on the Delete button that took its place, and on the section once none are left", async ({ page }) => {
  await signInAs(page, "demo-admin");
  await page.goto("/admin");
  const deletes = page.getByRole("region", { name: "Changes on file" }).getByRole("button", { name: /^Delete/ });
  await expect(deletes).toHaveCount(3);
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Delete change" });
  const nameOf = (button: Locator) => button.evaluate((element) => element.textContent ?? "");

  // The first row goes: the row that was second is now first, and its Delete button has focus.
  const second = await nameOf(deletes.nth(1));
  await pressEnterOn(deletes.first());
  await pressEnterOn(confirm);
  await expect(deletes).toHaveCount(2);
  await expect(deletes.first()).toBeFocused();
  expect(await nameOf(deletes.first())).toBe(second);

  // The last row goes: nothing took its place, so focus goes to the row that is last now.
  await pressEnterOn(deletes.last());
  await pressEnterOn(confirm);
  await expect(deletes).toHaveCount(1);
  await expect(deletes.first()).toBeFocused();

  // The only row goes: the table is gone, and focus lands on the Changes section.
  await page.keyboard.press("Enter");
  await pressEnterOn(confirm);
  await expect(deletes).toHaveCount(0);
  await expect(page.getByText("No changes on file")).toBeVisible();
  await expect(page.getByRole("region", { name: /^Changes 0 on file$/ })).toBeFocused();
  expect(await focusIsOnBody(page)).toBe(false);

  // Cancelling leaves the row, and the dialog gives focus back to the button that opened it.
  await resetDemoData();
  await page.reload();
  await expect(deletes).toHaveCount(3);
  await pressEnterOn(deletes.nth(1));
  await pressEnterOn(page.getByRole("dialog").getByRole("button", { name: "Cancel" }));
  await expect(deletes).toHaveCount(3);
  await expect(deletes.nth(1)).toBeFocused();
});
