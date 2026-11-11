import { expect, test } from "@playwright/test";
import { resetDemoData, signInAs } from "./helpers";

// How the dashboard is laid out: the key numbers as one row, sections under plain rules, and what it
// says about AI when AI is off. What the numbers are is checked by the unit tests.

test.beforeEach(resetDemoData);

test("the four key numbers are one row split by thin dividers, with their figures on one baseline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  const numbers = page.getByRole("article", { name: "Key numbers" }).getByRole("listitem");
  await expect(numbers).toHaveCount(4);
  await expect(numbers.first()).toContainText("900");

  const measured = await numbers.evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item);
      const figure = item.children[1] as HTMLElement;
      // A box with no height at the end of the figure sits on its text baseline.
      const mark = document.createElement("span");
      mark.style.display = "inline-block";
      figure.append(mark);
      const baseline = mark.getBoundingClientRect().bottom;
      mark.remove();
      const box = item.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        left: box.left,
        right: box.right,
        divider: style.borderLeftWidth,
        frame: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth].join(" "),
        fill: style.backgroundColor,
        radius: style.borderRadius,
        baseline: Math.round(baseline),
        size: parseFloat(getComputedStyle(figure).fontSize),
      };
    }),
  );
  // One row, left to right.
  expect(new Set(measured.map((item) => item.top)).size).toBe(1);
  for (let index = 1; index < measured.length; index += 1) expect(measured[index].left).toBeGreaterThanOrEqual(measured[index - 1].right - 1);
  // A thin divider before every number but the first, and no card around any of them.
  expect(measured.map((item) => item.divider)).toEqual(["0px", "1px", "1px", "1px"]);
  for (const item of measured) {
    expect(item.frame).toBe("0px 0px 0px");
    expect(item.fill).toBe("rgba(0, 0, 0, 0)");
    expect(item.radius).toBe("0px");
  }
  // The first figure is the dominant one, and all four stand on the same line.
  expect(measured[0].size).toBeGreaterThan(measured[1].size);
  expect(new Set(measured.map((item) => item.baseline)).size).toBe(1);

  // On a phone the row does not push the page sideways.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(numbers).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("with AI off the dashboard says so in one line and offers no summary to generate", async ({ page }) => {
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Before and after a change" })).toBeVisible();
  const line = page.getByText("Summary unavailable. AI features are switched off on this server. Every number on this page is complete without it.");
  await expect(line).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "AI summary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Generate/ })).toHaveCount(0);
  // A plain line of text: no box, no fill and no colored edge.
  const style = await line.evaluate((paragraph) => {
    const computed = getComputedStyle(paragraph);
    return { left: computed.borderLeftWidth, right: computed.borderRightWidth, bottom: computed.borderBottomWidth, fill: computed.backgroundColor };
  });
  expect(style).toEqual({ left: "0px", right: "0px", bottom: "0px", fill: "rgba(0, 0, 0, 0)" });
});

test("the before and after chart marks the change with a dashed line labelled Change, and has no filled area", async ({ page }) => {
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  const panel = page.getByRole("article", { name: /^Before and after/ });
  await expect(panel).toContainText("-75%");
  const chart = panel.locator("figure svg").first();
  await expect(chart.getByText("Change", { exact: true })).toBeVisible();
  const drawn = await chart.evaluate((svg) => {
    const dashed = [...svg.querySelectorAll("line")].filter((line) => getComputedStyle(line).strokeDasharray !== "none");
    const vertical = dashed.filter((line) => line.getAttribute("x1") === line.getAttribute("x2"));
    const order = [...svg.querySelectorAll("line, polyline")];
    const grid = [...svg.querySelectorAll("line")].filter((line) => line.getAttribute("y1") === line.getAttribute("y2"));
    return {
      markers: vertical.length,
      // Later in the SVG means drawn on top.
      markerOverGrid: vertical.length > 0 && grid.every((line) => order.indexOf(line) < order.indexOf(vertical[0])),
      gridLines: grid.length,
      filled: [...svg.querySelectorAll("path, polygon, polyline")].filter((shape) => getComputedStyle(shape).fill !== "none").length,
    };
  });
  expect(drawn.gridLines).toBeGreaterThan(1);
  expect(drawn.markers).toBe(1);
  expect(drawn.markerOverGrid).toBe(true);
  expect(drawn.filled).toBe(0);
});

for (const width of [375, 320]) {
  test(`Problems by form at ${width}px: a column heading that takes keyboard focus is brought fully into the table's box`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await signInAs(page, "demo-leader");
    await page.goto("/dashboard");
    const box = page.getByRole("group", { name: "Flagged filings by form" });
    await expect(box).toBeVisible();
    // The table is wider than a phone and scrolls sideways inside its own box.
    expect(await box.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await box.focus();
    const headings = ["Form", "Case type", "Flagged filings", "Most common problem", "Share with it"];
    /** How many pixels of the focused heading button lie outside the box. */
    const outside = () =>
      page.evaluate(() => {
        const button = document.activeElement as HTMLElement;
        const scrollBox = button.closest(".table-scroll");
        if (!scrollBox) return Number.NaN;
        const inner = button.getBoundingClientRect();
        const outer = scrollBox.getBoundingClientRect();
        return Math.max(0, outer.left - inner.left) + Math.max(0, inner.right - outer.right);
      });
    // Forward through the five headings, then back again.
    for (const heading of headings) {
      await page.keyboard.press("Tab");
      await expect(box.getByRole("button", { name: heading, exact: true })).toBeFocused();
      await expect.poll(outside).toBeLessThanOrEqual(0.5);
    }
    for (const heading of headings.slice(0, -1).reverse()) {
      await page.keyboard.press("Shift+Tab");
      await expect(box.getByRole("button", { name: heading, exact: true })).toBeFocused();
      await expect.poll(outside).toBeLessThanOrEqual(0.5);
    }
    // The page itself has not been pushed sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("at 320px the before and after chart fits its box, so there is nothing to scroll sideways that a keyboard cannot reach", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  const panel = page.getByRole("article", { name: /^Before and after/ });
  await expect(panel).toContainText("-75%");
  const chart = panel.locator("figure svg").first();
  await expect(chart.getByText("Change", { exact: true })).toBeVisible();
  // Once the chart has been measured it is as wide as the box that holds it.
  await expect
    .poll(() =>
      chart.evaluate((svg) => {
        const plot = svg.parentElement as HTMLElement;
        return plot.scrollWidth - plot.clientWidth;
      }),
    )
    .toBe(0);
  const sizes = await chart.evaluate((svg) => ({ chart: svg.getBoundingClientRect().width, box: (svg.parentElement as HTMLElement).clientWidth }));
  expect(sizes.chart).toBeLessThanOrEqual(sizes.box);
  expect(sizes.box).toBeGreaterThanOrEqual(240);
});
