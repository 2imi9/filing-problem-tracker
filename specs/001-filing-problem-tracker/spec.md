# Feature Specification: Filing Problem Tracker

**Feature Branch**: `001-filing-problem-tracker`
**Created**: 2026-11-10
**Status**: Draft
**Input**: "When someone without a lawyer files in an Indiana court, the filing is often rejected or sent back for a fixable mistake. Clerks see these mistakes every day, but nobody records them in a way that shows patterns. Let clerks tag the problem in a few clicks and let court leaders see which problems are most common by county, case type and form, and whether a fix helped."

## User Scenarios & Testing

### User Story 1 - Tag a rejected filing (Priority: P1)

A clerk has just rejected or returned a filing from a person without a lawyer. They open the tracker, pick the case type and form, click the problems they saw, pick what happened to the filing, and save.

**Why this priority**: Without tagged records there is nothing to show. It must be fast enough that a clerk at a busy counter will actually do it.

**Independent Test**: Sign in as a clerk, tag one filing using only the keyboard, and see it in the recent entries list.

**Acceptance Scenarios**:

1. **Given** a signed-in clerk, **When** they choose a case type, a form, at least one problem and an outcome and save, **Then** the entry is stored under their county and appears in their recent entries.
2. **Given** a clerk typing a note, **When** the note contains something that looks like a name, case number, phone number, email or address, **Then** the tool warns while they type and refuses to save it.
3. **Given** an entry saved less than five minutes ago, **When** the clerk chooses Undo, **Then** the entry is removed from all counts.
4. **Given** a clerk, **When** a request names a different county, **Then** it is refused.

### User Story 2 - See the patterns (Priority: P1)

A court leader opens the dashboard and sees the most common problems, how filings ended up, which counties and forms have the most trouble, and the trend by month. They narrow it by county, case type, form, problem or date range.

**Why this priority**: This is the reason the data is collected.

**Independent Test**: Sign in as a leader with the sample data and confirm the dashboard totals match the records; apply a county filter and confirm every panel changes.

**Acceptance Scenarios**:

1. **Given** a leader on the dashboard, **When** a clerk tags a new filing, **Then** the dashboard total rises by one without a manual reload of the app.
2. **Given** a leader, **When** they look at any view, **Then** they see totals only and never a clerk's note.
3. **Given** any chart, **When** a user cannot see color, **Then** the same information is available as printed values and a data table.

### User Story 3 - Check whether a fix worked (Priority: P2)

An admin records a change, such as a revised form or a new self-help guide, with its date and the county, form and problem it targets. A leader sees that problem's rate before and after the change.

**Why this priority**: It turns a count into evidence about what helps.

**Independent Test**: With the sample data, open the before/after view for a recorded change and confirm the rates match a hand count of full months.

**Acceptance Scenarios**:

1. **Given** a recorded change, **When** a leader opens the before/after view, **Then** it compares full months before and after and leaves out the month in progress.
2. **Given** too few records after the change, **When** the view opens, **Then** it says there is not enough data yet instead of showing a rate.

### User Story 4 - Import past rejections (Priority: P2)

A clerk or admin pastes a spreadsheet export of past rejections. The tool sorts each typed reason into the problem list, shows a preview, and saves only after a person confirms.

**Why this priority**: It gives a court a useful dashboard on day one without re-entering history.

**Independent Test**: Paste the sample export, review the preview, commit, and see the rows counted on the dashboard.

**Acceptance Scenarios**:

1. **Given** pasted rows, **When** a reason cannot be sorted with confidence, **Then** the row is marked "Needs review" and is not guessed.
2. **Given** a reason that contains personal data, **When** the preview is built, **Then** that row is refused with an explanation and its text is not stored or sent to a model.
3. **Given** a preview, **When** the user has not confirmed, **Then** nothing is saved.

### User Story 5 - Ask for a view (Priority: P3)

A leader types what they want to see, for example "signature problems in Marion small claims", and the workspace opens live panels that answer it. They adjust, rearrange and save a set of panels as a folder to reopen later.

**Why this priority**: It makes the data easy to explore, but the dashboard already covers the core need.

**Independent Test**: With the AI turned off, type a request, get panels, change a filter on one, save the set as a folder and reopen it.

**Acceptance Scenarios**:

1. **Given** a typed request, **When** panels open, **Then** every number in them is computed from the records, and reopening a saved folder later shows current numbers.
2. **Given** no AI key is configured, **When** a request is typed, **Then** panels still open using keyword matching.
3. **Given** a keyboard-only user, **When** they need to move, resize or close a panel, **Then** they can.

### User Story 6 - Ask from Claude (Priority: P3)

A leader connects the tracker to their own Claude and asks questions there. Claude can read the same totals the dashboard shows and nothing else.

**Independent Test**: Call the connector with a valid token and get problem counts; call it without a token and get refused.

### Edge Cases

- A clerk tries to undo an entry after five minutes.
- An import has more than 10,000 rows or is larger than 5 MB.
- The AI service is down, slow, refuses, or returns something malformed.
- A harmless phrase looks like a name ("Small Claims", a county name, a month).
- A filter combination matches no records.
- The demo server restarts and the sample data resets.

## Requirements

### Functional Requirements

- **FR-001**: Clerks MUST be able to tag a filing with county, case type, form, one or more problems from a fixed list, and an outcome, without typing.
- **FR-002**: System MUST NOT have any field for a litigant's name or a case number.
- **FR-003**: System MUST check notes and imported text for personal data and refuse to store text that fails.
- **FR-004**: System MUST limit a clerk to reading and writing their own county's records, taking the county from their account and never from the request.
- **FR-005**: Leaders MUST be able to see totals for all counties and MUST NOT be able to read notes or raw imported reasons.
- **FR-006**: Users MUST be able to filter every view by county, case type, form, problem and month range.
- **FR-007**: Admins MUST be able to record a change with a date and target, and leaders MUST be able to see a before/after comparison for it.
- **FR-008**: Users MUST be able to import rows from a spreadsheet export, preview how each was sorted, and confirm before anything is saved.
- **FR-009**: System MUST mark rows it cannot sort as "Needs review" for a person to resolve.
- **FR-010**: Leaders MUST be able to request a view in plain words and receive live panels, and to save and reopen sets of panels.
- **FR-011**: Every number shown MUST be computed by the system from records. AI output MUST be validated, and an AI summary containing a number not present in the data MUST be discarded.
- **FR-012**: Every AI feature MUST have a non-AI fallback so the tool is fully usable with the AI off.
- **FR-013**: System MUST NOT give legal advice or show AI-generated content to litigants.
- **FR-014**: System MUST record who created, deleted or imported what, without recording note text.
- **FR-015**: System MUST offer read-only totals to an authorized external assistant and refuse requests without a valid token.
- **FR-016**: System MUST run in a demonstration mode with made-up data, clearly labeled on every page.
- **FR-017**: Access MUST be by invitation only outside demonstration mode.

### Key Entities

- **Filing flag**: one rejected or returned filing. County, date, case type, form, problems, outcome, optional note, where it came from (clerk, import, sample).
- **Problem**: one of a fixed list, such as missing signature, wrong form, wrong county, missing details, plus "Needs review".
- **Change event**: something a court changed, with a date and the county, form or problem it targets.
- **Panel**: a saved description of one chart (its type, filters and title), not its numbers.
- **Folder**: a named set of panels belonging to one user.
- **User**: a clerk (one county), a leader (all counties, totals only) or an admin.
- **Audit entry**: who did what and when.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A clerk can tag a typical filing in under 15 seconds using only the keyboard.
- **SC-002**: A newly tagged filing appears in a leader's dashboard totals within 30 seconds.
- **SC-003**: In testing, a clerk can never read or write another county's records, and a leader can never read a note, through any screen or request.
- **SC-004**: On the sample export, at least 80 percent of rows are sorted without the AI, and no row is assigned a problem outside the fixed list.
- **SC-005**: Every page passes automated accessibility checks with no serious or critical issues in light and dark themes, and has no sideways scrolling on a phone.
- **SC-006**: With no AI key configured, every user story above can still be completed.

## Assumptions

- Users are court staff. No litigant uses the tool.
- Counties, case types, forms and problems are fixed lists maintained with the code for now.
- Pilot scale is thousands of records, not millions.
- Courts can export past rejections as a spreadsheet with a date, county, form and typed reason.
- All data is made up until a court completes its own review and agrees to a pilot.
