# Security

The Filing Problem Tracker is a course prototype. All data it ships with is made up. It has not been reviewed by a court, has not had an independent security test, and should not hold real court data until the work in `PILOT.md` is done.

This file says what the code does to protect data, where each control lives, and where the gaps are.

## Reporting a problem

Report it privately. Do not open a public issue that describes a weakness.

- If the repository is on GitHub, use "Report a vulnerability" under the Security tab (a private advisory).
- Otherwise, contact the course team (Northeastern CS4535, Team 1) through the course staff.

Say what you found, how to reproduce it, and which commit you tested. Do not include real names, case numbers or court records in a report. This is a student project: there is no bounty and no promised response time. A court that pilots the tracker names its own incident contact (`PILOT.md`, section 7) and that contact replaces this section.

## What the app may hold

Counts about filings: county, filing date, case type, form, what was wrong (tags from a fixed list), the outcome, and optionally a short note or, for imported rows, the clerk's rejection reason. Plus staff accounts (work email, role, county), saved workspace folders, recorded changes and an audit log.

What it must never hold: a litigant's name, a case number, an address, a phone number, an email address, a Social Security number, or a document. There is no field for any of them, and free text is checked for them (below).

## Who can see what

| | Clerk | Court leader | Administrator |
|---|---|---|---|
| Read flagged filings | Own county | All counties | All |
| Read notes and raw reasons | Own entries; own county's rows waiting for review | Never | All |
| Add a filing, import | Own county only | No | Any county |
| Remove an entry | Own, within 5 minutes | No | Any, any time |
| Recorded changes | Read | Read | Read and write |
| Workspace folders | Own | Own | Own |
| Audit log | No | No | Read |

A clerk can put back an entry only if they removed it themselves. One that an administrator removed stays removed until an administrator restores it: who removed an entry is recorded with it (in Supabase mode by the database, which does not let anyone write that column).

A clerk's county comes from their account, never from the request. A request that names another county is refused with 403. It is not quietly rewritten.

The same table is enforced twice, by two separate pieces of code:

- **Demo mode:** `src/server/repo/memory.ts`, in TypeScript.
- **Supabase mode:** `supabase/migrations/20261110120200_access_rules.sql`, in the database. Row level security is enabled and forced on every table. The app connects as the signed-in person, so every statement passes through the policies. The signed-in database role has no read privilege on the note and reason columns; two functions are the only way to that text and they apply the rule themselves. `supabase/README.md` has the detail.

`tests/unit/memory-repo.test.ts` and `tests/rls/access.test.ts` check the table cell by cell against each implementation.

## Signing in

**Demo mode** has no real sign-in. Anyone who can reach the server can pick any role, including administrator. That is the point of a demo, and it is why demo mode must only ever hold made-up data. The chosen role is kept in a cookie (`fpt_demo`) that is signed with HMAC so it cannot be altered, is `httpOnly` and `SameSite=Lax`, is marked `Secure` when the request arrived over https, and lasts 8 hours. A production start in demo mode refuses to run unless `DEMO_COOKIE_SECRET` is set or `ALLOW_DEMO=1` says it is intended.

**Supabase mode** signs people in with a link sent to their work email. There are no passwords in the app.

- Accounts are by invitation. Asking for a link never creates an account, and a person Supabase recognizes but who has no profile (role and county, added by an administrator) is signed out again and can read and write nothing.
- The answer to "send me a link" is the same whether or not the address has an account, so the form cannot be used to find out who does. Requests are limited per network address and per mailbox.
- The session is kept in `httpOnly`, `SameSite=Lax` cookies that scripts on the page cannot read. The browser never talks to Supabase directly.
- There is no second factor and no single sign-on. See "Known gaps".

## Every request

- **Checked twice for a session.** `src/proxy.ts` turns away requests with no session before they reach a page or an API route (pages go to `/login`, API calls get 401). Each route handler and page then calls `requireSession` itself, which is the check that decides. The paths reachable without a session are listed at the top of `src/proxy.ts`.
- **Same-origin only for changes.** `handle()` in `src/server/http.ts` refuses any state-changing request whose `Origin` is not the app's own (`APP_ORIGIN` when set, otherwise the request's host). This is the defence against another site submitting a request with a signed-in person's cookies. The MCP endpoint is the one exception: it takes no cookie.
- **Validated.** Every body is parsed with a strict Zod schema: unknown fields are refused, and counties, case types, forms, problems and outcomes must be on the reference lists. Dates must be real, not in the future and not before 2020. In Supabase mode the database repeats these as check constraints.
- **Size limits.** A request body may be 6 MB at most, a CSV 5 MB and 10,000 rows, a note 200 characters, a reason 500.
- **Rate limits.** Per person per minute: 60 changes and 20 AI requests. Sign-in attempts are limited per network address. A request over the limit gets 429 with `Retry-After`. The address is read from `X-Forwarded-For` only as far as `TRUSTED_PROXY_HOPS` says the proxies in front of the app can be believed (`src/server/clientAddress.ts`). With the default of 0 the header is ignored, since a caller can write anything into it, and all sign-in attempts share one limit: set the value for the host (`docs/DEPLOY.md`). Resetting the demo data counts as a change and does not clear anyone's limits.
- **Free text is checked wherever it is stored.** Notes, imported reasons and the name given to an import batch all go through the personal data check below.
- **When Supabase Auth cannot be reached**, nobody is treated as signed out: pages and API routes answer 503 with `Retry-After`, and the session cookies are left alone. Every request to Supabase has a 10 second deadline.
- **Signing out** ends the session even when the audit entry for it cannot be written, and the page only goes to the sign-in screen once the server has confirmed the session is gone.
- **Errors say little.** An unexpected error returns a generic message and a request id. Stack traces go to the server log, never to the browser. A validation error names the field and the rule, not the value that was sent.
- **Logged without content.** One JSON line per request: request id, method, path, user id, status, duration. No bodies, no notes, no reasons, no email addresses.
- **Audited.** Adding, removing and restoring a filing, an import, a change to a recorded change, saving or deleting a folder and, in Supabase mode, signing in and signing out each write an audit entry: who, what, when, and counts or reference values. Free text is stripped from audit entries before they are written. Administrators can read the log; nobody can edit it through the app, and in Supabase mode the database grants no update or delete on it.

## The personal data check

`src/lib/pii.ts` looks at every note and every imported reason for text shaped like a case number (including the Indiana uniform case number format), a Social Security number, a phone number, an email address, a street address, or a first and last name. Court vocabulary (county names, form names, problem names, months) is allowed.

- A note that trips the check is refused on the server (HTTP 422, with the kind of thing found). The form shows the same warning while the clerk types.
- An imported row whose reason trips the check is listed as rejected in the preview, is not sorted, is not sent to the AI, and is not saved. The commit step runs the check again on every row.

The check covers notes, imported reasons and workspace requests. The name and description of a recorded change (administrators only) get a narrower check: text shaped like a case number, a Social Security number, a phone number, an email address or a street address is refused with HTTP 422, but the first-and-last-name pattern is not applied there, because change names such as "Revised small claims form" trip it. Folder names and panel titles are not checked.

It is pattern matching. It will miss some things (a name in capitals, a first name alone) and will sometimes refuse harmless text. It reduces slips; it does not make free text safe. The database cannot run this check, so it protects requests that come through the app, not a person calling the database API directly with their own sign-in.

## Secrets

| Setting | Secret | Where it is used |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Server, AI features only |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes, the most sensitive | Server, MCP endpoint in Supabase mode only |
| `MCP_TOKEN` | Yes | Server, MCP endpoint in demo mode |
| `DEMO_COOKIE_SECRET` | Yes | Server, signs the demo cookie |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No. Public by design | Built into the browser bundle. The anon key grants nothing by itself: the database gives the anonymous role no privileges. |

Secrets are read in server-only modules. Every module under `src/server` that reads one starts with `import "server-only"`, which makes the build fail if a client component imports it.

`npm run check:bundle` (`scripts/check-bundle.mjs`) runs in CI after the build and fails if any file under `.next/static` contains: the name of one of the four secret settings, the value of one that is set, the path of a module under `src/server`, or a sentence that exists only in `src/server` source files. The last two catch server code that was bundled for the browser even where no secret is involved.

The service role key bypasses row level security. The app uses it in one file (`src/server/mcp/supabase-tokens.ts`) to call three database functions that each check the caller's MCP token and apply the token holder's own scope. It is never used to serve a page or an ordinary API request. Leave it unset if the MCP endpoint is not used.

## HTTP response headers

Set in `next.config.ts` on every response.

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | See below | Limits what a page may load and where it may send data |
| `X-Frame-Options` | `DENY` | No framing, for browsers that predate `frame-ancestors` |
| `X-Content-Type-Options` | `nosniff` | The browser must not guess content types |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites learn the origin at most, never a path or query |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | The app uses none of these, so no script may |
| `Cross-Origin-Opener-Policy` | `same-origin` | A window opened from another site cannot script this one |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | https only for two years. Sent by production builds; browsers ignore it over plain http, so local runs are unaffected. |

The `X-Powered-By` header is turned off.

### The Content-Security-Policy, line by line

In a production build, in demo mode:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

| Directive | Allows | Why |
|---|---|---|
| `default-src 'self'` | Only this origin, for anything not listed below | Nothing is loaded from another site: no CDN, no analytics, no font service |
| `script-src 'self' 'unsafe-inline'` | Script files from this origin, and inline scripts | Next.js writes each page's data into inline scripts, and the layout has one small inline script that applies the saved light or dark theme before first paint. See "What the policy does not do". |
| `style-src 'self' 'unsafe-inline'` | Stylesheets from this origin, and inline styles | Next.js and its image component set inline styles |
| `img-src 'self' data:` | Images from this origin and inline `data:` images | The courthouse still and icons. No remote images. |
| `font-src 'self'` | Fonts from this origin | The three typefaces are self-hosted |
| `media-src 'self'` | Video from this origin | The courthouse loop on "How it's used" |
| `connect-src 'self'` | Requests to this origin only | Pages call the app's own API and nothing else |
| `object-src 'none'` | No plugins | |
| `frame-src 'none'` | The app embeds no frames | |
| `frame-ancestors 'none'` | No site may put the app in a frame | Clickjacking |
| `base-uri 'self'` | No `<base>` pointing elsewhere | |
| `form-action 'self'` | Forms post only to this origin | |

Two things change it:

- **Supabase mode** adds the Supabase project's origin (taken from `NEXT_PUBLIC_SUPABASE_URL`) to `connect-src`. The pages do not call Supabase from the browser today, so this entry is unused and can be removed from `next.config.ts` if that stays true. The policy is fixed when the app is built: rebuild after changing the URL.
- **`next dev`** adds `'unsafe-eval'` to `script-src` and `ws: wss:` to `connect-src`, which React's development tooling and the reload socket need. Neither is ever sent by a production build.

### What the policy does not do

`ARCHITECTURE.md` asks for a nonce or hash based policy. This one is not: `script-src` allows inline scripts. The reasons are specific to this code:

- A nonce has to be made per request and every page rendered on request. The app builds with `cacheComponents`, which prerenders page shells, and the Next.js documentation states that prerendered shells cannot carry a nonce.
- A list of hashes cannot cover the inline scripts Next.js generates, because they differ per page and per request.

What this means: if an attacker found a way to inject HTML into a page, the policy would not stop an injected inline script from running. It would still stop that script from loading code from another site, sending data to another site (`connect-src`, `form-action`, `img-src` are all same-origin), or framing the app. The first line of defence against injection remains that React escapes everything it renders and that the app has one fixed inline script and no place where user text is written as HTML.

To close the gap: generate a nonce in `src/proxy.ts` as the Next.js Content-Security-Policy guide shows, turn off `cacheComponents` so every page renders per request, and pass the nonce to the theme script in `src/app/layout.tsx`. That trades some speed for a strict policy, and is the right trade before real data.

The header values above were produced by loading `next.config.ts`. They have not been inspected on a running server by hand. The end-to-end tests run against a production build that sends these headers, so a policy that breaks a page shows up there as a failing test.

## AI

AI is off unless `ANTHROPIC_API_KEY` is set. With it on, the server sends the following to the Claude API, and nothing else:

| Feature | What is sent | What is never sent |
|---|---|---|
| Sorting imported reasons | The reason text of rows that passed the personal data check, each distinct wording once, numbered by position. The list of problem categories. | Notes. Reasons that failed the check. County, date, form, who imported it. |
| Summary | Counts and percentages worked out on the server from the filings the person may see, the filters in words, today's date, and, if a recorded change is selected, its name, date, county, case type and before and after averages. | Any single filing. Notes, reasons. Who is asking. |
| Workspace | The words the person typed in the command bar (only if they pass the personal data check), today's date, the list of recorded changes (id, name, date, county, case type, problem), the order of counties by volume, and the reference lists. | Any filing, any count, notes, reasons. |

Things to know:

- A workspace request is run through the personal data check first. If it trips the check it is not sent to the model, the keyword matcher chooses the panels instead, and the page says so.
- The name of a recorded change is free text written by an administrator. It is sent as typed and is not run through the personal data check. Do not put personal data in it.
- Text from people is placed in the prompt as marked data, with angle brackets escaped, and the instructions tell the model to treat it as data. That lowers the chance of a typed instruction steering the model. It does not remove it, so nothing the model returns is trusted:
  - sorting results must be tags from the fixed list, or the row goes to "Needs review";
  - a summary is discarded if it contains a number that was not in the counts it was given, if it reads as advice, or (in demo mode) if it does not say the numbers are sample data;
  - workspace panels are validated against the same schema as hand-made ones, and the model never supplies a number: every figure on a panel is computed by the app.
- Nothing the model writes is shown to litigants. The tracker has no litigant-facing page.
- The server logs sizes, the model name, the stop reason and token counts for each call. It does not log prompts or replies.
- What the provider does with the data it receives is governed by the provider's terms, not by this code.

## The MCP endpoint

`POST /api/mcp` lets a person ask about the tracker from inside Claude. It offers five read-only tools that return counts and reference lists. No tool returns a filing, a note or a reason, and no tool changes anything.

- **Demo mode:** one shared token in `MCP_TOKEN`. With no token set the endpoint answers 404. The token acts as the demo court leader. It is compared in constant time.
- **Supabase mode:** a token per person. Only its SHA-256 hash is stored, a token can be revoked, and the tools see exactly what that person can see in the app, with notes and reasons left out for everyone. Tokens are issued by an operator in SQL (`supabase/README.md`); there is no screen for it. This path needs `SUPABASE_SERVICE_ROLE_KEY` (see "Secrets"); without it no token is accepted.
- Requests are rate limited per token holder. The endpoint takes no cookie, so the same-origin check does not apply to it.

A token is a password for the data its holder can read. Whoever connects it to Claude sends the counts the tools return to that Claude conversation.

## Supply chain and CI

- Dependencies are installed from the lockfile (`npm ci`).
- The CI workflow has read-only permission to the repository, holds no secrets, does not keep the checkout token, and runs every test in demo mode with AI off.
- GitHub Actions are referenced by version tag, not by commit hash. Pinning to hashes, and turning on automated dependency alerts, are both open.

## Known gaps

Stated plainly, so nobody finds them by surprise.

1. The Content-Security-Policy allows inline scripts (above).
2. Rate limits live in the memory of one server process. With several instances each counts separately, and a restart clears them. Until `TRUSTED_PROXY_HOPS` is set for the host, sign-in attempts from everyone share one limit, so a burst from one place can make others wait a minute.
3. The personal data check is pattern matching and runs only in the app.
4. Removing an entry keeps the row, note included. There is no purge.
5. No second factor, no single sign-on, and no screen for managing accounts or MCP tokens.
6. Nothing in Supabase mode has been run against a real Supabase project. The access rules are tested against Postgres running in memory with a Supabase-like setup.
7. No independent security test, and no review of indirect dependencies.
8. Demo mode is open to anyone who can reach it. Never put anything but the sample data in it. Its store is capped (50,000 filings, 500 import batches) so it cannot be filled until the server runs out of memory; past the cap, adding is refused until the demo data is reset.
9. The courthouse photograph is not cleared for public use (`THIRD_PARTY.md`).
