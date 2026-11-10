import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, PORT } from "./e2e/helpers";

// End-to-end tests run against a production build (`next build`, then `next start`) in demo mode with
// AI off, so they need no database, no API key and no network.

/**
 * A Chromium that is already on this machine, or undefined to let Playwright use its own download.
 *
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE names a browser outright. Otherwise Playwright looks in
 * PLAYWRIGHT_BROWSERS_PATH (or its default cache) for the exact revision it was released with, which is
 * what `npx playwright install chromium` puts there and what CI uses. Some machines come with browsers
 * installed for a different Playwright version and a `chromium` link to the executable in that folder.
 * That link is used when it exists, so nothing has to be downloaded.
 */
function installedChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const link = join(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers", "chromium");
  return existsSync(link) && statSync(link).isFile() ? link : undefined;
}

const executablePath = installedChromium();

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // The demo server keeps its data in memory, shared by every test, so tests run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    // CI builds once, checks the bundle, then sets E2E_SKIP_BUILD=1 so the same build is served here.
    command: process.env.E2E_SKIP_BUILD === "1" ? `npm run start -- -p ${PORT}` : `npm run build && npm run start -- -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // Demo mode with AI off, whatever the shell or a local .env file has set: an empty value reads as "not set".
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      ANTHROPIC_API_KEY: "",
      MCP_TOKEN: "",
      APP_ORIGIN: "",
      TRUSTED_PROXY_HOPS: "",
      // Every test begins with a demo reset. On this throwaway server the reset also clears the rate
      // limits, so a whole run of sign-ins and saves from one address does not add up to a refusal.
      DEMO_RESET_CLEARS_LIMITS: "1",
      // Not a secret: it signs the demo cookie of a throwaway local server holding made-up data.
      DEMO_COOKIE_SECRET: "e2e-only-demo-cookie-secret-not-for-deployment",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
