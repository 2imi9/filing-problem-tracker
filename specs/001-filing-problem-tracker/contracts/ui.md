# Contract: pages and design system

The approved look is the single-file demo in `docs/prototype/filing_tracker.html`. The app matches it, and adds the pages the demo does not have.

## Frame

- **Header**: a soft navy band (`#172554`) with the courthouse picture `public/brand/courthouse-ascii-hero.jpg` under a navy wash. The project's own courthouse mark (`public/brand/mark.svg`) sits to the left of a large "Filing Problem Tracker" title, with one small intro line below. In demo mode a small yellow monospace line reads "PROTOTYPE. ALL DATA IS MADE UP.", with no box around it. From 1280px up the header block shifts 48px left. No official Indiana court seal or logo is used anywhere.
- **Tabs**: one tab bar, pinned to the top while the page scrolls. Each tab is a circled number and a label; the active tab's circle is filled navy. Tabs are numbered by position among the pages the role can open:

  | Role | Tabs |
  |---|---|
  | Clerk | 1 Tag a filing, 2 Import, 3 Dashboard, 4 Workspace, 5 How it's used |
  | Leader | 1 Dashboard, 2 Workspace, 3 How it's used |
  | Admin | 1 Tag a filing, 2 Import, 3 Dashboard, 4 Workspace, 5 How it's used, 6 Admin |

  The account menu and the light and dark switch sit at the right end of the bar. Tabs never wrap: on a narrow screen the row scrolls sideways and the page does not. Changing page while scrolled past the header keeps the bar at the top and starts the new page at its first line, by mouse and by keyboard: focus moving into the pinned bar does not scroll the page. Nothing that takes keyboard focus ends up under the bar, or under a row pinned below it (the dashboard's filters, the workspace's request row). There is no sidebar and no bottom bar.
- **Page body**: one intro sentence that fits on one line on desktop, then sections separated by plain rules with EB Garamond headings. No card frames around sections.
- **Footer**: "Student prototype for CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts. Counties are real; every number and entry is made up. This tool does not give legal advice." The sentence about made-up numbers shows in demo mode only. One more sentence says where AI is used. With AI off: "AI use: none on this copy. Import sorts with keyword rules, and every number is counted by code." With AI on it names the configured model and the three features that use it (sorting Import reasons when "Use AI sorting" is ticked, the dashboard summary, requests typed into the workspace), and says that tagging uses no AI and every number is counted by code.
- **Sign-in pages** (`/login`, `/auth/confirm`) have the same header and footer and no tab bar. The light and dark switch sits at the right end of the footer there; it does not get a bar of its own.

## Pages

Clerks land on Tag a filing, leaders and admins on Dashboard. A page a role cannot use says so instead of showing its controls.

| Path | Page | What is on it |
|---|---|---|
| `/login` | Sign in | Demo mode: choose a demo role. Supabase mode: ask for a sign-in link by work email. |
| `/auth/confirm` | Finish signing in | Where an emailed link lands; a Sign in button completes it. |
| `/log` | Tag a filing | County (fixed for a clerk), case type, form, filing date, problems, outcome, optional note with a live personal-data warning, Save tags (the saved message offers Undo), then the clerk's recent entries, each with Remove while it can still be removed. |
| `/import` | Import | Paste or upload a CSV, sort it, review the preview and the rows left out, add the rows. The preview says for each row whether the keyword rules, the AI model or the clerk sorted it. Rows that need review are listed below. |
| `/dashboard` | Dashboard | Filters, four key numbers, most common problems, outcomes, county by problem table, forms table, before and after a change, optional AI summary. |
| `/workspace` | Workspace | A request box that opens live panels, an add-panel menu that needs no AI, and saved folders. Panels can be filtered, resized (small, wide, full width), moved by drag or keyboard, minimized, duplicated and closed. |
| `/how-it-works` | How it's used | Three short scenarios: a clerk tags what was wrong, a court leader sees the pattern, the court checks whether a change helped. |
| `/admin` | Admin | Record and delete changes, read the audit log, reset the demo data. Admins only. |

## Controls

- **Dropdowns** start on a general choice ("Select case type", "Select form"; on Admin's Add a change: "Select county", "Select case type", "Select problem"), and a save names each one still on it. The form list is disabled until a case type is chosen, and a case type with one form selects it. A county fixed by the account stays fixed.
- **Problem choices** are square checkbox rows: 4px radius, a 16px square mark, and when chosen a soft accent background, an accent border and a navy tick. Keys 1 to 9 toggle them unless the person turns that off; Enter saves.
- **Outcome choices** are radio rows: a round mark that fills as a 5px ring in the outcome's colour.
- **Outcome labels in lists** are a coloured dot and one short word inside a thin neutral outline: "Pass" (Fixed at counter, green), "Fix" (Returned to fix, gold), "Reject" (Rejected, red). Each outline hugs its own word. The label sits in a slot as wide as the longest word, so in a list the dots start at the same left edge on every row. Screen readers get the full outcome name. This is the only capsule shape in the app.
- **Buttons**: one gold button per screen, for the main action. Everything else is quiet. On Import, once the preview shows, "Sort into categories" turns quiet and the add button is the gold one.
- **Forms**: a failed save shows an error summary at the top that takes focus and links to each field, and inline errors stay. Every save shows that it is working, then success or an error with a way to recover.

## Dashboard

- The four key numbers are one row split by thin dividers, not four cards, and their values share a baseline.
- Bar lists are sorted from most to least with the value printed beside each bar.
- The county table prints the number in every cell, and its shading stays light enough for dark text.
- The before and after chart has a dashed "Change" marker drawn over the gridlines and no area fill.
- Every chart has a data table and a one-sentence summary. Charts are plain SVG.
- The AI summary is plain text, never a card with a coloured edge. With AI off it is at most one quiet line.

## Design tokens

Defined once as CSS variables in `src/app/globals.css`. Dark applies when the system asks for it or when the person picks it.

| Role | Light | Dark |
|---|---|---|
| Page background | `#F8FAFC` | `#0B1220` |
| Surface | `#FFFFFF` | `#111A2B` |
| Text | `#0F172A` | `#E5EAF2` |
| Secondary text | `#475569` | `#A3B2C9` |
| Quiet fill | `#E9EEF5` | `#1A2640` |
| Rule and hairline | `#CBD5E1` | `#2C3A55` |
| Field border | `#64748B` | `#7C8BA3` |
| Accent (navy): tabs, links, selected state, focus ring, charts | `#1E3A8A` | `#9DBBF7` |
| Accent, soft: chosen checkbox row | `#E0E8F7` | `#1B2A4A` |
| Main action (gold) | `#B45309` | `#F0A64B` |
| Good: Fixed at counter, a drop | `#166534` | `#7FC28B` |
| Caution | `#92400E` | `#E6AE5A` |
| Bad: Rejected, errors | `#B91C1C` | `#F29A93` |
| Header band | `#172554` | `#172554` |

- **Type**: headings in EB Garamond, text in Lato, numbers, dates and data in IBM Plex Mono with tabular figures. Fonts are self-hosted from `src/fonts`. Body text is 16px or larger.
- **Shape**: 4px radius on fields, buttons and checkbox rows. Hairline borders. No shadows for decoration.
- **Motion**: colour transitions of about 150ms, and none under reduced motion.

## Rules

- No gradients except the navy wash over the header picture. No cards with a coloured left border, no grids of equal cards, few boxes, one dominant element per section.
- No pill badges or fully rounded chips other than the outcome label.
- No emoji. Icons are inline SVG line drawings.
- Plain words in every label and message: say what a control does. No legal advice anywhere; labels describe what was wrong with a filing, never what a filer should do.
- Colour is never the only signal: chosen rows carry a tick, outcome labels carry a word, table cells print their number.
- Accessibility: a skip link to the main content, a visible 3px focus ring, 44px minimum targets, every input labelled, `aria-pressed` on choice rows, live regions for status, full keyboard use, WCAG AA contrast in both themes, and no sideways page scroll from 320px up (wide tables scroll inside their own section, and a control in one that takes keyboard focus is brought fully into view).
