import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import type { DemoUserId } from "@/lib/sample";
import { PORT } from "./helpers";

// What the production server writes while signed-in people use the pages that are rendered with server
// code (/ and /admin). Next.js reports a problem it finds while rendering, such as a clock read during
// a prerender, by writing "Error: Route ... encountered the unstable value ..." to the server's output
// and carrying on: the page still looks right in the browser, so only the output shows it. This test
// starts its own server from the same build so that it can read everything that server writes.

const LOG_PORT = PORT + 8;
const ORIGIN = `http://localhost:${LOG_PORT}`;

interface Server {
  child: ChildProcess;
  /** Everything written to stdout and stderr so far. */
  output: () => string;
  stop: () => Promise<void>;
}

async function startServer(): Promise<Server> {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(LOG_PORT)], {
    env: {
      ...process.env,
      // Demo mode with AI off, like the server the other tests use.
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      ANTHROPIC_API_KEY: "",
      MCP_TOKEN: "",
      APP_ORIGIN: "",
      TRUSTED_PROXY_HOPS: "",
      DEMO_COOKIE_SECRET: "e2e-only-demo-cookie-secret-not-for-deployment",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  };

  // Wait until it answers, or say what it wrote if it never does.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const up = await fetch(`${ORIGIN}/api/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) break;
    if (child.exitCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(`The server on port ${LOG_PORT} did not start. It wrote:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { child, output: () => output, stop };
}

/** A signed-in page on the server under test, in a browser context of its own. */
async function signedInPage(browser: Browser, userId: DemoUserId): Promise<Page> {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  const response = await page.request.post("/api/demo/login", { data: { userId }, headers: { origin: ORIGIN } });
  expect(response.status()).toBe(200);
  return page;
}

/** The lines Next.js prints once when it starts. */
const STARTUP_LINE = /^(\u25B2 Next\.js \d|- (Local|Network):\s+http:\/\/|\u2713 (Ready in|Starting|Running next\.config))/;
/** The app's own line for each API request it handled (src/server/http.ts). */
const REQUEST_LINE = /^\{"requestId":"[0-9a-f-]+","method":"[A-Z]+","route":"\/api\/[^"]*",.*\}$/;

test("the production server writes no error while signed-in people load / and /admin", async ({ browser }) => {
  test.setTimeout(90_000);
  const server = await startServer();
  try {
    // An administrator: full loads of both pages, several times.
    const admin = await signedInPage(browser, "demo-admin");
    for (let round = 0; round < 3; round += 1) {
      await admin.goto("/");
      await expect(admin).toHaveURL(/\/dashboard$/);
      await admin.goto("/admin");
      await expect(admin.getByRole("region", { name: "Audit log entries" })).toBeVisible();
    }
    // And the way most people get there: from another tab, through the tab bar (a prefetch, then a
    // navigation inside the app).
    await admin.goto("/dashboard");
    await expect(admin.getByRole("heading", { name: "Before and after a change" })).toBeVisible();
    const adminTab = admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" });
    await adminTab.hover();
    await adminTab.click();
    await expect(admin).toHaveURL(/\/admin$/);
    await expect(admin.getByRole("region", { name: "Audit log entries" })).toBeVisible();
    await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tag a filing" }).click();
    await expect(admin.getByRole("button", { name: "Save tags" })).toBeVisible();
    await admin.context().close();

    // A clerk: / leads to tagging, and /admin is refused, both drawn by the same server code.
    const clerk = await signedInPage(browser, "demo-clerk-marion");
    for (let round = 0; round < 3; round += 1) {
      await clerk.goto("/");
      await expect(clerk).toHaveURL(/\/log$/);
      await clerk.goto("/admin");
      await expect(clerk.getByRole("main").getByText("This page is for administrators")).toBeVisible();
      await expect(clerk.getByRole("heading", { name: "Audit log" })).toHaveCount(0);
    }
    await clerk.context().close();

    // A court leader lands on the dashboard and is refused the admin page too.
    const leader = await signedInPage(browser, "demo-leader");
    await leader.goto("/");
    await expect(leader).toHaveURL(/\/dashboard$/);
    await leader.goto("/admin");
    await expect(leader.getByRole("main").getByText("This page is for administrators")).toBeVisible();
    await leader.context().close();

    // Nobody signed in: both pages send the visitor to sign in.
    const visitorContext = await browser.newContext({ baseURL: ORIGIN });
    const visitor = await visitorContext.newPage();
    await visitor.goto("/admin");
    await expect(visitor).toHaveURL(/\/login\?next=%2Fadmin$/);
    await visitor.goto("/");
    await expect(visitor).toHaveURL(/\/login$/);
    await visitorContext.close();

    // Give the server a moment to write anything a finished render still has to report.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  } finally {
    await server.stop();
  }

  const output = server.output();
  expect(output).not.toContain("unstable value");
  expect(output).not.toContain("while prerendering");
  expect(output).not.toMatch(/\bError\b/i);
  // Stricter: after its startup lines the server wrote nothing but one line per API request.
  const lines = output
    // Without the color codes a terminal would read.
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const unexpected = lines.filter((line) => !STARTUP_LINE.test(line) && !REQUEST_LINE.test(line));
  expect(unexpected).toEqual([]);
  // The check saw the server at work: it started, and it handled the sign-ins and the page data.
  expect(lines.some((line) => /^\u2713 Ready in/.test(line))).toBe(true);
  expect(lines.filter((line) => REQUEST_LINE.test(line) && line.includes('"route":"/api/demo/login"')).length).toBe(3);
  expect(lines.filter((line) => REQUEST_LINE.test(line) && line.includes('"route":"/api/me"')).length).toBeGreaterThan(5);
});
