# Filing Problem Tracker Constitution

The rules every spec, plan and change in this repository must satisfy. If a feature cannot meet one of them, the feature changes, not the rule.

## Core Principles

### I. No personal data

The tracker records the kind of mistake, the form, the county and the date. It has no field for a name or a case number. Free text is checked for anything that looks like personal data and refused, in the browser and again on the server. Refused text is never stored and never sent to a model.

### II. No legal advice

Labels describe what was wrong with a filing, never what a filer should do. Nothing the tool produces is shown to litigants. AI prompts forbid advice.

### III. The AI chooses, the code computes

A model may sort free text into the fixed problem list, choose which panels to open, and word a summary of numbers the server computed. It never produces a number shown to a user. Every model output is validated, and anything invalid is dropped or marked for a person to review.

### IV. Works with the AI off

Every AI feature has a rules-based fallback. With no API key the whole tool is usable.

### V. Access rules live in the data layer

A clerk reads and writes only their own county. A leader sees totals, never notes. These rules are enforced by the database (row level security) and mirrored in the demo store, so a mistake in a page cannot widen access. Both are tested.

### VI. Stay out of the court's systems

The tracker stands next to Odyssey and e-filing and never connects to them. Data arrives by a clerk's clicks or a pasted export.

### VII. Plain and accessible

Readable at a counter and on a phone, fully usable by keyboard, WCAG AA contrast in light and dark, color never the only signal, copy that says what a control does.

## Boundaries

- All data in this repository is made up. Real court records need the court's IT and security review, a data agreement and approved hosting. That decision belongs to the court.
- Secrets live in server-side environment variables only, never in the repository or the browser bundle.

## Workflow

Work follows the Spec Kit order: `spec.md` (what and why), `plan.md` (how), `tasks.md` (steps), then code. Each feature lives in `specs/NNN-name/`. A change that affects behavior updates the spec in the same pull request.

## Governance

This constitution overrides other documents in the repository. Amending it needs a pull request that states the reason and updates any spec it affects. Every plan includes a constitution check.

**Version**: 1.0.0 | **Ratified**: 2026-11-10 | **Last Amended**: 2026-11-10
