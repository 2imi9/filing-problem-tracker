import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { askWorkspace, resetDemoData, signInAs, workspacePanels } from "./helpers";

test.beforeEach(resetDemoData);

/** Records every request this page makes to the AI routes. */
function watchAiRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/ai/")) seen.push(`${request.method()} ${pathname}`);
  });
  return seen;
}

async function openWorkspace(page: Page): Promise<void> {
  await signInAs(page, "demo-leader");
  await page.goto("/workspace");
  await expect(page.locator("#workspace-request")).toBeVisible();
}

test("a request in words opens panels through the keyword fallback", async ({ page }) => {
  const ai = watchAiRequests(page);
  await openWorkspace(page);
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);

  // AI is off on this server, so the server matched keywords, and the page says so.
  await expect(page.getByText("3 panels opened, chosen by matching keywords in your request.")).toBeVisible();
  expect(ai).toEqual(["POST /api/ai/compose"]);

  const titles = workspacePanels(page).getByRole("heading");
  await expect(titles).toHaveText([
    "Missing signature by month: Marion, Small claims",
    "Most common problems: Marion, Small claims",
    "Key numbers: Marion, Small claims",
  ]);
  // The numbers are computed in the browser from the sample data: 101 flagged small claims filings in Marion.
  await expect(workspacePanels(page).nth(2)).toContainText("101 flagged filings.");
});

test("the other example requests open the panels they name", async ({ page }) => {
  await openWorkspace(page);
  await askWorkspace(page, "Compare Marion, Lake and Allen on wrong form", 1);
  await expect(workspacePanels(page).first().getByRole("heading")).toContainText("Marion, Lake and Allen");

  await page.locator("#workspace-request").fill("Did the revised small claims form reduce missing signatures?");
  await page.getByRole("button", { name: "Open panels" }).click();
  const beforeAfter = workspacePanels(page).filter({ hasText: "Revised small claims form" });
  await expect(beforeAfter).toHaveCount(1);
  // The same figures as the prototype: 4.0 a month before the change, 1.0 after.
  await expect(beforeAfter).toContainText("-75%");
});

test("editing a panel's filters by hand makes no request to the AI routes", async ({ page }) => {
  const ai = watchAiRequests(page);
  await openWorkspace(page);
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);
  await expect(page.getByText("Layout saved")).toBeVisible();
  expect(ai).toHaveLength(1);

  // Remove a filter chip: the panel recomputes and renames itself.
  const trend = workspacePanels(page).first();
  await trend.getByRole("button", { name: "Small claims Remove filter" }).click();
  await expect(trend.getByRole("heading")).toHaveText("Missing signature by month: Marion");
  await expect(trend).toContainText("Marion County, all case types, Missing signature, all months");

  // Change a filter in the editor.
  await trend.getByRole("button", { name: /^Edit filters/ }).click();
  await trend.getByLabel("County").selectOption("Lake");
  await expect(trend.getByRole("heading")).toHaveText("Missing signature by month: Lake");
  await expect(trend).toContainText("Lake County, all case types, Missing signature, all months");

  // Resize and reorder, which are layout changes only.
  await trend.getByLabel(/^Size of/).selectOption("l");
  await expect(trend).toHaveAttribute("data-size", "l");
  await trend.getByRole("button", { name: /^Move later/ }).click();
  await expect(workspacePanels(page).nth(1).getByRole("heading")).toHaveText("Missing signature by month: Lake");

  // The layout was saved again after the edits, so anything the edits triggered has been sent by now.
  await expect(page.getByText("Layout saved")).toBeVisible();
  expect(ai).toEqual(["POST /api/ai/compose"]);
});

test("the Add panel menu works with no AI at all", async ({ page }) => {
  const ai = watchAiRequests(page);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Add panel" }).click();
  await page.getByRole("group", { name: "Panel types" }).getByRole("button", { name: /County by problem/ }).click();
  await expect(workspacePanels(page)).toHaveCount(1);
  await expect(workspacePanels(page).first().getByRole("table")).toBeVisible();
  expect(ai).toEqual([]);
});

test("a set of panels is saved as a folder and reopened after a reload", async ({ page }) => {
  await openWorkspace(page);
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);

  await page.getByRole("button", { name: "Save current as folder" }).click();
  await page.getByLabel("Folder name").fill("Marion signatures review");
  await page.getByRole("button", { name: "Save folder" }).click();
  const folder = page.getByRole("button", { name: "Open folder Marion signatures review 3 panels" });
  await expect(folder).toBeVisible();
  await expect(page.getByText("Layout saved")).toBeVisible();

  // After a reload the open panels and the folder are both still there: they are kept on the server.
  await page.reload();
  await expect(workspacePanels(page)).toHaveCount(3);
  await expect(folder).toBeVisible();

  // Close everything, then reopen the folder.
  for (let remaining = 3; remaining > 0; remaining -= 1) {
    await workspacePanels(page).first().getByRole("button", { name: /^Close / }).click();
    await expect(workspacePanels(page)).toHaveCount(remaining - 1);
  }
  await folder.click();
  await expect(workspacePanels(page)).toHaveCount(3);
  await expect(page.getByText("Opened the folder Marion signatures review: 3 panels.")).toBeVisible();
  await expect(workspacePanels(page).getByRole("heading")).toHaveText([
    "Missing signature by month: Marion, Small claims",
    "Most common problems: Marion, Small claims",
    "Key numbers: Marion, Small claims",
  ]);
});

test("the three example folders ship with the sample data and open", async ({ page }) => {
  await openWorkspace(page);
  for (const name of ["Marion small claims", "Lake protective orders", "County comparison"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^Open folder ${name} \\d+ panels`) })).toBeVisible();
  }
  await page.getByRole("button", { name: /^Open folder County comparison / }).click();
  await expect(workspacePanels(page)).toHaveCount(4);
});

test("a deleted example folder stays deleted, also when it was the last folder", async ({ page }) => {
  await openWorkspace(page);
  for (const name of ["Marion small claims", "Lake protective orders", "County comparison"]) {
    await page.getByRole("button", { name: `Delete folder ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete folder" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^Open folder ${name} `) })).toHaveCount(0);
  }
  // The rail is empty. The examples are not listed again as folders that cannot be deleted.
  await expect(page.getByText("No folders yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open folder / })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#workspace-request")).toBeVisible();
  await expect(page.getByText("No folders yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open folder / })).toHaveCount(0);
});

test("dragging a panel by its handle moves it, says so, and the new order is kept", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);
  await expect(page.getByText("Layout saved")).toBeVisible();
  const titles = workspacePanels(page).getByRole("heading");
  const before = ["Missing signature by month: Marion, Small claims", "Most common problems: Marion, Small claims", "Key numbers: Marion, Small claims"];
  await expect(titles).toHaveText(before);
  const centerOf = async (index: number) => {
    const box = await workspacePanels(page).nth(index).boundingBox();
    if (!box) throw new Error("the panel is not on screen");
    return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 120) };
  };
  const handleOf = async (index: number) => {
    const box = await workspacePanels(page).nth(index).locator("[data-control=\"handle\"]").boundingBox();
    if (!box) throw new Error("the handle is not on screen");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // Pressing the handle and letting go without leaving the panel moves nothing and announces nothing.
  const start = await handleOf(0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 4, { steps: 3 });
  await page.mouse.up();
  await expect(titles).toHaveText(before);
  await expect(page.getByText("Panel dropped in its new place.")).toHaveCount(0);

  // Drag the first panel (wide) onto the small one beside it: while it is held the grid marks it as the
  // one being dragged, and the two trade places.
  const first = workspacePanels(page).first();
  const draggedId = await first.getAttribute("data-panel-id");
  const target = await centerOf(1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(first).toHaveAttribute("data-dragging", "true");
  await page.mouse.move(target.x, target.y, { steps: 20 });
  await page.mouse.up();

  const after = [before[1], before[0], before[2]];
  await expect(titles).toHaveText(after);
  await expect(page.locator("li[data-dragging=\"true\"]")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Panel dropped in its new place." })).toHaveCount(1);
  await expect(workspacePanels(page).nth(1)).toHaveAttribute("data-panel-id", draggedId ?? "");
  // The small panel is now first in its row and the wide one beside it; nothing sticks out sideways.
  expect((await workspacePanels(page).nth(1).boundingBox())?.y).toBe((await workspacePanels(page).first().boundingBox())?.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The order is part of the saved layout: the server holds it, and it is the same after a reload.
  await expect
    .poll(async () => {
      const folders = (await (await page.request.get("/api/folders")).json()) as { name: string; panels: { title: string }[] }[];
      return folders.find((folder) => folder.name === "__current")?.panels.map((panel) => panel.title);
    })
    .toEqual(after);
  await page.reload();
  await expect(workspacePanels(page)).toHaveCount(3);
  await expect(titles).toHaveText(after);
});
