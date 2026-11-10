# Contract: pages and design system

## Pages

Sidebar navigation on desktop (Tag a filing, Import, Dashboard, Workspace, How it's used, Admin for admins); fixed bottom tab bar under 820px. Clerks land on Tag a filing, leaders on Dashboard. A visible "Prototype. All data is made up." flag on every page in demo mode.

- **Tag a filing**: county (fixed for clerks), case type, form, numbered problem chips (keys 1 to 9 toggle, Enter saves), outcome, optional note with live PII warning, saved toast with Undo, recent entries.
- **Import**: paste or upload CSV, preview with per-row source (AI or rules) and confidence, rejected rows listed with the reason, commit.
- **Dashboard**: sticky filter bar with removable chips, KPI tiles with sparklines, ranked problems, outcomes, county x problem heat table, forms table, before/after panel, optional AI summary on request.
- **Workspace**: a command bar instead of a chat. A request opens panels on a grid. Panels can be re-filtered by hand, resized (s / w / l), reordered (drag, and keyboard-accessible move buttons), minimized, duplicated, closed. A folder rail saves and reopens sets of panels. Three example folders ship with the sample data. "Add panel" menu works with no AI.
- **How it's used**: three scenario cards with inline SVG line illustrations.

## Design system

Source: the `ui-ux-pro-max` skill (MIT, github.com/nextlevelbuilder/ui-ux-pro-max-skill), queried for a government / court internal analytics and data entry tool with dials variance 5, motion 2, density 7. Its landing-page pattern and GSAP scroll reveal are not used: this is an internal tool, not a marketing page, and it adds no animation library.

- **Style**: "Accessible & Ethical" (the skill's match for government, legal compliance and public-sector tools) with the layout habits of its "Data-Dense Dashboard" style on the dashboard and workspace: 12-column grid, KPI row, compact cards (12 to 16px padding), 36px table rows, sticky table headers, 240px sidebar, 56px header.
- **Color tokens** (CSS variables in `globals.css`; light values shown, with a full dark theme):

  | Token | Value | Use |
  |---|---|---|
  | `--color-primary` | `#1E3A8A` | navigation, selected state, links, focus ring |
  | `--color-secondary` | `#1E40AF` | hover on primary |
  | `--color-accent` | `#B45309` | the one primary action per view (Save tags, Add rows, Open panels). Nothing else. |
  | `--color-background` | `#F8FAFC` | page |
  | `--color-card` | `#FFFFFF` | panels |
  | `--color-foreground` | `#0F172A` | text |
  | `--color-muted` / `--color-muted-foreground` | `#E9EEF5` / `#475569` | quiet surfaces / secondary text |
  | `--color-border` | `#CBD5E1` | hairlines |
  | `--color-destructive` | `#DC2626` | Rejected, errors (text on white uses `#B91C1C` for 4.5:1) |
  | `--color-success` | `#166534` | Fixed at counter, a drop in the before/after figure |

  "Authority navy and trust gold". Color is never the only signal: outcome pills carry their label, heat table cells print their number, the trend line has point markers and a data table alternative.
- **Type**: headings EB Garamond (legal, formal, document-like); body Lato; numbers, dates and data in IBM Plex Mono with tabular figures. Fonts are self-hosted from `src/fonts` through `next/font/local` so builds need no network. Body text is 16px minimum; dense tables may go to 14px. KPI numerals about 40px.
- **Key effects**: clear 3px focus rings, a skip link to main content, 44x44px minimum touch targets, `cursor: pointer` on everything clickable, hover transitions 150 to 300ms, reduced motion respected.
- **Shape**: inputs 4px radius, cards 6px, dialogs 10px, pills full. Hairline borders, no decorative shadows.
- **Charts** (the skill's chart guidance): ranked bar lists sorted descending with direct value labels; line chart for monthly trends with markers; heat table prints values in cells and includes a legend; every chart has a visible or toggleable data table and a one-sentence summary. Plain SVG, no chart library.
- **Forms** (the skill's UX guidance): on a failed submit, an error summary at the top of the form with `role="alert"` receives focus and links to each invalid field, and inline errors stay. Every submit shows loading, then success or an error with a way to recover.
- **Motion**: two moments only, the saved toast and new workspace panels highlighting once.
- **Avoid** (the skill's anti-patterns for this product type, plus its delivery checklist): an outdated look, purple or pink "AI" gradients, gradient text, glass blur, emoji used as icons (use inline SVG icons), hype copy.
- **Pre-delivery checklist**: no emoji icons; pointer cursor on clickables; hover states; 4.5:1 text contrast in both themes; visible keyboard focus; reduced motion; responsive at 375, 768, 1024 and 1440px with no horizontal page scroll (tables scroll inside their panel); semantic HTML (`table`, `nav`, `button`, `dialog`), every input labeled, `aria-pressed` on chips, `aria-live` for status.


Copy is plain and specific: say what a control does. No legal advice anywhere; labels describe what was wrong with a filing, never what a filer should do.
