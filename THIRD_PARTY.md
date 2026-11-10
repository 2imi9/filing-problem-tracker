# Third-party material

What this repository includes or builds on that the team did not write, and under what terms. The project's own code is under the MIT License (see `LICENSE`).

## Fonts

The three typefaces are served from the app itself. The files are in `src/fonts` (Latin subsets, WOFF2) and are loaded with `next/font/local`, so neither a build nor a page view contacts a font service.

All three are licensed under the SIL Open Font License, Version 1.1. The copyright lines below are copied from the metadata inside the font files; each file also carries the license address. The license text is at https://openfontlicense.org. The license asks that the copyright notice and the license stay with every copy of the fonts, so keep the files' metadata intact and keep this section if you redistribute them.

| Typeface | Used for | Files | Version | Copyright notice in the files |
|---|---|---|---|---|
| EB Garamond | Headings | `eb-garamond-latin-wght-normal.woff2` | 1.003 | Copyright 2017 The EB Garamond Project Authors (https://github.com/octaviopardo/EBGaramond12) |
| Lato | Body text | `lato-latin-400-normal.woff2`, `lato-latin-700-normal.woff2` | 1.104 | Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic with Reserved Font Name "Lato". Licensed under the SIL Open Font License, Version 1.1. |
| IBM Plex Mono | Numbers, dates and data | `ibm-plex-mono-latin-400-normal.woff2`, `ibm-plex-mono-latin-500-normal.woff2` | 2.3 | Copyright 2017 IBM Corp. All rights reserved. |

## Design guidance

The design system (colors, type pairing, layout habits, the pre-delivery checklist) was produced with the `ui-ux-pro-max` skill and then adapted by the team.

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- License: MIT
- What is here: `design-system/MASTER.md` is the record of what the skill returned, and the "Design system" section of `ARCHITECTURE.md` describes what was kept and what was changed. The skill itself is not part of this repository and the app does not load it.

## Courthouse photograph and video: not cleared

`public/media/courthouse_leaves_still.png` and `public/media/courthouse_leaves_loop.mp4` (a short loop made from the same photograph) are used as the header of the "How it's used" page.

**The source and the license of this photograph are not yet confirmed.** The page shows "Photo: credit to be added" for that reason.

Until both are confirmed:

- do not publish these two files publicly: no public repository, no public deployment, no slides or posts that include them;
- a deployment that is reachable only by the team and the course staff is the limit.

Before any public release, do one of two things: confirm the photographer or owner and the license, add the credit line the license asks for to the page and to this file; or replace both files with an image the team has the right to use. If the files have been in a repository that is about to become public, remove them from its history as well.

## Sample data

Every record the app ships with is made up by the generator in `src/lib/sample.ts`. It is not derived from court records. County names are real Indiana counties; the counts attached to them are not real.

## Software

Direct dependencies and the license each package declares in its own `package.json`. The full tree, with versions, is in `package-lock.json`.

Used by the running app:

| Package | License |
|---|---|
| `next` | MIT |
| `react`, `react-dom` | MIT |
| `zod` | MIT |
| `@supabase/supabase-js`, `@supabase/ssr` | MIT |
| `@anthropic-ai/sdk` | Apache-2.0 |
| `@modelcontextprotocol/sdk` | MIT |

Used only to build and test:

| Package | License |
|---|---|
| `typescript` | Apache-2.0 |
| `eslint`, `eslint-config-next` | MIT |
| `vitest`, `vite`, `@vitejs/plugin-react` | MIT |
| `@electric-sql/pglite` | Apache-2.0 |
| `@playwright/test` | Apache-2.0 |
| `@axe-core/playwright` | MPL-2.0 |
| `@types/node`, `@types/react`, `@types/react-dom` | MIT |

The licenses of indirect dependencies have not been reviewed. A court that adopts this code should run its own license scan.
