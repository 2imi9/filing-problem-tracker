// Shared by every end-to-end test. The tests run against a production build in demo mode with AI off
// (see playwright.config.ts), one at a time, and each starts from the sample data.

import { expect, request as apiRequest } from "@playwright/test";
import type { APIResponse, Locator, Page } from "@playwright/test";
import type { DemoUserId } from "@/lib/sample";

export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://localhost:${PORT}`;

/** State-changing API routes check the Origin header. A browser sends it; a scripted request must add it. */
const SAME_ORIGIN = { origin: BASE_URL };

/**
 * Puts the demo server back to the 900 sample filings, three changes and example folders, and clears
 * the rate limits. Called before every test, so tests do not depend on each other or on their order.
 * The limits are cleared only because playwright.config.ts starts the server with
 * DEMO_RESET_CLEARS_LIMITS=1; a server started any other way keeps them.
 */
export async function resetDemoData(): Promise<void> {
  const api = await apiRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: SAME_ORIGIN });
  try {
    expect((await api.post("/api/demo/login", { data: { userId: "demo-admin" } })).status()).toBe(200);
    expect((await api.post("/api/demo/reset")).status()).toBe(200);
  } finally {
    await api.dispose();
  }
}

/** Signs this page's browser context in as a demo account, without going through the sign-in page. */
export async function signInAs(page: Page, userId: DemoUserId): Promise<void> {
  const response = await page.request.post("/api/demo/login", { data: { userId }, headers: SAME_ORIGIN });
  expect(response.status()).toBe(200);
}

/** A POST from this page's session, as the browser would send it. */
export function apiPost(page: Page, path: string, data?: unknown): Promise<APIResponse> {
  return page.request.post(path, { data, headers: SAME_ORIGIN });
}

/** A DELETE from this page's session, as the browser would send it. */
export function apiDelete(page: Page, path: string): Promise<APIResponse> {
  return page.request.delete(path, { headers: SAME_ORIGIN });
}

/** How many flagged filings this page's account can see, asked of the API. */
export async function visibleFlagCount(page: Page): Promise<number> {
  const response = await page.request.get("/api/flags");
  expect(response.status()).toBe(200);
  return ((await response.json()) as unknown[]).length;
}

/** The line under the dashboard filters: "900 flagged filings: All counties, all case types, all months". */
export function dashboardCount(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /flagged filings?:/ });
}

/** The number at the start of the dashboard's count line, once the dashboard has loaded. */
export async function dashboardTotal(page: Page): Promise<number> {
  const line = dashboardCount(page);
  await expect(line).toHaveText(/^[\d,]+ flagged filings?:/);
  const text = (await line.textContent()) ?? "";
  return Number(text.split(" ")[0].replaceAll(",", ""));
}

/** The panels open on the workspace grid. */
export function workspacePanels(page: Page): Locator {
  return page.getByRole("list", { name: "Open panels" }).locator("li[data-panel-id]");
}

/** Types a request into the workspace command bar and waits for the panels it opens. */
export async function askWorkspace(page: Page, request: string, expectedPanels: number): Promise<void> {
  await page.locator("#workspace-request").fill(request);
  await page.getByRole("button", { name: "Open panels" }).click();
  await expect(workspacePanels(page)).toHaveCount(expectedPanels);
}
