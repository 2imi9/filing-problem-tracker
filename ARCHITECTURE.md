# Filing Problem Tracker: architecture

A standalone web app for Indiana trial courts. When a filing from an unrepresented (self-represented) litigant is rejected or sent back, a clerk tags what was wrong in a few clicks. Court leaders see which problems are most common by county, case type and form, and whether a change (a revised form, a guide, a kiosk) reduced them. It sits next to Odyssey and e-filing and changes neither. It never gives legal advice and never stores names, case numbers or anything that identifies a litigant.

Course project: Northeastern CS4535 AI for Impact, Team 1. All shipped data is made up.

## Stack

- Next.js 16 (App Router, TypeScript, `src/` directory, no Tailwind). Read `node_modules/next/dist/docs/` before writing Next.js code; this version differs from older ones (for example the request interceptor file is `proxy.ts`, see `01-app/03-api-reference/03-file-conventions/proxy.md`).
- Zod 4 for every schema. Supabase (Postgres + Auth) for production data. `@anthropic-ai/sdk` for AI. `@modelcontextprotocol/sdk` for the MCP endpoint.
- Vitest (unit), PGlite (row level security tests against real Postgres semantics, no Docker), Playwright + axe (end to end and accessibility).

## Two run modes, one code path

`APP_MODE` is derived in `src/server/config.ts`:

- **demo** (default when Supabase env vars are absent): data lives in a process-global in-memory repository seeded with the sample data; sign-in is a role picker that sets a signed, httpOnly cookie. Used for local development, automated tests, and the class demo. Data resets when the server restarts; the UI says so.
- **supabase** (when `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set): Postgres with row level security, magic-link sign-in, invite only.

Pages and route handlers never know which mode is active. They call `getSession()` and `getRepository(session)`.

## Layers and dependency rule

```
src/lib/        pure domain code. No I/O, no Next, no env. Runs in browser, server and tests.
src/server/     server-only code (import "server-only"). Repositories, auth, AI, audit, rate limit, config.
src/app/        routes: pages (UI) and api/**/route.ts (HTTP).
src/components/ React components. Client components may import src/lib only, never src/server.
```

Imports point downward only: `app -> components -> lib`, `app -> server -> lib`. `lib` imports nothing from the other three.

### `src/lib` (pure)

| File | Contents |
|---|---|
| `domain.ts` | `COUNTIES`, `CASES` (case type -> forms), `CASE_TYPES`, `TAGS`, `OUTCOMES`, `NEEDS_REVIEW`, types `Role = "clerk" \| "leader" \| "admin"`, `Outcome`, `Source = "sample" \| "clerk" \| "import"`, `FlagRecord`, `LeanFlag` (a `FlagRecord` without `note` and `reason`), `ChangeEvent`, `SessionUser { id, email, role, county \| null }`. |
| `schemas.ts` | Zod schemas: `NewFlagInput`, `ImportRow`, `ChangeEventInput`, `FolderInput`, `Filters { county?, caseType?, form?, tag?, fromMonth?, toMonth? }`. Every value is checked against the reference lists in `domain.ts`. `note` max 200 chars. Dates `YYYY-MM-DD`, not in the future, not before 2020. |
| `pii.ts` | `findPersonalData(text): PiiFinding[]`. Flags things that look like a case number (Indiana uniform case number pattern such as `49D01-2401-SC-000123`, and looser digit-letter runs), phone, email, SSN, street address, and "Firstname Lastname". Known vocabulary (county names, form names, tag names, month names, words like "Small Claims") is allow-listed. Returns kind + matched text. Used on notes and on imported reasons. |
| `stats.ts` | Pure functions over `LeanFlag[]`: `applyFilters`, `countTags`, `rank`, `kpis`, `countyByProblem`, `byForm`, `monthlySeries`, `beforeAfter(records, event, tag, todayIso)` (full months only, the month in progress is excluded), `compareCounties`, `sparkline`. No dates from the system clock: "today" is always a parameter. |
| `csv.ts` | `parseCSV`, keyword `classify(reason)`, `rowsFromCsv(text)`. Limits: 5 MB, 10,000 rows. |
| `sample.ts` | `makeSampleRecords()` with mulberry32 seed 4535, 900 records, Jan 1 to Oct 28 2026, plus the three sample change events and `SAMPLE_CSV`. Deterministic. `SAMPLE_TODAY = "2026-10-30"`. |
| `panels.ts` | The panel contract shared by dashboard, workspace, AI and MCP. `PanelType` = `kpi \| ranked \| heat \| forms \| trend \| before_after \| compare_counties \| needs_review`. `PanelSpec` is a Zod discriminated union: `{ id, type, title, size: "s" \| "w" \| "l", params }` with typed `params` per type (each built from `Filters` plus type-specific fields such as `dimension`, `eventId`, `counties`). `computePanel(spec, records, events, todayIso, viewer?): PanelData` is the single place numbers are computed. `viewer.county` is the one county a clerk is held to, so a panel's scope line names that county and never says "All counties" over one county's data. `Folder { id, name, panels: PanelSpec[] }`. |
| `time.ts` | Month helpers and `todayIso(mode, now)`: in demo mode the app's "today" is `SAMPLE_TODAY` so the sample data is never stale. Otherwise it is the date of `now` in Indianapolis; the caller passes `now`, so nothing in `src/lib` reads the clock. |

### `src/server` (server only)

| File | Contents |
|---|---|
| `config.ts` | Reads and validates env once with Zod. Exposes `APP_MODE`, `AI_ENABLED`, `AI_MODEL` (default `claude-fable-5-2`), limits. Throws a clear error at startup on a half-configured environment. |
| `auth/session.ts` | `getSession(): Promise<SessionUser \| null>`, `requireSession(roles?)` (throws `HttpError(401 \| 403)`). Demo implementation: HMAC-signed cookie `fpt_demo` holding one of the fixed demo users. Supabase implementation: `@supabase/ssr` server client + `profiles` row. |
| `repo/types.ts` | `interface Repository` (below). |
| `repo/memory.ts` | In-memory implementation on `globalThis`, seeded from `sample.ts`. Enforces the same access rules as the SQL policies, in code, so demo mode and tests exercise authorization. |
| `repo/supabase.ts` | Supabase implementation using the caller's session (never the service role key) so row level security applies. |
| `repo/index.ts` | `getRepository(session)`. |
| `http.ts` | `HttpError`, `handle(fn)` wrapper for route handlers: assigns a request id, parses JSON, maps `ZodError -> 400`, `HttpError -> its status`, anything else -> 500 with a generic body, logs `{requestId, route, userId, status, ms}` as one JSON line. Never returns stack traces. |
| `ratelimit.ts` | `limit(key, {max, windowMs})` token bucket behind an interface (in-memory now; swap for Redis/Upstash later). |
| `audit.ts` | `audit(session, action, entity, entityId, detail)` -> repository. Detail never contains note text. |
| `ai/client.ts` | One Anthropic client. `callClaude` wrapper: timeout, one place for model + `fallbacks`, checks `stop_reason` (handles `refusal` and `max_tokens`), typed errors. |
| `ai/classify.ts`, `ai/summary.ts`, `ai/compose.ts` | The three AI features (below). Each has a deterministic non-AI fallback and returns `{ source: "ai" \| "rules", ... }`. |
| `tools.ts` | Read-only aggregate tools shared by the MCP endpoint: `get_problem_counts`, `get_county_breakdown`, `get_form_breakdown`, `compare_before_after`, `list_reference_values`. Built on `stats.ts`. |

```ts
interface Repository {
  listFlags(): Promise<LeanFlag[]>                    // visible to this session; never includes note/reason
  listMyRecent(limit: number): Promise<FlagRecord[]>  // the caller's own entries, with notes
  listNeedsReview(): Promise<FlagRecord[]>            // imported rows tagged NEEDS_REVIEW, in scope
  createFlag(input: NewFlagInput): Promise<FlagRecord>
  createFlags(rows: ImportRow[], batchName: string): Promise<{ batchId: string; inserted: number }>
  softDeleteFlag(id: string): Promise<void>           // own entry, within 5 minutes; admin any time
  restoreFlag(id: string): Promise<void>              // a clerk: only an entry they removed themselves
  listEvents(): Promise<ChangeEvent[]>
  upsertEvent(input: ChangeEventInput): Promise<ChangeEvent>   // admin only
  deleteEvent(id: string): Promise<void>                       // admin only
  listFolders(): Promise<Folder[]>                    // the caller's own
  saveFolder(input: FolderInput): Promise<Folder>
  deleteFolder(id: string): Promise<void>
  appendAudit(entry: AuditEntry): Promise<void>
  listAudit(limit: number): Promise<AuditEntry[]>     // admin only
}
```

## Access rules (the same in SQL policies and in `repo/memory.ts`)

| | clerk | leader | admin |
|---|---|---|---|
| Read flags | own county | all counties | all |
| Read notes / raw reasons | own entries; own county's needs-review rows | no | all |
| Create flag / import | own county only | no | any county |
| Delete own flag | within 5 minutes | no | any time |
| Change events | read | read | read + write |
| Folders | own | own | own |
| Audit log | no | no | read |

A clerk's county comes from their profile, never from the request body. A request that names another county is rejected with 403, not silently rewritten.

## HTTP API (`src/app/api/**/route.ts`)

All handlers use `handle()`, call `requireSession`, validate with Zod, then call the repository. Mutations are audited.

| Route | Purpose |
|---|---|
| `GET /api/health` | `{ ok, mode, ai, time }`. No auth. |
| `GET /api/me` | Session user and mode. |
| `GET /api/flags` | `LeanFlag[]` for the session's scope. `POST` creates one (PII check on note; 422 with findings). |
| `DELETE /api/flags/[id]`, `POST /api/flags/[id]/restore` | Soft delete / undo. |
| `GET /api/flags/recent` | Caller's last entries with notes. |
| `POST /api/import/preview` | Body: CSV text. Parses, PII-checks each reason, classifies (AI if enabled and requested, else rules), returns rows with tags, source, confidence, and rejected rows with reasons. Nothing is saved. |
| `POST /api/import/commit` | Body: the reviewed rows. Re-validates everything server-side and saves as one batch. |
| `GET /api/events`, `POST /api/events`, `DELETE /api/events/[id]` | Change events. A name or description holding something that looks like a case number, phone number, email address, Social Security number or street address is refused with 422. |
| `GET /api/flags/needs-review` | The Needs review rows the caller may see, with their reasons. |
| `GET /api/audit` | The newest audit entries. Admin only. |
| `GET /api/folders`, `POST /api/folders`, `DELETE /api/folders/[id]` | Workspace folders. |
| `POST /api/ai/summary` | Body: `Filters` + optional event/tag. Server recomputes the aggregates itself (never trusts numbers from the client) and asks Claude for three to five plain sentences. |
| `POST /api/ai/compose` | Body: `{ request: string }`. Returns `{ panels: PanelSpec[], notice?: string, source }`. |
| `POST /api/mcp` | MCP server, Streamable HTTP, read-only tools, bearer token. |
| `POST /api/demo/login`, `POST /api/demo/logout`, `POST /api/demo/reset` | Demo mode only (404 in supabase mode). |
| `POST /api/auth/magic-link`, `GET /api/auth/callback`, `POST /api/auth/sign-out` | Supabase mode only (404 in demo mode). The emailed link opens the page `/auth/confirm`, whose Sign in button sends the one-time token to the callback, so a mail scanner that only opens the link does not use it up. Signing in and out are written to the audit log. |

Client data flow: a `DataProvider` (client context) loads `/api/flags` and `/api/events`, re-fetches after every mutation and every 30 seconds while the tab is visible. Dashboard and workspace panels compute from those records with `computePanel`, so every panel is live and filter changes never hit the server or the AI.

## AI features (Claude API, `claude-fable-5-2`)

Read the `claude-api` skill's TypeScript docs before writing these. Rules that apply to this model: do not send `thinking`, `temperature`, `top_p` or `budget_tokens`; forced `tool_choice` (`any` / `tool`) is rejected, so use `auto` plus `strict: true` tools or structured outputs; no assistant prefill; always check `stop_reason` before reading content; enable server-side `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`; set `output_config.effort` explicitly (`low` for classify and compose, `medium` for summary).

1. **Classify** imported rejection reasons. Structured output: for each row id, zero or more tags from the fixed list plus `confidence: high | medium | low`. Anything unknown, empty, malformed or low confidence becomes Needs review. Reasons that fail the PII check are never sent to the model. Batches of up to 40 distinct reasons, so one reply stays well inside the output limit.
2. **Summary** for court leaders. Input is aggregates only. System prompt: describe only the numbers provided, invent nothing, no legal advice, no advice to filers, say "the sample data shows" in demo mode. After generation the server checks that every number in the text appears in the supplied aggregates; if not, the summary is discarded and the UI shows "Summary unavailable".
3. **Compose** the workspace. One tool per panel type with a strict JSON schema, plus the reference lists in the system prompt. Claude only chooses panel types, filters and short titles. It never writes numbers; `computePanel` does. Every tool call is validated with the `PanelSpec` schema; invalid calls are dropped. Max 6 panels per request. If nothing valid comes back, the keyword fallback runs.

Without `ANTHROPIC_API_KEY` every feature uses its fallback: keyword rules for classify, "Summary unavailable" for summary, keyword-to-filter matching for compose. The app is fully usable with no key.

Privacy line: the model sees (a) rejection reasons that passed the PII check and (b) aggregate counts. It never sees notes, user identities, or row-level data beyond the reason text. Nothing AI-generated is shown to litigants; there is no litigant-facing surface.

Rate limits: 20 AI requests per user per minute, 60 mutations per user per minute. 429 with `Retry-After`.

## MCP endpoint

`/api/mcp` exposes the read-only tools in `src/server/tools.ts` so a court leader can ask about the tracker from inside Claude. Aggregates only. Auth: `Authorization: Bearer <token>`. Demo mode compares against `MCP_TOKEN` (endpoint disabled if unset). Supabase mode looks up the SHA-256 hash in `mcp_tokens` (per user, revocable) and runs the tools with that user's scope. Constant-time comparison.

## Database (`supabase/migrations`)

Tables: `profiles(user_id pk -> auth.users, role, county)`, `filing_flags(id, county, filed_on, case_type, form, tags text[], outcome, note, reason, source, batch_id, created_by, created_at, deleted_at, deleted_by)`, `import_batches`, `change_events`, `workspace_folders(owner, name, panels jsonb)`, `workspace_seeds(owner)` (who has already been given the example folders, so a deleted example does not come back), `audit_log`, `mcp_tokens(token_hash, user_id, revoked_at)`.

- Check constraints mirror the Zod schemas (tag and county values, note length, date range).
- Row level security is enabled and forced on every table; policies implement the access table above. Helper functions `app_role()` and `app_county()` are `security definer` with a fixed `search_path`.
- Leaders must not read `note` / `reason`. They read through the view `flags_lean` (`security_invoker`), and column privileges on the base table exclude those columns for the leader path.
- Indexes on `(county, filed_on)`, `(filed_on)`, and a GIN index on `tags`.
- `supabase/seed.sql` is generated from `sample.ts` by `scripts/gen-seed.ts`, so SQL and demo data cannot drift.

## UI

Sidebar navigation on desktop (Tag a filing, Import, Dashboard, Workspace, How it's used, Admin for admins); fixed bottom tab bar under 820px. Clerks land on Tag a filing, leaders on Dashboard. A visible "Prototype. All data is made up." flag on every page in demo mode.

- **Tag a filing**: county (fixed for clerks), case type, form, numbered problem chips (keys 1 to 9 toggle while focus is on the entry, with a switch to turn them off; Enter saves), outcome, optional note with live PII warning, saved toast with Undo, recent entries.
- **Import**: paste or upload CSV, preview with per-row source (AI or rules) and confidence, rejected rows listed with the reason, commit.
- **Dashboard**: sticky filter bar with removable chips, KPI tiles with sparklines, ranked problems, outcomes, county x problem heat table, forms table, before/after panel, optional AI summary on request.
- **Workspace**: a command bar instead of a chat. A request opens panels on a grid. Panels can be re-filtered by hand, resized (s / w / l), reordered (drag, and keyboard-accessible move buttons), minimized, duplicated, closed. A folder rail saves and reopens sets of panels. Three example folders ship with the sample data. "Add panel" menu works with no AI.
- **How it's used**: three scenario cards with inline SVG line illustrations, and the courthouse loop (`public/media/courthouse_leaves_loop.mp4`, poster `courthouse_leaves_still.png`) as the header, replaced by the still under `prefers-reduced-motion`.

### Design system (generated with ui-ux-pro-max, then adapted)

Source: the `ui-ux-pro-max` skill (MIT, github.com/nextlevelbuilder/ui-ux-pro-max-skill), queried for a government / court internal analytics and data entry tool with dials variance 5, motion 2, density 7. The full record is in `design-system/MASTER.md`. Its landing-page pattern and GSAP scroll reveal are not used: this is an internal tool, not a marketing page, and it adds no animation library.

- **Style**: "Accessible & Ethical" (the skill's match for government, legal compliance and public-sector tools) with the layout habits of its "Data-Dense Dashboard" style on the dashboard and workspace: 12-column grid, KPI row, compact cards (12 to 16px padding), 36px table rows, sticky table headers, 240px sidebar, 56px header.
- **Color tokens** (CSS variables in `globals.css`; light values shown, with a full dark theme):

  | Token | Value | Use |
  |---|---|---|
  | `--color-primary` | `#1E3A8A` | navigation, selected state, links, focus ring |
  | `--color-secondary` | `#1E40AF` | hover on primary |
  | `--color-accent` | `#B45309` | the one primary action per view (Save tags, Add rows, Open panels). Nothing else. |
  | `--color-background` | `#F8FAFC` | page |
  | `--color-card` | `#FFFFFF` | panels |
  | `--color-foreground` | `#0F172A` | text |
  | `--color-muted` / `--color-muted-foreground` | `#E9EEF5` / `#475569` | quiet surfaces / secondary text |
  | `--color-border` | `#CBD5E1` | hairlines |
  | `--color-destructive` | `#DC2626` | Rejected, errors (text on white uses `#B91C1C` for 4.5:1) |
  | `--color-success` | `#166534` | Fixed at counter, a drop in the before/after figure |

  "Authority navy and trust gold". Color is never the only signal: outcome pills carry their label, heat table cells print their number, the trend line has point markers and a data table alternative.
- **Type**: headings EB Garamond (legal, formal, document-like); body Lato; numbers, dates and data in IBM Plex Mono with tabular figures. Fonts are self-hosted from `src/fonts` through `next/font/local` so builds need no network. Body text is 16px minimum; dense tables may go to 14px. KPI numerals about 40px.
- **Key effects**: clear 3px focus rings, a skip link to main content, 44x44px minimum touch targets, `cursor: pointer` on everything clickable, hover transitions 150 to 300ms, reduced motion respected.
- **Shape**: inputs 4px radius, cards 6px, dialogs 10px, pills full. Hairline borders, no decorative shadows.
- **Charts** (the skill's chart guidance): ranked bar lists sorted descending with direct value labels; line chart for monthly trends with markers; heat table prints values in cells and includes a legend; every chart has a visible or toggleable data table and a one-sentence summary. Plain SVG, no chart library.
- **Forms** (the skill's UX guidance): on a failed submit, an error summary at the top of the form with `role="alert"` receives focus and links to each invalid field, and inline errors stay. Every submit shows loading, then success or an error with a way to recover.
- **Motion**: two moments only, the saved toast and new workspace panels highlighting once.
- **Avoid** (the skill's anti-patterns for this product type, plus its delivery checklist): an outdated look, purple or pink "AI" gradients, gradient text, glass blur, emoji used as icons (use inline SVG icons), hype copy.
- **Pre-delivery checklist**: no emoji icons; pointer cursor on clickables; hover states; 4.5:1 text contrast in both themes; visible keyboard focus; reduced motion; responsive at 375, 768, 1024 and 1440px with no horizontal page scroll (tables scroll inside their panel); semantic HTML (`table`, `nav`, `button`, `dialog`), every input labeled, `aria-pressed` on chips, `aria-live` for status.

When a UI decision is not covered here, query the skill instead of guessing: `python3 -I <skill>/scripts/search.py "<question>" --domain ux|chart|style|typography|color` or `--stack nextjs`.

Copy is plain and specific: say what a control does. No legal advice anywhere; labels describe what was wrong with a filing, never what a filer should do.

## Security

- Secrets are server-only; `NEXT_PUBLIC_` is used only for the Supabase URL and anon key. `scripts/check-bundle.mjs` greps the client build output for secret names and fails CI if any appear.
- Headers in `next.config.ts`: CSP (no `unsafe-eval` in production; `script-src` is `'self' 'unsafe-inline'` and not nonce based, because pages are prerendered with `cacheComponents` and a prerendered shell cannot carry a per-request nonce; `SECURITY.md`, "Content-Security-Policy", has the reasoning and the way to close the gap), `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` denying camera, microphone and geolocation.
- State-changing routes check the `Origin` header against the app's own origin.
- Every page and route is protected on the server (`proxy.ts` redirects unauthenticated page requests to `/login` and answers unauthenticated API requests with 401; each handler still calls `requireSession`). The sign-in page, `/auth/confirm`, `/api/auth/*`, `/api/demo/login`, `/api/demo/logout`, `/api/health` and `/api/mcp` (which checks its own bearer token) are the only paths reachable signed out.
- Demo cookie is signed with `DEMO_COOKIE_SECRET`; production refuses to start in demo mode without it unless `ALLOW_DEMO=1`.
- A configuration error ends the server process at startup with status 1 (`src/instrumentation.ts`, `src/server/startup.ts`).
- Sign-in attempts are limited per network address, read from `X-Forwarded-For` only as far as `TRUSTED_PROXY_HOPS` allows (`src/server/clientAddress.ts`).
- When Supabase Auth cannot be reached the answer is 503 (`unavailable`), never "signed out".

## Tests

- `tests/unit/**`: stats, csv, pii, schemas, panels, memory repository authorization, AI wrappers with a mocked SDK (including refusal, malformed output, and the number check on summaries), rate limiter, http wrapper.
- `tests/rls/**`: PGlite loads a small shim for the `auth` schema and the `authenticated` role, applies the real migrations, then checks the access table row by row as a clerk in county A, a clerk in county B, a leader and an admin.
- `e2e/**`: Playwright against `next build && next start` in demo mode with AI off: sign in by role and land on the right page; clerk tags a filing with the keyboard and the leader dashboard total goes up by one; undo; PII in a note is refused; CSV import; workspace request opens panels through the keyword fallback, a filter chip edits without a network call to `/api/ai/*`, folder save and reopen; a clerk cannot open the admin page or another county's data; axe finds no serious or critical issues on any page in light and dark; no horizontal scroll at 375px.
- CI (`.github/workflows/ci.yml`): lint, typecheck, unit, RLS, build, bundle secret check, e2e.

## Not done, on purpose

Using real court records needs the court's IT and security review, a data agreement, and approved hosting. `PILOT.md` lists that work. Nothing in this repository makes that decision for the court.
