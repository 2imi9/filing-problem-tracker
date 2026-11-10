# Research: decisions and alternatives

Decisions the plan depends on that the constitution does not already state.

## 1. Two run modes behind one code path

- **Decision**: A demo mode (in-memory sample data, role picker) and a Supabase mode (Postgres, magic-link sign-in, invite only). Pages and routes call `getSession()` and `getRepository(session)` and never branch on the mode.
- **Rationale**: The class demo, local development and CI need zero setup. A pilot needs a real database. One code path keeps them from drifting.
- **Alternatives considered**: A hosted database for everything (every tester needs an account, CI needs secrets). A separate demo app (two apps to keep in step).

## 2. One repository interface; access rules in the database

- **Decision**: All data access goes through one `Repository` interface. The Supabase implementation uses the signed-in user's own session, never an admin key, so row level security decides what each query returns. Leaders read through a view with no note or reason columns.
- **Rationale**: A forgotten check in a page cannot leak another county's data; the database refuses.
- **Alternatives considered**: Checks in route handlers only (one missed check is a leak). A service-role key with app-side filtering (same weakness).

## 3. Panels store a specification and compute in the browser

- **Decision**: A panel is a small typed specification. One function, `computePanel`, turns a specification plus current records into what is drawn. Dashboard, workspace, AI and the Claude connector all use it.
- **Rationale**: The dashboard and workspace cannot disagree, saved folders never go stale, and changing a filter never calls the server or the model.
- **Alternatives considered**: Saving results (stale). Server-computed panels (slower to adjust; the next step if data outgrows pilot scale).

## 4. Design system for a public-sector tool

- **Decision**: Generated with the open-source `ui-ux-pro-max` design skill for a government and legal internal tool, then adapted: "Accessible & Ethical" style, navy with one gold accent for the main action, EB Garamond headings, Lato body, monospace numbers, plain SVG charts with table alternatives. Tokens are in [contracts/ui.md](contracts/ui.md).
- **Rationale**: Clerks and judges need readable, keyboard-friendly screens that do not look like a generic generated dashboard.
- **Alternatives considered**: A component library and chart library (more to maintain, harder to keep accessible by default).

## 5. A local decision model for sorting reasons

- **Decision**: Import can sort reasons with OpenJev Flash 9B, an open-weights decision model that runs on an Apple silicon Mac. It picks one option from the fixed list and returns a confidence; it writes no text. Keyword rules still run first and remain the fallback.
- **Rationale**: Sorting a short note into a fixed list does not need a general chat model. A local model answers in a fraction of a second per row by its model card, costs nothing per call, and keeps reason text inside the court.
- **Alternatives considered**: The Claude API for every row (slower, and text leaves the machine). Hosted Jev from TypeSafe (fast and cheap, but a second cloud provider and key). DocJev (built to split whole PDFs, not short notes).
- **Limits**: The weights are CC BY-NC 4.0, so a real court rollout needs a commercial licence; they are downloaded at run time and are not in this repository. Speed and accuracy figures are the model card's, not measured on court data.
