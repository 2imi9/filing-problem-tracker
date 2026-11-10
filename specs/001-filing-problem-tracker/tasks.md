# Tasks: Filing Problem Tracker

**Input**: [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md), [contracts/](contracts/)

## Format: `[ID] [P?] [Story] Description`

`[P]` can run in parallel. `[USn]` is the user story it serves. A checked box means built and unit-tested on the build branch; code reaches `main` by pull request.

## Phase 1: Setup

- [x] T001 Create the Next.js project with TypeScript and the `src/` layout
- [ ] T002 [P] Add the design tokens and self-hosted fonts from `design-system/MASTER.md`
- [x] T003 [P] Configure linting, type checking and unit tests

## Phase 2: Foundational (blocks every story)

- [x] T004 Reference lists and types in `src/lib/domain.ts`
- [x] T005 [P] Input schemas in `src/lib/schemas.ts`
- [x] T006 [P] Personal-data check in `src/lib/pii.ts`
- [x] T007 [P] Statistics in `src/lib/stats.ts` and sample data in `src/lib/sample.ts`
- [x] T008 Panel contract and `computePanel` in `src/lib/panels.ts`
- [x] T009 Repository interface and the in-memory store with access rules in `src/server/repo/`
- [x] T010 Sessions, request wrapper, rate limit and audit in `src/server/`
- [x] T011 HTTP routes for flags, events, folders, import and health in `src/app/api/`

## Phase 3: User Story 1 - Tag a rejected filing (P1)

- [ ] T012 [US1] App shell, navigation and role sign-in
- [ ] T013 [US1] Tag a filing page with keyboard chips, note warning, undo and recent entries

## Phase 4: User Story 2 - See the patterns (P1)

- [ ] T014 [P] [US2] Chart components in plain SVG with data table alternatives
- [ ] T015 [US2] Dashboard page with the filter bar and fixed panels

## Phase 5: User Story 3 - Check whether a fix worked (P2)

- [ ] T016 [US3] Before/after panel
- [ ] T017 [US3] Admin page for change events and the audit log

## Phase 6: User Story 4 - Import past rejections (P2)

- [ ] T018 [US4] Import page with preview, rejected rows and commit
- [ ] T019 [P] [US4] AI sorting of reasons with the rules fallback in `src/server/ai/classify.ts`

## Phase 7: User Story 5 - Ask for a view (P3)

- [ ] T020 [US5] Workspace page: command bar, panel grid, folders
- [ ] T021 [P] [US5] Panel chooser with the keyword fallback in `src/server/ai/compose.ts`
- [ ] T022 [P] [US5] Checked summary in `src/server/ai/summary.ts`

## Phase 8: User Story 6 - Ask from Claude (P3)

- [ ] T023 [US6] Read-only tools and the MCP endpoint

## Phase 9: Database and sign-in

- [ ] T024 Migrations, row level security policies and seed in `supabase/`
- [ ] T025 Supabase repository and magic-link sign-in
- [ ] T026 Access-rule tests that run the real migrations

## Phase 10: Polish

- [ ] T027 Browser tests for each user story, keyboard use, accessibility and phone width
- [ ] T028 Security headers, bundle secret check and CI
- [ ] T029 Independent review of security, privacy, accessibility and correctness, and fixes

## Dependencies

Phase 2 blocks everything. Stories 1 and 2 are the minimum useful product. Stories 3 to 6 and Phase 9 are independent of each other once Phase 2 is done.
