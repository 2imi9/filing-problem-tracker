import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { askWorkspace, resetDemoData, signInAs, workspacePanels } from "./helpers";

// Layout rules that only show at a given screen width, measured in the browser.

test.beforeEach(resetDemoData);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

/** A rejection export with `count` rows, all for Marion County, with nothing personal in it. */
function exportOf(count: number): string {
  const reasons = ["no signature on page 2", "filed on the wrong form for this claim", "fee waiver was not attached to the petition", "called filer - will bring in tomorrow"];
  const rows = Array.from({ length: count }, (_, index) => `2026-09-${String((index % 28) + 1).padStart(2, "0")},Marion,Small claims,Small claims notice of claim,${reasons[index % reasons.length]}`);
  return ["date,county,case_type,form,reason", ...rows].join("\n");
}

async function previewImport(page: Page, rows: number): Promise<void> {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/import");
  await page.getByLabel("CSV text").fill(exportOf(rows));
  await page.getByRole("button", { name: "Sort into categories" }).click();
  await expect(page.getByRole("button", { name: `Add ${rows} rows to the tracker` })).toBeVisible();
}

test("workspace at 1440px: Small, Wide and Full width are three different widths", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signInAs(page, "demo-leader");
  await page.goto("/workspace");
  await expect(page.locator("#workspace-request")).toBeVisible();
  // Opens a wide, a small and a wide panel.
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);
  const widthOf = async (index: number) => (await workspacePanels(page).nth(index).boundingBox())?.width ?? 0;

  const first = workspacePanels(page).first();
  await expect(first).toHaveAttribute("data-size", "w");
  const wide = await widthOf(0);
  // Wide and small share a row: a small panel sits beside the wide one instead of taking a row of its own.
  await expect(workspacePanels(page).nth(1)).toHaveAttribute("data-size", "s");
  const small = await widthOf(1);
  expect(small).toBeLessThan(wide * 0.6);
  expect((await workspacePanels(page).nth(1).boundingBox())?.y).toBe((await first.boundingBox())?.y);

  await first.getByLabel(/^Size of/).selectOption("l");
  await expect(first).toHaveAttribute("data-size", "l");
  const full = await widthOf(0);
  expect(full).toBeGreaterThan(wide * 1.3);
  // Nothing sticks out sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const width of [375, 320]) {
  test(`workspace at ${width}px: every panel is as wide as the page column, and none is cut off at the edge of the screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await signInAs(page, "demo-leader");
    await page.goto("/workspace");
    await expect(page.locator("#workspace-request")).toBeVisible();
    await askWorkspace(page, "Missing signatures in Marion small claims", 3);
    // The request field spans the page column: 16px in from each edge of the screen.
    const column = await page.locator("#workspace-request").boundingBox();
    expect(column?.x).toBe(16);
    expect((column?.x ?? 0) + (column?.width ?? 0)).toBe(width - 16);
    for (const panel of await workspacePanels(page).all()) {
      const box = await panel.boundingBox();
      expect(box?.x).toBe(16);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 16 + 0.5);
    }
    // Nothing is pushed past the edge, where the page would clip it.
    const content = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    expect(content).toBeLessThanOrEqual(width);
  });
}

test("workspace: the request field is as tall as the button beside it, 44px like every one-line field", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signInAs(page, "demo-leader");
  await page.goto("/workspace");
  const field = page.locator("#workspace-request");
  const button = page.getByRole("button", { name: "Open panels" });
  await expect(field).toBeVisible();
  // Empty workspace: the field has a row of its own in the box.
  expect((await field.boundingBox())?.height).toBe(44);
  expect((await button.boundingBox())?.height).toBe(44);
  // With panels open the field and the button share a row: same top edge, same bottom edge.
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);
  const docked = { field: await field.boundingBox(), button: await button.boundingBox() };
  expect(docked.field?.height).toBe(44);
  expect(docked.button?.height).toBe(44);
  expect(docked.field?.y).toBe(docked.button?.y);
});

test("import preview on a phone: the note beside the Preview heading drops under it whole instead of breaking mid-phrase", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await previewImport(page, 12);
  const heading = page.getByRole("heading", { name: /^Preview/ });
  await expect(heading).toContainText("12 rows read");
  const measured = await heading.evaluate((element) => {
    const note = element.querySelector("small");
    const title = document.createRange();
    title.selectNode(element.firstChild as Node);
    const noteText = document.createRange();
    if (note) noteText.selectNodeContents(note);
    const noteBox = note?.getBoundingClientRect();
    return {
      noteLines: new Set([...noteText.getClientRects()].map((rect) => Math.round(rect.top))).size,
      titleBottom: title.getBoundingClientRect().bottom,
      titleLeft: title.getBoundingClientRect().left,
      noteTop: noteBox?.top ?? Number.NaN,
      noteLeft: noteBox?.left ?? Number.NaN,
      noteRight: noteBox?.right ?? Number.NaN,
      screen: window.innerWidth,
    };
  });
  // The whole note is on one line, under the title, starting at the same left edge, inside the screen.
  expect(measured.noteLines).toBe(1);
  expect(measured.noteTop).toBeGreaterThanOrEqual(measured.titleBottom - 8);
  expect(Math.round(measured.noteLeft)).toBe(Math.round(measured.titleLeft));
  expect(measured.noteRight).toBeLessThanOrEqual(measured.screen - 16);

  // On a desktop there is room: the note stays beside the title, on its line.
  await page.setViewportSize(DESKTOP);
  const wide = await heading.evaluate((element) => {
    const note = element.querySelector("small")?.getBoundingClientRect();
    const title = document.createRange();
    title.selectNode(element.firstChild as Node);
    return { noteLeft: note?.left ?? Number.NaN, noteTop: note?.top ?? Number.NaN, titleRight: title.getBoundingClientRect().right, titleBottom: title.getBoundingClientRect().bottom };
  });
  expect(wide.noteLeft).toBeGreaterThan(wide.titleRight);
  expect(wide.noteTop).toBeLessThan(wide.titleBottom);
});

test("import preview: at 1440px every column fits and short ones stay on one line; narrower, the box scrolls", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await previewImport(page, 12);
  const preview = page.getByRole("region", { name: "Preview of rows to add" });
  const firstRow = preview.getByRole("row").nth(1);
  /** How many lines the text of a cell takes. */
  const linesIn = (cell: number) =>
    firstRow
      .getByRole("cell")
      .nth(cell)
      .evaluate((td) => {
        const range = document.createRange();
        range.selectNodeContents(td);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      });
  // Row, Date, County, Case type: one line each. Form ("Small claims notice of claim"): two at most.
  for (const cell of [0, 1, 2, 3]) expect(await linesIn(cell)).toBe(1);
  expect(await linesIn(4)).toBeLessThanOrEqual(2);
  // All ten columns fit the page column at this width: nothing to scroll sideways, in the box or on the page.
  await expect(preview.getByRole("columnheader")).toHaveCount(10);
  expect(await preview.evaluate((box) => box.scrollWidth <= box.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // On a narrower screen the table is wider than its box. The box is what scrolls sideways, not the page,
  // and the Change column stays in reach at the right edge of the box.
  await page.setViewportSize({ width: 900, height: 900 });
  expect(await preview.evaluate((box) => box.scrollWidth > box.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const change = firstRow.getByRole("cell").last();
  expect(await change.evaluate((td) => getComputedStyle(td).position)).toBe("sticky");
  const edges = await preview.evaluate((box) => {
    const cell = box.querySelector("tbody tr td:last-child");
    return { box: box.getBoundingClientRect().right, cell: cell ? cell.getBoundingClientRect().right : Number.NaN };
  });
  expect(Math.abs(edges.box - edges.cell)).toBeLessThanOrEqual(2);
  await expect(firstRow.getByRole("button", { name: /^Change problems for row/ })).toBeInViewport();
});

test("import preview on a phone: the Change column scrolls with the table instead of covering it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await previewImport(page, 12);
  const preview = page.getByRole("region", { name: "Preview of rows to add" });
  const action = preview.getByRole("row").nth(1).getByRole("cell").last();
  expect(await action.evaluate((td) => getComputedStyle(td).position)).toBe("static");
  // The page itself still does not scroll sideways: the table scrolls inside its own box.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize(DESKTOP);
  expect(await action.evaluate((td) => getComputedStyle(td).position)).toBe("sticky");
});

test("a long import table scrolls inside its box, and its column heads stay in view", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await previewImport(page, 60);
  const preview = page.getByRole("region", { name: "Preview of rows to add" });
  const measured = await preview.evaluate((box) => {
    box.scrollTop = 600;
    const head = box.querySelector("thead th");
    return {
      scrolled: box.scrollTop,
      taller: box.scrollHeight > box.clientHeight,
      boxTop: box.getBoundingClientRect().top,
      headTop: head ? head.getBoundingClientRect().top : Number.NaN,
      boxHeight: box.clientHeight,
      screen: window.innerHeight,
    };
  });
  expect(measured.taller).toBe(true);
  expect(measured.scrolled).toBe(600);
  // The head is at the top edge of the box (inside its 1px border), not 600px above it.
  expect(Math.abs(measured.headTop - measured.boxTop)).toBeLessThanOrEqual(2);
  expect(measured.boxHeight).toBeLessThanOrEqual(measured.screen * 0.7 + 1);
  await expect(preview.getByRole("columnheader", { name: "Confidence" })).toBeInViewport();

  // The same for the rows waiting for review once they are added.
  await page.getByRole("button", { name: "Add 60 rows to the tracker" }).click();
  await expect(page.getByText("Added 60 rows.")).toBeVisible();
  const review = page.getByRole("region", { name: "Imported rows that need review" });
  expect(await review.evaluate((box) => getComputedStyle(box).overflowY)).toBe("auto");
  expect(await review.evaluate((box) => getComputedStyle(box).maxHeight)).not.toBe("none");
});

test("error summary: a message that wraps keeps its bullet beside its first line", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/log");
  await page.getByLabel("Note").fill("call 317-555-0142");
  await page.getByRole("button", { name: "Save tags" }).click();
  const summary = page.getByRole("alert").filter({ hasText: "This entry was not saved" });
  await expect(summary).toBeVisible();
  const link = summary.getByRole("link", { name: /phone number/ });
  const measured = await link.evaluate((a) => {
    const item = a.closest("li");
    const range = document.createRange();
    range.selectNodeContents(a);
    return {
      display: getComputedStyle(a).display,
      lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
      linkWidth: a.getBoundingClientRect().width,
      itemWidth: item ? item.getBoundingClientRect().width : 0,
    };
  });
  // The message wraps here, which is the case that went wrong.
  expect(measured.lines).toBeGreaterThan(1);
  // A block box: the list marker lines up with the first line. An inline-block lines it up with the last.
  expect(measured.display).toBe("block");
  expect(measured.linkWidth).toBe(measured.itemWidth);
});

test("How it's used: the gold of the main action is not used in the illustrations", async ({ page }) => {
  await signInAs(page, "demo-leader");
  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const painted = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--cta)";
    document.body.append(probe);
    const gold = getComputedStyle(probe).color;
    probe.remove();
    const shapes = [...document.querySelectorAll("main svg *")];
    const inGold = shapes.filter((shape) => {
      const style = getComputedStyle(shape);
      return style.fill === gold || style.stroke === gold;
    });
    return { gold, shapes: shapes.length, inGold: inGold.length };
  });
  expect(painted.gold).toMatch(/^rgb/);
  expect(painted.shapes).toBeGreaterThan(20);
  expect(painted.inGold).toBe(0);
});

/** The names of the buttons and links on the page that are drawn in the gold of the main action. */
async function goldButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--cta)";
    document.body.append(probe);
    const gold = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll<HTMLElement>("button, a")]
      .filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).backgroundColor === gold)
      .map((control) => (control.textContent ?? "").trim());
  });
}

test("one gold button per screen: the main action, and on Import it moves to the add button once there is a preview", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  // Reduced motion: a button's color is read once it has settled, not part-way through a fade.
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Signed out: the sign-in page has no main action (four equal choices), the emailed-link page has one.
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Administrator" })).toBeVisible();
  expect(await goldButtons(page)).toEqual([]);
  await page.goto("/auth/confirm?token_hash=0123456789abcdef&type=email");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(await goldButtons(page)).toEqual(["Sign in"]);

  await signInAs(page, "demo-admin");
  await page.goto("/log");
  await expect(page.getByText("No entries yet")).toBeVisible();
  expect(await goldButtons(page)).toEqual(["Save tags"]);

  await page.goto("/import");
  await expect(page.getByText("Nothing is waiting for review")).toBeVisible();
  expect(await goldButtons(page)).toEqual(["Sort into categories"]);
  await page.getByRole("button", { name: "Fill with the made-up example" }).click();
  await page.getByRole("button", { name: "Sort into categories" }).click();
  await expect(page.getByRole("button", { name: "Add 10 rows to the tracker" })).toBeVisible();
  await expect.poll(() => goldButtons(page)).toEqual(["Add 10 rows to the tracker"]);
  await page.getByRole("button", { name: "Discard preview" }).click();
  await expect(page.getByRole("button", { name: "Discard preview" })).toHaveCount(0);
  await expect.poll(() => goldButtons(page)).toEqual(["Sort into categories"]);

  // The dashboard is for reading: with AI off it has nothing to press in gold.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Before and after a change" })).toBeVisible();
  expect(await goldButtons(page)).toEqual([]);

  await page.goto("/workspace");
  await expect(page.getByRole("button", { name: /^Open folder County comparison/ })).toBeVisible();
  expect(await goldButtons(page)).toEqual(["Open panels"]);
  await askWorkspace(page, "Missing signatures in Marion small claims", 3);
  expect(await goldButtons(page)).toEqual(["Open panels"]);

  await page.goto("/admin");
  await expect(page.getByRole("region", { name: "Audit log entries" })).toBeVisible();
  expect(await goldButtons(page)).toEqual(["Add change"]);

  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { name: "What the tracker does not do" })).toBeVisible();
  expect(await goldButtons(page)).toEqual([]);

  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(await goldButtons(page)).toEqual(["Go to the start page"]);
});
