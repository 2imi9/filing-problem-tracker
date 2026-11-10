// This import must stay first. It is what the Next.js server loads before anything else: it gives
// Next.js the AsyncLocalStorage its per-render stores are built on. Without it they are inert fakes.
import "next/dist/server/node-environment-baseline";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDynamicTrackingState } from "next/dist/server/app-render/dynamic-rendering";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
// Next.js wraps the clock and the random sources when the server starts, so that it can tell when one is
// read inside a prerender. These are the same four files next/dist/server/node-environment.js loads.
import "next/dist/server/node-environment-extensions/date";
import "next/dist/server/node-environment-extensions/random";
import "next/dist/server/node-environment-extensions/web-crypto";
import "next/dist/server/node-environment-extensions/node-crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_COOKIE, signDemoCookie } from "@/server/auth/demoCookie";
import { getSession } from "@/server/auth/session";
import { DEMO_COOKIE_SECRET } from "@/server/config";
import { handle } from "@/server/http";
import { clearCookies, cookieJar } from "./cookies";

// The defect this file guards against. The pages / and /admin call getSession() in a Server Component.
// With `cacheComponents` and `partialPrefetching` on (next.config.ts), Next.js renders a signed-in
// request to such a page twice: once for the response, and once as a "runtime prerender", the App Shell
// the browser keeps for that session. cookies() resolves in the runtime prerender. getSession() read
// Date.now() right after it, so every signed-in request to / and /admin made the production server log
//
//   Error: Route "/admin": Next.js encountered the unstable value `Date.now()` while prerendering.
//
// No build and no ordinary unit test shows that: it takes a production server and a signed-in request.
// So this file borrows the part of Next.js that raises the error. It runs getSession() inside the two
// stores Next.js prerenders in, with the clock and random sources wrapped as they are on the server, and
// asks Next.js's own record whether one of them was read.
//
// These imports reach into next/dist, which has no stability promise. If a Next.js upgrade moves them,
// the first tests below fail (they prove the borrowed detector still detects) and this file needs the
// new paths. Do not delete it: a check of the production server's log is the only other guard.

const randomUuidCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));
// src/server/http.ts takes randomUUID from node:crypto. Counting the calls is how the last test knows
// none was made: under Vitest that import does not go through Next.js's wrapper.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: () => {
      randomUuidCalls.count += 1;
      return actual.randomUUID();
    },
  };
});

type PrerenderKind = "prerender" | "prerender-runtime";

/** Runs `fn` the way Next.js runs server code while prerendering `route`. */
function inPrerender<T>(kind: PrerenderKind, route: string, fn: () => T) {
  const controller = new AbortController();
  const tracking = createDynamicTrackingState(false);
  // Only the fields the detector and io() read. The real stores hold much more.
  const workStore = { route };
  const workUnitStore = { type: kind, phase: "render", controller, renderSignal: controller.signal, dynamicTracking: tracking };
  const result = workAsyncStorage.run(workStore as never, () => workUnitAsyncStorage.run(workUnitStore as never, fn));
  return {
    result,
    /** The error Next.js would log, or null when no clock or random source was read. */
    unstableRead: () => tracking.syncDynamicErrorWithStack,
    /** True once Next.js has given up on this prerender. */
    aborted: () => controller.signal.aborted,
    /** Ends the prerender, as Next.js does when it has what it needs. */
    finish: () => controller.abort(),
  };
}

/** Long enough for every await in getSession() to run. */
const letItRun = () => new Promise((resolve) => setTimeout(resolve, 50));

const KINDS: PrerenderKind[] = ["prerender", "prerender-runtime"];

describe("the borrowed Next.js detector", () => {
  it.each(KINDS)("reports a clock read inside a %s", (kind) => {
    const run = inPrerender(kind, "/admin", () => Date.now());
    expect(run.unstableRead()?.message).toContain('Route "/admin": Next.js encountered the unstable value `Date.now()` while prerendering');
    expect(run.aborted()).toBe(true);
  });

  it.each(KINDS)("reports new Date() and a random read inside a %s", (kind) => {
    expect(inPrerender(kind, "/admin", () => new Date()).unstableRead()?.message).toContain("unstable value `new Date()` while prerendering");
    expect(inPrerender(kind, "/admin", () => Math.random()).unstableRead()?.message).toContain("while prerendering");
    expect(inPrerender(kind, "/admin", () => crypto.randomUUID()).unstableRead()?.message).toContain("while prerendering");
  });

  it("does not report a date built from a given time, or the timer meant for measuring", () => {
    const run = inPrerender("prerender-runtime", "/admin", () => [new Date(0).getTime(), performance.now()]);
    expect(run.result[0]).toBe(0);
    expect(run.unstableRead()).toBeNull();
  });
});

describe("getSession while Next.js is prerendering", () => {
  beforeEach(() => {
    clearCookies();
  });

  // Signed in is the case that failed in production. Signed out is checked too: the clock was read
  // before the cookie was known to be missing.
  it.each(KINDS.flatMap((kind) => [{ kind, signedIn: true }, { kind, signedIn: false }]))(
    "reads no clock and no random source in a $kind (signed in: $signedIn)",
    async ({ kind, signedIn }) => {
      if (signedIn) cookieJar.set(DEMO_COOKIE, signDemoCookie("demo-admin", DEMO_COOKIE_SECRET, Math.floor(Date.now() / 1000) + 600));

      let settled = false;
      const run = inPrerender(kind, "/admin", () => getSession());
      const mark = () => {
        settled = true;
      };
      run.result.then(mark, mark);
      await letItRun();

      expect(run.unstableRead()).toBeNull();
      expect(run.aborted()).toBe(false);
      // It waits for a real request instead of answering: who is signed in is never part of a prerender.
      expect(settled).toBe(false);

      run.finish();
      await expect(run.result).rejects.toThrow();
    },
  );

  it("still answers at once for a real request", async () => {
    cookieJar.set(DEMO_COOKIE, signDemoCookie("demo-admin", DEMO_COOKIE_SECRET, Math.floor(Date.now() / 1000) + 600));
    // The store of a route handler, or of a page render that has reached its request-time stage.
    const requestStore = { type: "request", phase: "render" };
    const user = await workAsyncStorage.run({ route: "/admin" } as never, () => workUnitAsyncStorage.run(requestStore as never, () => getSession()));
    expect(user).toMatchObject({ id: "demo-admin", role: "admin" });
  });
});

// The rest of the server reads the clock and makes random ids in plenty of places (request ids, audit
// entries, new rows, today's date). None of that can raise the same error, for two reasons that the
// tests below keep true:
//   1. Server Components reach src/server only through getSession(), which is covered above.
//   2. Everything else runs inside a route handler built with handle(). Next.js never runs a route
//      handler in a runtime prerender, and when it tries one at build time, handle() stops at
//      `request.url` (which ends that prerender) before it reads a clock or makes an id.

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const fromSrc = (path: string) => relative(SRC, path).split(sep).join("/");

describe("where else a prerender could reach the clock", () => {
  it("only / and /admin render with server code, and only through getSession", () => {
    const rendered = [...sourceFiles(join(SRC, "app")), ...sourceFiles(join(SRC, "components"))].filter((path) => !fromSrc(path).startsWith("app/api/"));
    const serverImports = rendered.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => /["']@\/server\//.test(line) || /["'](\.\.\/)+server\//.test(line))
        .map((line) => `${fromSrc(path)}: ${line.trim()}`),
    );
    // A new line here means a page or component now runs server code while it renders. That is fine,
    // as long as it reads no clock and no random source before `await io()` (or inside getSession()).
    // Check it against a production build, then add the line.
    expect(serverImports.sort()).toEqual([
      'app/admin/page.tsx: import { getSession } from "@/server/auth/session";',
      'app/page.tsx: import { getSession } from "@/server/auth/session";',
    ]);
  });

  it("every route handler is built with handle()", () => {
    const routes = sourceFiles(join(SRC, "app", "api")).filter((path) => /[\\/]route\.ts$/.test(path));
    expect(routes.length).toBeGreaterThan(20);
    const bare = routes.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => /^export\b.*\b(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/.test(line))
        .filter((line) => !/^export const (GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE) = handle(<.*>)?\(/.test(line))
        .map((line) => `${fromSrc(path)}: ${line.trim()}`),
    );
    expect(bare).toEqual([]);
  });

  it("handle() stops at request.url before it reads a clock or makes an id", async () => {
    // In a build-time prerender Next.js hands the handler a request whose `url` ends the prerender by
    // throwing. `method` is not guarded. This request does the same.
    const stopped = new Error("request.url was read: Next.js ends the prerender here");
    const request = new Proxy(new Request("http://localhost:3000/api/health"), {
      get(target, prop) {
        if (prop === "url") throw stopped;
        return Reflect.get(target, prop, target);
      },
    });
    let handlerRan = false;
    const GET = handle(async () => {
      handlerRan = true;
      return { time: new Date().toISOString() };
    });

    randomUuidCalls.count = 0;
    const run = inPrerender("prerender", "/api/health", () => GET(request, { params: Promise.resolve({}) }));
    await expect(run.result).rejects.toBe(stopped);
    expect(handlerRan).toBe(false);
    expect(run.unstableRead()).toBeNull();
    expect(randomUuidCalls.count).toBe(0);
  });
});
