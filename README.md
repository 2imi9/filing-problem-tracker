# Filing Problem Tracker

CS4535 AI for Impact (Northeastern), Team 1. A prototype for Indiana trial courts. All data in it is made up.

## The problem

When someone without a lawyer files in an Indiana court, the filing is often rejected or sent back for a fixable mistake: a missing signature, the wrong form, the wrong county, missing details. Clerks see these mistakes every day, but nobody records them in a way that shows patterns. Court leaders cannot tell which forms cause the most trouble, where, or whether a fix helped.

## What the tool does

- **Clerks tag the problem in a few clicks.** County, case type, form, what was wrong, and what happened to the filing. No names or case numbers.
- **Courts can import past rejections.** Paste a spreadsheet export; the tool sorts the clerks' typed reasons into the same problem categories and marks unclear rows for a person to review.
- **Court leaders get a dashboard.** The most common problems by county, case type and form, and a before/after view that shows whether a change (a revised form, a self-help guide, a kiosk) reduced a problem.
- **A workspace instead of a chatbot.** A leader types what they want to see ("signature problems in Marion small claims") and the tool opens live chart panels, which can be saved in folders. The AI only chooses which panels to open; the code computes every number.

## What it does not do

- It does not change Odyssey or e-filing. It sits next to them.
- It does not give legal advice, to anyone.
- It does not store names, case numbers, or anything that identifies a litigant.
- Nothing AI-generated is shown to litigants.

## Status

- **Working prototype** (single page, made-up data): https://claude.ai/artifact/GKhX5hg1m8exSJxZkV5Ddk. The same file is in this repo at `docs/prototype/filing_tracker.html`; download it and open it in a browser.
- **Full web app** (Next.js, Supabase, Claude API): in progress and arriving by pull request. The design is in [ARCHITECTURE.md](ARCHITECTURE.md) and the visual design system in [design-system/MASTER.md](design-system/MASTER.md).

## Not done, on purpose

Using real court records would need the court's IT and security review, a data agreement, and approved hosting. This prototype uses made-up data only.
