# Filing Problem Tracker

### See why court filings from people without lawyers get rejected, and whether fixes work.

Filing Problem Tracker is a small web tool for Indiana trial courts. Clerks tag what was wrong with a rejected or returned filing in a few clicks, and court leaders see which problems are most common by county, case type and form. It is a student prototype (Northeastern CS4535 AI for Impact, Team 1) and every number in it is made up.

> [!NOTE]
> This is not an official court system. It does not change Odyssey or e-filing, it does not give legal advice, and it stores no names or case numbers.

## Quickstart

Try the prototype in your browser, no install:

- Open the hosted prototype: https://claude.ai/artifact/GKhX5hg1m8exSJxZkV5Ddk
- Or download [`docs/prototype/filing_tracker.html`](docs/prototype/filing_tracker.html) and open it.

Tag a filing on the first tab, then open the dashboard tab to see it counted.

The full web app (Next.js, Supabase, Claude API) is being built against the [spec](specs/001-filing-problem-tracker/spec.md) and [plan](specs/001-filing-problem-tracker/plan.md) and arrives by pull request. Progress is in [tasks](specs/001-filing-problem-tracker/tasks.md).

## What is in the tool

- **Tag a filing**: a clerk picks county, case type and form, clicks the problems (missing signature, wrong form, wrong county, missing details and others) and saves. A few seconds, no typing required.
- **Import past rejections**: paste a spreadsheet export and the tool sorts the clerks' typed reasons into the same problem categories. Rows it cannot sort are marked for a person to review.
- **Dashboard**: the most common problems by county, case type and form, and a before/after view that shows whether a change such as a revised form or a self-help guide reduced a problem.
- **Workspace**: a leader types what they want to see ("signature problems in Marion small claims") and gets live chart panels instead of a chat reply. Panels can be rearranged and saved in folders.
- **Connector for Claude (MCP)**: the same read-only totals are available to a court leader's own Claude, so they can ask questions about the tracker there.

## Why it is built this way

- **Nothing personal is stored.** No names, no case numbers. Notes and imported text are checked for anything that looks like personal data and refused.
- **The AI chooses, the code computes.** The model only picks which panels to open and sorts free-text reasons into fixed categories. Every number on screen is computed by ordinary, tested code, so the model cannot invent a figure.
- **It works with the AI turned off.** Each AI feature has a plain rules-based fallback.
- **Each county sees its own records.** Clerks see their county, leaders see totals for all counties, and those rules are enforced in the database, not only in the screens.
- **It stays out of the court's systems.** A standalone tool next to Odyssey and e-filing, with no integration to approve.
- **No legal advice, to anyone.** Labels describe what was wrong with a filing, never what a filer should do. Nothing AI-generated is shown to litigants.

---

## Resources

This repository follows [GitHub Spec Kit](https://github.com/github/spec-kit): the rules first, then the spec, the plan and the tasks.

- [Constitution](.specify/memory/constitution.md): the seven rules every change must meet.
- [Spec](specs/001-filing-problem-tracker/spec.md): user stories, requirements and success criteria.
- [Plan](specs/001-filing-problem-tracker/plan.md): architecture, stack and how each rule is met.
- [Tasks](specs/001-filing-problem-tracker/tasks.md): build steps and what is done.
- [Research](specs/001-filing-problem-tracker/research.md): the main decisions and the alternatives.
- [Data model](specs/001-filing-problem-tracker/data-model.md) and [contracts](specs/001-filing-problem-tracker/contracts/): access rules, HTTP API, AI features, pages and design system.
- [Quickstart](specs/001-filing-problem-tracker/quickstart.md).

## Status

Prototype with made-up data. Using real court records would need the court's IT and security review, a data agreement, and approved hosting. None of that has been done, and nothing in this repository decides it for the court.
