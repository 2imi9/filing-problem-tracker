# Research: decisions and alternatives

Each entry is a decision the plan depends on.

## 1. Two run modes behind one code path

- **Decision**: A demo mode (in-memory sample data, role picker) and a Supabase mode (Postgres, magic-link sign-in, invite only). Pages and routes call `getSession()` and `getRepository(session)` and never branch on the mode.
- **Rationale**: The class demo, local development and CI need zero setup. A pilot needs a real database. One code path keeps them from drifting.
- **Alternatives considered**: A hosted database for everything (every tester needs an account, CI needs secrets). A separate demo app (two apps to keep in step).

## 2. One repository interface; access rules in the database

- **Decision**: All data access goes through one `Repository` interface. The Supabase implementation uses the signed-in user's own session, never an admin key, so row level security decides what each query returns. Leaders read through a view with no note or reason columns.
- **Rationale**: A forgotten check in a page cannot leak another county's data; the database refuses.
- **Alternatives considered**: Checks in route handlers only (one missed check is a leak). A service-role key with app-side filtering (same weakness).

## 3. The AI chooses and words things; the code computes and checks

- **Decision**: The model sorts reasons into the fixed list, picks panels through strict tool schemas, and words a summary of server-computed aggregates. Output is validated every time, and a summary containing a number not in its input is discarded.
- **Rationale**: Court leaders act on the numbers, and a model can state a wrong figure fluently.
- **Alternatives considered**: A chat that answers in text (numbers unverifiable, goes stale). Letting the model query the data directly (wider privacy exposure, harder to test).

## 4. Store no personal data, and refuse it at the door

- **Decision**: No name or case-number field. Free text is pattern-checked in the browser and on the server and refused, not silently cleaned.
- **Rationale**: The signal is the kind of mistake, not who made it. Personal data adds risk and review burden with no benefit.
- **Alternatives considered**: Store and redact later (the data exists in the meantime). Automatic scrubbing (hides the problem from the person who can fix it).

## 5. Panels store a specification and compute in the browser

- **Decision**: A panel is a small typed specification. One function, `computePanel`, turns a specification plus current records into what is drawn. Dashboard, workspace, AI and the Claude connector all use it.
- **Rationale**: The dashboard and workspace cannot disagree, saved folders never go stale, and changing a filter never calls the server or the model.
- **Alternatives considered**: Saving results (stale). Server-computed panels (slower to adjust; the next step if data outgrows pilot scale).

## 6. Design system for a public-sector tool

- **Decision**: Generated with the open-source `ui-ux-pro-max` design skill for a government and legal internal tool, then adapted: "Accessible & Ethical" style, navy with one gold accent for the main action, EB Garamond headings, Lato body, monospace numbers, plain SVG charts with table alternatives. Record in [`design-system/MASTER.md`](../../design-system/MASTER.md).
- **Rationale**: Clerks and judges need readable, keyboard-friendly screens that do not look like a generic generated dashboard.
- **Alternatives considered**: A component library and chart library (more to maintain, harder to keep accessible by default).
