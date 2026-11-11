# Contract: HTTP API and MCP endpoint

Route handlers live in `src/app/api/**/route.ts`. Response shapes are typed in `src/lib/api.ts`.

Every handler runs inside `handle()` (`src/server/http.ts`), calls `requireSession`, validates the body with a strict Zod schema, then calls the repository. Changes are rate limited and audited.

| Route | Who | Purpose |
|---|---|---|
| `GET /api/health` | anyone | `{ ok, mode, ai, aiModel, time }`. No sign-in. `aiModel` is the configured model's name when AI is on and `null` when it is off; the page footer names it. |
| `GET /api/me` | signed in | `{ user, mode, ai, aiModel, today }`. |
| `GET /api/flags` | signed in | Flags in the caller's scope, without notes or reasons. |
| `POST /api/flags` | clerk, admin | Creates one flag. A note that fails the personal-data check gets 422 with what was found. |
| `DELETE /api/flags/[id]`, `POST /api/flags/[id]/restore` | clerk, admin | Remove an entry, and undo that. |
| `GET /api/flags/recent?limit=` | signed in | The caller's own latest entries, with notes. |
| `GET /api/flags/needs-review` | clerk, admin | Imported rows marked "Needs review", with their reasons. |
| `POST /api/import/preview` | clerk, admin | Body `{ csv, useAi? }`. Parses, checks each reason for personal data, sorts (AI when asked for and switched on, otherwise keyword rules). Returns accepted rows with tags, source and confidence, plus rejected rows with the reason. Nothing is saved. |
| `POST /api/import/commit` | clerk, admin | Body `{ rows, batchName? }`. Checks every row again on the server and saves them as one batch, all or nothing. |
| `GET /api/events` | signed in | Recorded changes. |
| `POST /api/events`, `DELETE /api/events/[id]` | admin | Add, replace or delete a recorded change. A name or description that looks like a case number, phone number, email address, Social Security number or street address gets 422. |
| `GET /api/folders`, `POST /api/folders`, `DELETE /api/folders/[id]` | signed in | The caller's own workspace folders. |
| `GET /api/audit?limit=` | admin | The newest audit entries. |
| `POST /api/ai/summary` | signed in | Body `{ filters, eventId?, tag? }`. The server counts from the records the caller may see and sends only those counts to the model. Returns `{ available: true, summary, source }` or `{ available: false, reason }`. |
| `POST /api/ai/compose` | signed in | Body `{ request }`. Returns `{ panels, notice?, source }`. |
| `POST /api/mcp` | bearer token | MCP server over Streamable HTTP, read-only tools. |
| `POST /api/demo/login`, `POST /api/demo/logout`, `POST /api/demo/reset` | demo mode | Pick a demo account (`{ userId }`), sign out, restore the sample data. 404 in Supabase mode. |
| `POST /api/auth/magic-link`, `GET /api/auth/callback`, `POST /api/auth/sign-out` | Supabase mode | Email a sign-in link (`{ email, next? }`), trade the link for a session, sign out. 404 in demo mode. The answer to a link request is the same whether or not the address has an account. |

## Rules for every route

- A request without a session gets 401 from `src/proxy.ts` before it reaches a handler. When Supabase Auth cannot be reached the answer is 503 with `Retry-After`, never "signed out".
- A state-changing request must carry the app's own `Origin` (`APP_ORIGIN` when set, otherwise the request's host), or it gets 403 `bad_origin`. `/api/mcp` is the exception: it takes no cookie.
- Errors have one shape: `{ error: { code, message, requestId } }`, with `issues` for a refused field and `findings` for personal data. The request id is also sent as `x-request-id`.
- Limits per person per minute: 60 changes and 20 AI requests by default (`RATE_LIMIT_MUTATIONS_PER_MINUTE`, `RATE_LIMIT_AI_PER_MINUTE`). Sign-in attempts are limited per network address. Over the limit: 429 with `Retry-After`.
- Sizes: a body up to 6 MB, a CSV up to 5 MB and 10,000 rows, a note up to 200 characters, a reason up to 500.

Client data flow: a `DataProvider` (client context) loads `/api/flags` and `/api/events`, loads them again after every change and every 30 seconds while the tab is visible. Dashboard and workspace panels compute from those records with `computePanel`, so every panel is live and a filter change never calls the server or the AI.

## MCP endpoint

`POST /api/mcp` offers the five read-only tools in `src/server/tools.ts`: `get_problem_counts`, `get_county_breakdown`, `get_form_breakdown`, `compare_before_after` and `list_reference_values`. They return counts and reference lists, never a filing, a note or a reason.

Auth is `Authorization: Bearer <token>`. In demo mode the token is `MCP_TOKEN` and acts as the demo court leader; with no token set the endpoint answers 404. In Supabase mode each person has their own token: only its SHA-256 hash is stored in `mcp_tokens`, it can be revoked, the tools see what that person may see, and `SUPABASE_SERVICE_ROLE_KEY` must be set. The demo token is compared in constant time, and requests are rate limited per token holder.
