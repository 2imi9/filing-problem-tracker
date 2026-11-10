import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import { PORT, resetDemoData, signInAs } from "./helpers";

// What the app does when something around it is wrong: a setting it cannot read, a server that does
// not answer.

test.beforeEach(resetDemoData);

interface Exit {
  code: number | null;
  output: string;
}

/** Starts a second production server from the same build with extra settings, and waits for it to end. */
function startServerWith(env: Record<string, string>, port: number, giveUpAfterMs: number): Promise<Exit> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        ANTHROPIC_API_KEY: "",
        MCP_TOKEN: "",
        APP_ORIGIN: "",
        DEMO_COOKIE_SECRET: "e2e-only-demo-cookie-secret-not-for-deployment",
        NEXT_TELEMETRY_DISABLED: "1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    // A server that stays up is the failure this test is for. It is stopped so the run can go on.
    const timer = setTimeout(() => child.kill("SIGKILL"), giveUpAfterMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test("a server that cannot read its settings stops with status 1 and says which setting, instead of listening", async () => {
  const port = PORT + 7;
  const exit = await startServerWith({ TRUSTED_PROXY_HOPS: "several" }, port, 20_000);
  expect(exit.output).toContain("TRUSTED_PROXY_HOPS must be a whole number from 0 to 10.");
  expect(exit.output).toContain("The server did not start.");
  // Status 1, not a kill by this test's timer (which would give null): the process ended itself.
  expect(exit.code).toBe(1);
  // And nothing is left answering on its port.
  const answered = await fetch(`http://localhost:${port}/api/health`).then(
    () => true,
    () => false,
  );
  expect(answered).toBe(false);
});

test("when the server cannot end the session, the person is told and stays signed in on the page", async ({ page }) => {
  await signInAs(page, "demo-leader");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  // The sign-out request fails once: the server answers 500 and the session cookie is still in the browser.
  let failures = 0;
  await page.route("**/api/demo/logout", async (route) => {
    failures += 1;
    if (failures === 1) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "Something went wrong on the server.", requestId: "e2e" } }) });
    else await route.continue();
  });

  await page.getByRole("button", { name: /Account: Court leader/ }).click();
  const signOut = page.getByRole("button", { name: "Sign out or switch role" });
  await signOut.click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not sign out. You are still signed in." })).toBeVisible();
  // Not sent to the sign-in page as if it had worked, and the session really is still there.
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await page.request.get("/api/me")).status()).toBe(200);

  // The button is ready for another try, and that one works.
  await signOut.click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});
