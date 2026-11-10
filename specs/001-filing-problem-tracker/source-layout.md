# Source layout

Where things live and what each file is responsible for. The dependency rule is the part that matters most: it is what keeps secrets and server logic out of the browser.

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
| `panels.ts` | The panel contract shared by dashboard, workspace, AI and MCP. `PanelType` = `kpi \| ranked \| heat \| forms \| trend \| before_after \| compare_counties \| needs_review`. `PanelSpec` is a Zod discriminated union: `{ id, type, title, size: "s" \| "w" \| "l", params }` with typed `params` per type (each built from `Filters` plus type-specific fields such as `dimension`, `eventId`, `counties`). `computePanel(spec, records, events, todayIso): PanelData` is the single place numbers are computed. `Folder { id, name, panels: PanelSpec[] }`. |
| `time.ts` | Month helpers and `todayIso(mode)`: in demo mode the app's "today" is `SAMPLE_TODAY` so the sample data is never stale. |

### `src/server` (server only)

| File | Contents |
|---|---|
| `config.ts` | Reads and validates env once with Zod. Exposes `APP_MODE`, `AI_ENABLED`, `AI_MODEL` (default `claude-fable-5-2`), limits. Throws a clear error at startup on a half-configured environment. |
| `auth/session.ts` | `getSession(): Promise<SessionUser \| null>`, `requireSession(roles?)` (throws `HttpError(401 \| 403)`). Demo implementation: HMAC-signed cookie `fpt_demo` holding one of the fixed demo users. Supabase implementation: `@supabase/ssr` server client + `profiles` row. |
| `repo/types.ts` | `interface Repository` (see [data-model.md](data-model.md)). |
| `repo/memory.ts` | In-memory implementation on `globalThis`, seeded from `sample.ts`. Enforces the same access rules as the SQL policies, in code, so demo mode and tests exercise authorization. |
| `repo/supabase.ts` | Supabase implementation using the caller's session (never the service role key) so row level security applies. |
| `repo/index.ts` | `getRepository(session)`. |
| `http.ts` | `HttpError`, `handle(fn)` wrapper for route handlers: assigns a request id, parses JSON, maps `ZodError -> 400`, `HttpError -> its status`, anything else -> 500 with a generic body, logs `{requestId, route, userId, status, ms}` as one JSON line. Never returns stack traces. |
| `ratelimit.ts` | `limit(key, {max, windowMs})` token bucket behind an interface (in-memory now; swap for Redis/Upstash later). |
| `audit.ts` | `audit(session, action, entity, entityId, detail)` -> repository. Detail never contains note text. |
| `ai/client.ts` | One Anthropic client. `callClaude` wrapper: timeout, one place for model + `fallbacks`, checks `stop_reason` (handles `refusal` and `max_tokens`), typed errors. |
| `ai/classify.ts`, `ai/summary.ts`, `ai/compose.ts` | The three AI features (see [contracts/ai.md](contracts/ai.md)). Each has a deterministic non-AI fallback and returns `{ source: "ai" \| "rules", ... }`. |
| `tools.ts` | Read-only aggregate tools shared by the MCP endpoint: `get_problem_counts`, `get_county_breakdown`, `get_form_breakdown`, `compare_before_after`, `list_reference_values`. Built on `stats.ts`. |
