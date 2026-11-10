# Contributing

Read `ARCHITECTURE.md` first. It is the specification, and where it and the code disagree one of them has a bug. `AGENTS.md` matters too: this project uses a recent Next.js whose conventions differ from older versions, and the guides that match the installed version are in `node_modules/next/dist/docs/`. Read the relevant one before changing routing, caching, the proxy or `next.config.ts`.

## Setup

Node 22 and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000 and pick a demo role. No database, no API key and no `.env.local` are needed.

## Ground rules

- **No personal data, anywhere.** No names and no case numbers in sample data, tests, fixtures, screenshots, commit messages or issues. Made-up test strings that look like personal data belong only in the tests of the personal data check.
- **No legal advice in any text.** Labels and messages describe what was wrong with a filing. They never say what a filer should do.
- **No emoji** in the interface, the documentation or comments. Icons are inline SVG.
- **Plain words.** Say what a control does. No hype.
- **TypeScript strict.** No `any` unless it cannot be avoided, and then with a comment that says why. No dead code, no placeholder implementations.

## Layers

```
src/lib/         pure code: no I/O, no Next.js, no environment. Runs in the browser, on the server and in tests.
src/server/      server only. Every module starts with: import "server-only"
src/app/         pages and API routes
src/components/  React components
```

Imports point downward: `app -> components -> lib` and `app -> server -> lib`. Client components import from `src/lib` and `src/components` only, never from `src/server`. `npm run check:bundle` fails the build if server code or a secret reaches the browser bundle.

"Today" is never read from the clock inside `src/lib`. It is a parameter. Server code gets it from `appToday()` in `src/server/clock.ts`; pages get it from `GET /api/me`.

## Checks

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates the route types (`next typegen`), then `tsc --noEmit` |
| `npm run test:unit` | Vitest, `tests/unit` |
| `npm run test:rls` | Vitest, `tests/rls`: the SQL access rules against Postgres in memory (PGlite) |
| `npm run build` | Production build |
| `npm run check:bundle` | Scans `.next/static` for secret names, secret values and server code. Needs a build. |
| `npm run test:e2e` | Playwright against a production build in demo mode. Builds and starts the server itself on port 3100. |
| `npm run verify` | All of the above, in that order |

Run `npm run verify` before opening a pull request. CI (`.github/workflows/ci.yml`) runs the same steps and must pass.

Notes on the end-to-end tests: they need Chromium (`npx playwright install chromium`). `E2E_SKIP_BUILD=1 npm run test:e2e` serves the build that is already in `.next`. `E2E_PORT` changes the port. A server already listening on the port is reused outside CI, so stop a stale one first. The tests share one in-memory data set and run one at a time.

## Common changes

**A route handler.** Wrap it in `handle()` from `src/server/http.ts`, call `requireSession()` first, validate the body with a Zod schema, call the repository, and call `audit()` after a change. `handle()` does the Origin check, the error mapping and the request log. Do not catch errors to return your own 500.

**A value on a reference list** (county, form, problem, outcome). Change `src/lib/domain.ts`, then add a new SQL migration that replaces the matching function from `supabase/migrations/20261110120000_reference_values.sql`. `tests/rls/drift.test.ts` fails until the two agree. Do not edit a migration that has already been applied anywhere.

**The sample data.** Change `src/lib/sample.ts`, run `npm run seed:gen` to regenerate `supabase/seed.sql`, and commit both. A test fails when they differ.

**A panel type.** The schema and its parameters are in `src/lib/schemas.ts`, the numbers in `computePanel` in `src/lib/panels.ts`, the drawing in `src/components/panels`. Numbers are computed in `computePanel` and nowhere else, so the dashboard, the workspace, the AI summary and the MCP tools cannot disagree.

**An environment variable.** Read it in `src/server/config.ts` only, with a Zod rule and a plain error message. Add it to `.env.example` and to the table in `README.md`. If it is a secret, add its name to `SECRET_NAMES` in `scripts/check-bundle.mjs`. Only a value the browser truly needs may start with `NEXT_PUBLIC_`.

**Anything that calls the AI.** Go through `callClaude` in `src/server/ai/client.ts`. Send counts or checked text, never notes, never rows. Validate what comes back, and keep a path that works with no API key. Update "The AI features" in `README.md` if what the model sees changes.

**A response header or the Content-Security-Policy.** They are in `next.config.ts`. Update the "HTTP response headers" section of `SECURITY.md` in the same change, and check the pages in a browser with the console open: a policy that is too tight fails silently for users.

## Pull requests

Keep them small and say what you ran. If a change affects what data is stored, who can read it, or what leaves the server, say so in the description and update `SECURITY.md`. Do not commit `.env.local` or any key.

## Reporting a security problem

Not in a public issue. See `SECURITY.md`.
