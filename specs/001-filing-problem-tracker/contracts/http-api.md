# Contract: HTTP API and MCP endpoint

Route handlers live in `src/app/api/**/route.ts`.

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
| `GET /api/events`, `POST /api/events`, `DELETE /api/events/[id]` | Change events. |
| `GET /api/folders`, `POST /api/folders`, `DELETE /api/folders/[id]` | Workspace folders. |
| `POST /api/ai/summary` | Body: `Filters` + optional event/tag. Server recomputes the aggregates itself (never trusts numbers from the client) and asks Claude for three to five plain sentences. |
| `POST /api/ai/compose` | Body: `{ request: string }`. Returns `{ panels: PanelSpec[], notice?: string, source }`. |
| `POST /api/mcp` | MCP server, Streamable HTTP, read-only tools, bearer token. |
| `POST /api/demo/login`, `POST /api/demo/reset` | Demo mode only (404 in supabase mode). |

Client data flow: a `DataProvider` (client context) loads `/api/flags` and `/api/events`, re-fetches after every mutation and every 30 seconds while the tab is visible. Dashboard and workspace panels compute from those records with `computePanel`, so every panel is live and filter changes never hit the server or the AI.

## MCP endpoint

`/api/mcp` exposes the read-only tools in `src/server/tools.ts` so a court leader can ask about the tracker from inside Claude. Aggregates only. Auth: `Authorization: Bearer <token>`. Demo mode compares against `MCP_TOKEN` (endpoint disabled if unset). Supabase mode looks up the SHA-256 hash in `mcp_tokens` (per user, revocable) and runs the tools with that user's scope. Constant-time comparison.
