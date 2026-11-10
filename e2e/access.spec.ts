import { expect, test } from "@playwright/test";
import type { APIResponse } from "@playwright/test";
import { apiDelete, apiPost, resetDemoData, signInAs } from "./helpers";

test.beforeEach(resetDemoData);

async function errorCode(response: APIResponse): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

const LAKE_FILING = {
  date: "2026-10-30",
  county: "Lake",
  caseType: "Small claims",
  form: "Small claims notice of claim",
  tags: ["Missing signature"],
  outcome: "Rejected",
};

test("a clerk cannot open the admin page", async ({ page }) => {
  await signInAs(page, "demo-clerk-marion");
  await page.goto("/admin");

  await expect(page.getByText("This page is for administrators")).toBeVisible();
  // None of the admin screen is sent to them.
  await expect(page.getByRole("heading", { name: "Audit log" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add change" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Admin" })).toHaveCount(0);

  // And the admin API answers 403 to them, whatever the page shows.
  const audit = await page.request.get("/api/audit");
  expect(audit.status()).toBe(403);
  expect(await errorCode(audit)).toBe("forbidden");
  const addChange = await apiPost(page, "/api/events", {
    name: "A change",
    date: "2026-09-01",
    county: "Marion",
    caseType: "Eviction",
    tag: "Wrong form",
    description: "A one-page guide.",
  });
  expect(addChange.status()).toBe(403);
  expect((await apiDelete(page, "/api/events/sc-form")).status()).toBe(403);
});

test("a clerk sees and changes only their own county, enforced by the API", async ({ page, browser }) => {
  // A Lake clerk tags a filing.
  const lakeContext = await browser.newContext();
  const lake = await lakeContext.newPage();
  await signInAs(lake, "demo-clerk-lake");
  const created = await apiPost(lake, "/api/flags", LAKE_FILING);
  expect(created.status()).toBe(201);
  const lakeFlag = (await created.json()) as { id: string; county: string };

  await signInAs(page, "demo-clerk-marion");
  // Reading: every flag the Marion clerk gets is a Marion flag.
  const flags = (await (await page.request.get("/api/flags")).json()) as { id: string; county: string }[];
  expect(flags.length).toBeGreaterThan(0);
  expect(new Set(flags.map((flag) => flag.county))).toEqual(new Set(["Marion"]));
  expect(flags.map((flag) => flag.id)).not.toContain(lakeFlag.id);

  // Writing: a filing for another county is refused with 403, not quietly moved to Marion.
  const refused = await apiPost(page, "/api/flags", LAKE_FILING);
  expect(refused.status()).toBe(403);
  expect(await errorCode(refused)).toBe("forbidden");
  expect(((await (await page.request.get("/api/flags")).json()) as unknown[]).length).toBe(flags.length);

  // Importing a row for another county is refused too.
  const imported = await apiPost(page, "/api/import/commit", {
    rows: [{ date: "2026-09-03", county: "Lake", caseType: "Small claims", form: "Small claims notice of claim", reason: "no signature", tags: ["Missing signature"] }],
  });
  expect(imported.status()).toBe(403);

  // Removing the Lake clerk's entry is refused.
  expect((await apiDelete(page, `/api/flags/${lakeFlag.id}`)).status()).toBe(403);
  expect((await lake.request.get("/api/flags/recent")).ok()).toBe(true);
  const recent = (await (await lake.request.get("/api/flags/recent")).json()) as { id: string }[];
  expect(recent.map((flag) => flag.id)).toContain(lakeFlag.id);
  await lakeContext.close();

  // In the page: the dashboard says which county it covers and offers no county filter.
  await page.goto("/dashboard");
  await expect(page.getByText("You see Marion County only.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /flagged filings?:/ })).toContainText(`${flags.length} flagged filings: Marion County`);
  await expect(page.getByRole("region", { name: "Filters" }).getByLabel("County")).toHaveCount(0);
});

test("a court leader reads everything and can add nothing", async ({ page }) => {
  await signInAs(page, "demo-leader");
  expect(((await (await page.request.get("/api/flags")).json()) as unknown[]).length).toBe(900);
  expect((await apiPost(page, "/api/flags", LAKE_FILING)).status()).toBe(403);
  expect((await page.request.get("/api/flags/needs-review")).status()).toBe(403);
  expect((await page.request.get("/api/audit")).status()).toBe(403);

  await page.goto("/log");
  await expect(page.getByText("Tagging is done by clerks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save tags" })).toHaveCount(0);
});

test("an administrator records a change and sees it in the audit log", async ({ page }) => {
  await signInAs(page, "demo-admin");
  await page.goto("/admin");
  await page.getByLabel("Name").fill("Fee waiver guide (Monroe, Sep 1)");
  await page.getByLabel("Date it took effect").fill("2026-09-01");
  await page.getByLabel("County").selectOption("Monroe");
  await page.getByLabel("Description").fill("Monroe County starts handing out a one-page fee waiver guide.");
  await page.getByRole("button", { name: "Add change" }).click();

  await expect(page.getByRole("region", { name: "Changes on file" }).getByRole("row", { name: /Fee waiver guide/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Audit log entries" }).getByRole("row", { name: /Saved a change/ })).toBeVisible();
});
