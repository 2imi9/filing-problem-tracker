import { expect, test } from "@playwright/test";
import { dashboardTotal, resetDemoData, signInAs, visibleFlagCount } from "./helpers";

test.beforeEach(resetDemoData);

test("a clerk imports the example export: preview, add, and the rows are counted", async ({ page }) => {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/import");
  const before = await visibleFlagCount(page);

  await page.getByRole("button", { name: "Fill with the made-up example" }).click();
  await page.getByRole("button", { name: "Sort into categories" }).click();

  // The preview says what would happen. Nothing is saved yet.
  const preview = page.getByRole("region", { name: "Preview of rows to add" });
  await expect(preview.getByRole("row")).toHaveCount(11);
  await expect(page.getByText("10 rows read, 9 sorted, 1 need review, 0 left out")).toBeVisible();
  // With AI off, every row is sorted by the keyword rules.
  await expect(preview.getByRole("cell", { name: "Rules", exact: true })).toHaveCount(10);
  await expect(preview.getByRole("row", { name: /no signature on page 2/ }).getByText("Missing signature")).toBeVisible();
  await expect(preview.getByRole("row", { name: /will bring in tomorrow/ }).getByText("Needs review")).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before);

  await page.getByRole("button", { name: "Add 10 rows to the tracker" }).click();
  await expect(page.getByText("Added 10 rows.")).toBeVisible();
  await expect(page.getByText("1 row could not be sorted and is listed under Needs review below.")).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before + 10);

  // The unsorted row waits in the needs-review list with the reason as typed.
  const review = page.getByRole("region", { name: "Imported rows that need review" });
  await expect(review.getByRole("row")).toHaveCount(2);
  await expect(review.getByText("called filer - will bring in tomorrow")).toBeVisible();

  // And the dashboard counts the new rows.
  await page.getByRole("link", { name: "Open the dashboard" }).click();
  expect(await dashboardTotal(page)).toBe(before + 10);
});

test("an uploaded file is checked row by row: other counties and personal data are left out with the reason", async ({ page }) => {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/import");
  await expect(page.getByRole("button", { name: "Sort into categories" })).toBeVisible();
  const before = await visibleFlagCount(page);

  const csv = [
    "date,county,case_type,form,reason",
    "2026-09-02,Marion,Small claims,Small claims notice of claim,no signature on page 2",
    "2026-09-03,Lake,Small claims,Small claims notice of claim,filed in wrong county",
    "2026-09-04,Marion,Eviction,Tenant answer or request for hearing,call filer at 317-555-0142",
    "2031-01-01,Marion,Family,Petition to modify child support,used old version of form",
  ].join("\n");
  await page.getByTestId("import-file").setInputFiles({ name: "export.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });

  await expect(page.getByText("4 rows read, 1 sorted, 0 need review, 3 left out")).toBeVisible();
  const leftOut = page.getByRole("region", { name: "Rows left out" });
  await expect(leftOut.getByRole("row")).toHaveCount(4);
  await expect(leftOut.getByRole("row", { name: /Lake/ })).toContainText(/Marion County/);
  await expect(leftOut.getByRole("row", { name: /Eviction/ })).toContainText(/phone number/);
  await expect(leftOut.getByRole("row", { name: /2031-01-01/ })).toContainText(/future/);

  await page.getByRole("button", { name: "Add 1 row to the tracker" }).click();
  await expect(page.getByText("Added 1 row.")).toBeVisible();
  expect(await visibleFlagCount(page)).toBe(before + 1);
});

test("a file that is not a rejection export is refused with a plain message", async ({ page }) => {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/import");
  await page.getByLabel("CSV text").fill("name,amount\nsomething,12");
  await page.getByRole("button", { name: "Sort into categories" }).click();
  const summary = page.getByRole("alert").first();
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(/column/i);
  await expect(page.getByRole("region", { name: "Preview of rows to add" })).toHaveCount(0);
});
