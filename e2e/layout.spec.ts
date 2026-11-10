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

test("import preview at 1440px: short columns stay on one line and the form name keeps its width", async ({ page }) => {
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
  // The table is wider than its box now, and the box is what scrolls sideways, not the page.
  expect(await preview.evaluate((box) => box.scrollWidth >= box.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

test("How it's used: the accent color is not used in the illustrations", async ({ page }) => {
  await signInAs(page, "demo-leader");
  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const painted = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const shapes = [...document.querySelectorAll("main svg *")];
    const inAccent = shapes.filter((shape) => {
      const style = getComputedStyle(shape);
      return style.fill === accent || style.stroke === accent;
    });
    return { accent, shapes: shapes.length, inAccent: inAccent.length };
  });
  expect(painted.accent).toMatch(/^rgb/);
  expect(painted.shapes).toBeGreaterThan(20);
  expect(painted.inAccent).toBe(0);
});
