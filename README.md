<p align="center">
  <img src="docs/assets/cover.png" alt="Filing Problem Tracker. Tag, patterns, fixes. An Indiana courthouse drawn in ASCII characters." width="960">
</p>

# <img src="docs/assets/mark.svg" alt="" width="28"> Filing Problem Tracker

A small web tool for Indiana trial courts. Clerks tag why a filing from someone without a lawyer was rejected, and court leaders see which problems are most common and whether a fix helped.

**Live demo:** https://filing-problem-tracker.onrender.com

> [!NOTE]
> Student prototype for Northeastern CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts. All data is made up, and it gives no legal advice.

## What it does

- **Tag a filing.** A clerk picks the county, case type and form, types a short note, accepts or changes the suggested problem, and saves. No names or case numbers.
- **Import past rejections.** Paste a spreadsheet export and the tool sorts each typed reason into the same problem list.
- **Dashboard.** The most common problems by county, case type and form.
- **Before and after.** Whether a change, such as a revised form, reduced a problem.

It sits next to Odyssey and e-filing and never connects to them.

## Run it

```bash
npm ci
npm run dev
```

Open http://localhost:3000 and choose a demo role. With no settings the app runs in demo mode on made-up data, so it needs no accounts, database or keys.

- **Supabase mode.** Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`) and apply `supabase/migrations` to run on Postgres with invite-only sign-in.
- **Checks.** `npm run verify` runs lint, type checking, unit and access-rule tests, a build, the bundle check and the browser tests.
- **Static demo.** The live demo above is a single HTML file: `sh scripts/build-site.sh` builds it into `site/`.

The [quickstart](specs/001-filing-problem-tracker/quickstart.md) has the settings and the steps.

## Where AI is used

When an [OpenJev](https://huggingface.co/openjev/OpenJev-Flash-9B) decision model is running, on a Mac or a Hugging Face Space (see the [quickstart](specs/001-filing-problem-tracker/quickstart.md)), it suggests a problem while a clerk types a note and sorts the import rows the keyword rules cannot. The model first thinks the note through in its own words, shown as it writes, then picks a problem from the fixed list; each AI tag is labelled, gives a short reason and keeps the model's words under "Show reasoning". The clerk accepts or changes every suggestion, and names and case numbers are taken out of a note before it is sent. The dashboard uses no AI, and every number is counted by code. The Render demo runs no AI: its suggestions come from keyword rules and say so.

## Docs

The project follows [GitHub Spec Kit](https://github.com/github/spec-kit).

- [Constitution](.specify/memory/constitution.md): the rules every change must meet.
- [Spec](specs/001-filing-problem-tracker/spec.md): user stories and requirements.
- [Plan](specs/001-filing-problem-tracker/plan.md): architecture, stack and security model.
- [Research](specs/001-filing-problem-tracker/research.md): decisions, credits and licences of third-party material.
- [Data model](specs/001-filing-problem-tracker/data-model.md): tables and access rules.
- [Quickstart](specs/001-filing-problem-tracker/quickstart.md): run, settings, checks and deploy.
- Contracts: [HTTP API](specs/001-filing-problem-tracker/contracts/http-api.md), [AI](specs/001-filing-problem-tracker/contracts/ai.md), [pages and design tokens](specs/001-filing-problem-tracker/contracts/ui.md).
- [Tasks](specs/001-filing-problem-tracker/tasks.md): build steps.
