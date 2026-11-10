<p align="center">
  <img src="docs/assets/cover.png" alt="Filing Problem Tracker. Tag, patterns, fixes. An Indiana courthouse drawn in ASCII characters." width="960">
</p>

# <img src="docs/assets/mark.svg" alt="" width="28"> Filing Problem Tracker

A small web tool for Indiana trial courts. Clerks tag why a filing from someone without a lawyer was rejected, and court leaders see which problems are most common and whether a fix helped.

**Live demo:** https://filing-problem-tracker.onrender.com

> [!NOTE]
> Student prototype for Northeastern CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts. All data is made up, and it gives no legal advice.

## What it does

- **Tag a filing.** A clerk picks the county, case type and form, clicks what was wrong, and saves. No names or case numbers.
- **Import past rejections.** Paste a spreadsheet export and the tool sorts each typed reason into the same problem list.
- **Dashboard.** The most common problems by county, case type and form.
- **Before and after.** Whether a change, such as a revised form, reduced a problem.

It sits next to Odyssey and e-filing and never connects to them.

## Run it

```bash
sh scripts/build-site.sh
open site/index.html
```

The prototype is one HTML file with no dependencies. `render.yaml` deploys it to Render as a static site.

## Docs

The project follows [GitHub Spec Kit](https://github.com/github/spec-kit).

- [Constitution](.specify/memory/constitution.md): the rules every change must meet.
- [Spec](specs/001-filing-problem-tracker/spec.md): user stories and requirements.
- [Plan](specs/001-filing-problem-tracker/plan.md): architecture and stack.
- [Tasks](specs/001-filing-problem-tracker/tasks.md): build steps.
