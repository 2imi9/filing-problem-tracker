# Research: decisions and alternatives

Decisions the plan depends on that the constitution does not already state.

## 1. Two run modes behind one code path

- **Decision**: A demo mode (in-memory sample data, role picker) and a Supabase mode (Postgres, emailed sign-in link, invite only). Pages and routes call `getSession()` and `getRepository(session)` and never branch on the mode.
- **Rationale**: The class demo, local development and CI need zero setup. A pilot needs a real database. One code path keeps them from drifting.
- **Alternatives considered**: A hosted database for everything (every tester needs an account, CI needs secrets). A separate demo app (two apps to keep in step).

## 2. One repository interface; access rules in the database

- **Decision**: All data access goes through one `Repository` interface. The Supabase implementation uses the signed-in user's own session, never the service role key, so row level security decides what each query returns. The signed-in database role cannot read the note and reason columns at all; two functions return that text and apply the rule themselves.
- **Rationale**: A forgotten check in a page cannot leak another county's data; the database refuses.
- **Alternatives considered**: Checks in route handlers only (one missed check is a leak). A service role key with app-side filtering (same weakness).

## 3. Panels store a specification and compute in the browser

- **Decision**: A panel is a small typed specification. One function, `computePanel`, turns a specification plus current records into what is drawn. Dashboard, workspace, AI summary and the MCP tools all work from the same statistics code.
- **Rationale**: The dashboard and workspace cannot disagree, saved folders never go stale, and changing a filter never calls the server or the model.
- **Alternatives considered**: Saving results (stale). Server-computed panels (slower to adjust; the next step if data outgrows pilot scale).

## 4. The look comes from one approved demo

- **Decision**: The single-file demo in `docs/prototype/filing_tracker.html` is the approved design, and the app follows it: a navy header with the project's own courthouse mark, numbered tabs pinned to the top, sections under plain rules, checkbox rows, one gold action per screen. The starting palette and type pairing came from the open-source `ui-ux-pro-max` design skill (MIT, github.com/nextlevelbuilder/ui-ux-pro-max-skill), queried for a government and legal internal tool, then cut back by hand. Tokens and rules are in [contracts/ui.md](contracts/ui.md).
- **Rationale**: Clerks and judges need readable, keyboard-friendly screens that do not look like a generic generated dashboard.
- **Alternatives considered**: A component library and a chart library (more to maintain, harder to keep accessible by default). A sidebar with icon navigation (the numbered tabs are clearer).

## 5. Self-hosted fonts and third-party material

- **Decision**: The app loads nothing from another site at run time. The three typefaces are served from `src/fonts` through `next/font/local`. Icons are inline SVG, and the courthouse mark is the project's own drawing, not a court seal or logo.
- **Rationale**: Builds and page views need no network, and the Content-Security-Policy can allow this origin only.
- **Alternatives considered**: A hosted font service (an outside request on every page view).

Credits and the licence each one declares:

| Material | Used for | Licence |
|---|---|---|
| EB Garamond. Copyright 2017 The EB Garamond Project Authors | Headings | SIL Open Font License 1.1 |
| Lato. Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic, Reserved Font Name "Lato" | Body text | SIL Open Font License 1.1 |
| IBM Plex Mono. Copyright 2017 IBM Corp. | Numbers, dates and data | SIL Open Font License 1.1 |
| Lucide upload icon (lucide.dev) | The single-file demo | ISC |
| Indiana county boundaries, US Census Bureau cartographic boundary file (via the `plotly/datasets` GeoJSON), simplified to SVG paths | The county map in the single-file demo | Public domain (US government work) |
| `next`, `react`, `react-dom`, `zod`, `@supabase/supabase-js`, `@supabase/ssr`, `@modelcontextprotocol/sdk` | The running app | MIT |
| `@anthropic-ai/sdk` | The running app | Apache-2.0 |
| `eslint`, `eslint-config-next`, `vitest`, `vite`, `@vitejs/plugin-react`, `@types/*` | Build and tests | MIT |
| `typescript`, `@electric-sql/pglite`, `@playwright/test` | Build and tests | Apache-2.0 |
| `@axe-core/playwright` | Tests | MPL-2.0 |

The font files keep their copyright and licence metadata; keep it intact when copying them. Licences of indirect dependencies have not been reviewed. Every record the app ships with is made up by the generator in `src/lib/sample.ts`; county names are real, the numbers are not.

## 6. A local decision model for sorting reasons

- **Decision**: Import can sort reasons with OpenJev Flash 9B, an open-weights decision model that runs on an Apple silicon Mac. It picks one option from the fixed list and returns a confidence; it writes no text. Keyword rules still run first and remain the fallback.
- **Rationale**: Sorting a short note into a fixed list does not need a general chat model. A local model answers in a fraction of a second per row by its model card, costs nothing per call, and keeps reason text inside the court.
- **Alternatives considered**: The Claude API for every row (slower, and text leaves the machine). Hosted Jev from TypeSafe (fast and cheap, but a second cloud provider and key). DocJev (built to split whole PDFs, not short notes).
- **Hosting**: The same page also runs on a free Hugging Face Space next to the model's llama.cpp build, for a public link. That copy is slower (no GPU) and not private, so it is for made-up data only.
- **Limits**: The weights are CC BY-NC 4.0, so a real court rollout needs a commercial licence; they are downloaded at run time and are not in this repository. Speed and accuracy figures are the model card's, not measured on court data.
