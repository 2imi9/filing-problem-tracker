# Tasks: Filing Problem Tracker

**Input**: Design documents from `/specs/001-filing-problem-tracker/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story so each story can be built and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 to US6)

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create the Next.js project with TypeScript and the `src/` layout
- [x] T002 [P] Add the design tokens in `src/app/globals.css` and self-hosted fonts in `src/fonts/`
- [x] T003 [P] Configure linting, type checking and unit tests

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T004 Reference lists and types in `src/lib/domain.ts`
- [x] T005 [P] Input schemas in `src/lib/schemas.ts`
- [x] T006 [P] Personal-data check in `src/lib/pii.ts`
- [x] T007 [P] Statistics in `src/lib/stats.ts` and sample data in `src/lib/sample.ts`
- [x] T008 Panel contract and `computePanel` in `src/lib/panels.ts`
- [x] T009 Repository interface and the in-memory store with access rules in `src/server/repo/`
- [x] T010 Sessions, request wrapper, rate limit and audit in `src/server/`
- [x] T011 HTTP routes for flags, events, folders, import and health in `src/app/api/`

**Checkpoint**: Foundation ready. User stories can now be built in parallel.

## Phase 3: User Story 1 - Tag a rejected filing (Priority: P1) MVP

**Goal**: A clerk tags a filing in seconds.

**Independent Test**: Sign in as a clerk, tag one filing with the keyboard, see it in recent entries.

- [x] T012 [US1] App shell, navigation and role sign-in in `src/app/` and `src/components/shell/`
- [x] T013 [US1] Tag a filing page with keyboard shortcuts, note warning, undo and recent entries in `src/app/log/`

## Phase 4: User Story 2 - See the patterns (Priority: P1)

**Goal**: A leader sees the most common problems and can filter them.

**Independent Test**: Dashboard totals match the sample records, and a county filter changes every panel.

- [x] T014 [P] [US2] Chart components in plain SVG with data table alternatives in `src/components/charts/`
- [x] T015 [US2] Dashboard page with the filter bar and fixed panels in `src/app/dashboard/`

## Phase 5: User Story 3 - Check whether a fix worked (Priority: P2)

**Goal**: A leader sees a problem's rate before and after a recorded change.

**Independent Test**: The before/after figures match a hand count of full months.

- [x] T016 [US3] Before/after panel in `src/components/panels/`
- [x] T017 [US3] Admin page for change events and the audit log in `src/app/admin/`

## Phase 6: User Story 4 - Import past rejections (Priority: P2)

**Goal**: A court loads its past rejections from a spreadsheet export.

**Independent Test**: Paste the sample export, review the preview, commit, see the rows on the dashboard.

- [x] T018 [US4] Import page with preview, rejected rows and commit in `src/app/import/`
- [x] T019 [P] [US4] AI sorting of reasons with the rules fallback in `src/server/ai/classify.ts`

## Phase 7: User Story 5 - Ask for a view (Priority: P3)

**Goal**: A leader types a request and gets live panels they can save.

**Independent Test**: With the AI off, type a request, change a filter, save a folder and reopen it.

- [x] T020 [US5] Workspace page with request box, panel grid and folders in `src/app/workspace/` and `src/components/workspace/`
- [x] T021 [P] [US5] Panel chooser with the keyword fallback in `src/server/ai/compose.ts`
- [x] T022 [P] [US5] Checked summary in `src/server/ai/summary.ts`

## Phase 8: User Story 6 - Ask from Claude (Priority: P3)

**Goal**: A leader's own Claude can read the tracker's totals.

**Independent Test**: A call with a valid token returns counts; a call without one is refused.

- [x] T023 [US6] Read-only tools and the MCP endpoint in `src/server/tools.ts` and `src/app/api/mcp/`

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T024 Migrations, row level security policies and seed in `supabase/`
- [x] T025 Supabase repository and emailed-link sign-in in `src/server/` and `src/app/api/auth/`
- [x] T026 [P] Access-rule tests that run the real migrations in `tests/rls/`
- [x] T027 [P] Browser tests for each user story, keyboard use, accessibility and phone width in `e2e/`
- [x] T028 Security headers in `next.config.ts`, bundle check in `scripts/check-bundle.mjs` and CI in `.github/workflows/ci.yml`
- [ ] T029 Match the approved look in `contracts/ui.md`: header, numbered tabs, checkbox rows, outcome labels, plain-rule sections
- [ ] T030 Run the checks in quickstart.md

## Phase 10: Before a pilot with real data

None of this is done. It is the court's decision, and the work its IT and security staff would expect to see first.

- [ ] T031 The court names a sponsor and an operator, approves hosting, region and every outside party, and signs a data agreement
- [ ] T032 The court classifies the data, decides whether free-text notes and reasons are allowed, and whether an exact filing date is too identifying where volumes are small
- [ ] T033 Decide on AI separately: with it on, the provider receives checked rejection reasons and counts
- [ ] T034 Build a purge and set retention periods for flags, free text, the audit log, accounts and backups
- [ ] T035 Move rate limits to a shared store and add monitoring and alerts
- [ ] T036 Close or accept the Content-Security-Policy gap for inline scripts
- [ ] T037 Decide whether an emailed link is acceptable or single sign-on or a second factor is required; add a screen for accounts and MCP tokens; schedule access reviews
- [ ] T038 Apply the migrations to a hosted Supabase project, repeat the access checks there, test sign-in end to end and restore a backup
- [ ] T039 Run an independent security test and a manual accessibility review against WCAG 2.1 AA with screen readers
- [ ] T040 Name incident contacts and write a short runbook: take the service offline, sign everyone out, rotate each key
- [ ] T041 Agree what the pilot measures and what counts as success: time to tag, share of rejected filings tagged, agreement between clerks, sorting accuracy on imports, misses by the personal-data check, use by leaders, burden on clerks

## Dependencies & Execution Order

- Setup, then Foundational. Foundational blocks every user story.
- User stories 1 and 2 are the minimum useful product. Stories 3 to 6 do not depend on each other.
- Polish follows the stories it covers.
- Phase 10 starts only if a court agrees to a pilot.
