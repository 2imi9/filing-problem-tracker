# Tasks: Filing Problem Tracker

**Input**: Design documents from `/specs/001-filing-problem-tracker/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story so each story can be built and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 to US6)

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create the Next.js project with TypeScript and the `src/` layout
- [ ] T002 [P] Add the design tokens and self-hosted fonts from `contracts/ui.md`
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

- [ ] T012 [US1] App shell, navigation and role sign-in in `src/app/`
- [ ] T013 [US1] Tag a filing page with keyboard chips, note warning, undo and recent entries in `src/app/log/`

## Phase 4: User Story 2 - See the patterns (Priority: P1)

**Goal**: A leader sees the most common problems and can filter them.

**Independent Test**: Dashboard totals match the sample records, and a county filter changes every panel.

- [ ] T014 [P] [US2] Chart components in plain SVG with data table alternatives in `src/components/`
- [ ] T015 [US2] Dashboard page with the filter bar and fixed panels in `src/app/dashboard/`

## Phase 5: User Story 3 - Check whether a fix worked (Priority: P2)

**Goal**: A leader sees a problem's rate before and after a recorded change.

**Independent Test**: The before/after figures match a hand count of full months.

- [ ] T016 [US3] Before/after panel in `src/components/`
- [ ] T017 [US3] Admin page for change events and the audit log in `src/app/admin/`

## Phase 6: User Story 4 - Import past rejections (Priority: P2)

**Goal**: A court loads its past rejections from a spreadsheet export.

**Independent Test**: Paste the sample export, review the preview, commit, see the rows on the dashboard.

- [ ] T018 [US4] Import page with preview, rejected rows and commit in `src/app/import/`
- [ ] T019 [P] [US4] AI sorting of reasons with the rules fallback in `src/server/ai/classify.ts`
- [x] T019a [US4] Prototype: local model sorting of leftover rows in `docs/prototype/filing_tracker.html`, served by `scripts/serve-local.py`
- [x] T019b [US4] Prototype: the same page and model on a Hugging Face Space in `space/`

## Phase 7: User Story 5 - Ask for a view (Priority: P3)

**Goal**: A leader types a request and gets live panels they can save.

**Independent Test**: With the AI off, type a request, change a filter, save a folder and reopen it.

- [ ] T020 [US5] Workspace page with command bar, panel grid and folders in `src/app/workspace/`
- [ ] T021 [P] [US5] Panel chooser with the keyword fallback in `src/server/ai/compose.ts`
- [ ] T022 [P] [US5] Checked summary in `src/server/ai/summary.ts`

## Phase 8: User Story 6 - Ask from Claude (Priority: P3)

**Goal**: A leader's own Claude can read the tracker's totals.

**Independent Test**: A call with a valid token returns counts; a call without one is refused.

- [ ] T023 [US6] Read-only tools and the MCP endpoint in `src/server/tools.ts` and `src/app/api/mcp/`

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T024 Migrations, row level security policies and seed in `supabase/`
- [ ] T025 Supabase repository and magic-link sign-in in `src/server/`
- [ ] T026 [P] Access-rule tests that run the real migrations in `tests/rls/`
- [ ] T027 [P] Browser tests for each user story, keyboard use, accessibility and phone width in `e2e/`
- [ ] T028 Security headers, bundle secret check and CI
- [ ] T029 Run the checks in quickstart.md

## Dependencies & Execution Order

- Setup, then Foundational. Foundational blocks every user story.
- User stories 1 and 2 are the minimum useful product. Stories 3 to 6 do not depend on each other.
- Polish follows the stories it covers.
