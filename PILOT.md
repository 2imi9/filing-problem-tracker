# Before a pilot with real data

**Status: none of this has been done.** The Filing Problem Tracker is a course prototype (Northeastern CS4535, Team 1). Every record it ships with is made up. No court has reviewed it, approved it or agreed to use it, and nothing in this repository makes that decision for a court.

This is the list of work a court's IT and security staff would expect to see finished before one real filing is tagged. Each item says what the code does today, so the reviewer can tell what is a control and what is a promise. Where the code has a gap, the gap is named.

The boxes are for the court and whoever operates the service to tick. None are ticked.

## 1. Ownership and the decision to proceed

- [ ] A named sponsor at the court owns the pilot and can stop it.
- [ ] The court's IT and security staff have reviewed this document, `SECURITY.md` and `ARCHITECTURE.md`, and have had access to the code.
- [ ] A named operator runs the service (deploys, holds the keys, answers incidents). Today there is none: the course team does not operate a service.
- [ ] The court has confirmed that tagging happens next to its case management and e-filing systems and changes neither. The tracker has no connection to either system. It reads nothing from them and writes nothing to them.
- [ ] Whoever advises the court on its rules for access to court records has looked at what the tracker stores (section 2) and said which rules and policies apply. This repository takes no position on that.

## 2. Data classification

What one flagged filing holds:

| Field | Values |
|---|---|
| County | One of the listed Indiana counties |
| Filing date | A calendar day |
| Case type and form | From fixed lists |
| Problems | One to nine tags from a fixed list |
| Outcome | From a fixed list |
| Note (optional) | Free text typed by a clerk, up to 200 characters |
| Reason (imported rows only) | Free text from the clerk's export, up to 500 characters |
| Who added it and when | An account id and a timestamp |

The service also holds: staff accounts (work email, role, county), saved workspace folders (filters only), recorded changes (a name, a date, a county, a case type, a problem, a description), and an audit log (who did what and when, with counts and reference values).

There is no field for a litigant's name, a case number, an address, a date of birth or a document. The tracker does not store filings.

- [ ] The court has assigned a classification to this data set under its own scheme, including the staff account data.
- [ ] The court has considered re-identification. A row has no name, but an exact filing date with a county, a case type and a form can point to one filing where volumes are small. Options the court may want: store the month instead of the day, or suppress small counts on leader views. Neither is built.
- [ ] The court has decided whether the two free-text fields are allowed at all in a pilot. They are the only place personal data can enter. Turning them off is a small change, but it is not a setting today.

## 3. The no-personal-data rule and its technical controls

The rule: nothing that identifies a litigant is typed into, imported into or kept in the tracker.

What enforces it in the code today:

| Control | Where | What it does | Limit |
|---|---|---|---|
| No fields for identifying data | `src/lib/domain.ts`, `src/lib/schemas.ts`, `supabase/migrations` | Every request body is checked against a strict schema: unknown fields are refused, and every listed value must be on the reference lists. | Free text remains in notes and imported reasons. |
| Personal data check on notes | `src/lib/pii.ts`, `POST /api/flags` | A note that looks like it holds a case number, Social Security number, phone number, email address, street address or a person's name is refused (HTTP 422) and the form says which kind was found. The form also warns while typing. | Pattern matching. It can miss a name typed in capitals or a first name on its own, and it can refuse an innocent capitalized phrase. |
| Personal data check on imports | `POST /api/import/preview`, `POST /api/import/commit` | A row whose reason trips the check is listed as rejected in the preview and is never sorted or saved. The commit step checks every row again on the server. | Same as above. |
| Leaders never receive free text | `src/server/repo`, `supabase/migrations/20261110120200_access_rules.sql` | Notes and reasons are left out of everything a court leader can read. In the database, the signed-in role has no read privilege on those two columns at all. | An administrator can read all of it. |
| The AI never receives notes | `src/server/ai` | Only reasons that pass the check are sent for sorting, and only counts are sent for summaries. | See `SECURITY.md`, "AI". |
| The audit log holds no free text | `src/server/audit.ts` | Keys named note, reason, text or csv are dropped before an entry is written. | |
| Logs hold no request bodies | `src/server/http.ts` | One line per request: id, method, route, user id, status, time. Rejected values are not echoed in errors or logs. | The hosting provider's own access logs are outside the app. |

What is missing and would need to exist for a pilot:

- [ ] A way to purge. Removing an entry in the app marks it as removed and keeps the row, including its note. If personal data gets in, an operator has to delete the row in SQL. There is no purge screen and no purge job.
- [ ] A written procedure for "personal data was found in a note": who is told, who deletes it, by when, and how it is recorded.
- [ ] Training for clerks that says the same thing the screen says: no names, no case numbers, describe the problem only.
- [ ] A periodic sample of notes and reasons read by a person, to measure how often the check misses.
- [ ] A decision on the database-side gap: the personal data check runs in the app. A person who calls the database API directly with their own sign-in is held to every access rule but not to this check.

## 4. Hosting approval

`docs/DEPLOY.md` describes one way to run it: the app on Vercel, the data and sign-in on Supabase. That is a description, not an approval.

- [ ] The court has approved the hosting, or named its own. The app needs a Node.js host and, in its current form, a Supabase project (Postgres, sign-in, and the API in front of Postgres).
- [ ] Region and data location are chosen and written down for the app, the database, backups and email delivery.
- [ ] Every outside party that would handle the data is listed and accepted: the app host, the database host, the email provider that sends sign-in links, and the AI provider if AI is turned on.
- [ ] AI is a separate decision. With no API key the tracker works fully and contacts no AI service. If it is turned on, the provider receives rejection reasons that passed the personal data check, and counts. The court should read the provider's terms on retention and use of that data before saying yes.
- [ ] Rate limiting has a shared store. Today the limits are kept in the memory of one server process. On a host that runs several instances each keeps its own count, so the limits are weaker than they read.
- [ ] Monitoring and alerting exist: errors, sign-in failures, unusual volumes. Today there are structured log lines and `GET /api/health`, and nothing watches them.
- [ ] The Content-Security-Policy gap in `SECURITY.md` ("What the policy does not do") is accepted or closed.
- [ ] An independent security test has been run against a deployed copy. None has.

## 5. Data agreement

- [ ] A written agreement between the court and the operator covers: what data, for what purpose, who may see it, where it is kept, how long, how it is deleted, who is told about an incident and how fast, which outside parties are involved, and what happens to the data when the pilot ends.
- [ ] The agreement says who owns the data and that it is not used for anything but the pilot.
- [ ] The course team's role, if any, is written down. Students should not hold production keys or have database access to real data unless the court has said so in writing.

## 6. Accounts and access reviews

What exists: sign-in by emailed link, by invitation only. A person can do nothing until an administrator gives them a role (clerk, leader or administrator) and, for a clerk, a county. The access rules are in `SECURITY.md` and are enforced in the database.

- [ ] The court has decided whether an emailed link is an acceptable way to sign in, or whether it requires its own single sign-on or a second factor. Neither is built.
- [ ] Session length and sign-in link lifetime are set in the Supabase project to the court's standard.
- [ ] There is a named person who adds and removes accounts. There is no screen for this yet: it is done in the Supabase dashboard and SQL editor (`supabase/README.md`).
- [ ] Leavers are removed the day they leave: delete the profile row, and revoke any MCP access tokens they held.
- [ ] An access review is scheduled, at least quarterly: list every account with its role and county, confirm each with a supervisor, and record that it was done.
- [ ] The number of administrators is kept small and each is named. An administrator can read every note and reason.
- [ ] The audit log is reviewed on a schedule, and someone knows how to read it (Admin page, or the `audit_log` table).

## 7. Incident contact

- [ ] The court names an incident contact, and the operator names one, with a way to reach each outside office hours.
- [ ] `SECURITY.md` is updated with the real reporting address. Today it describes how to report a problem in the prototype to the course team.
- [ ] A short runbook exists: how to take the service offline, how to sign everyone out, how to rotate each key (`docs/DEPLOY.md`, "Rotating keys"), how to preserve the audit log and the host's logs, and who decides about notification.
- [ ] The runbook has been walked through once.

## 8. Retention

What the code does today: nothing is ever deleted automatically. Removed entries are kept and hidden. The audit log only grows. Backups follow whatever the database plan provides.

- [ ] The court sets a retention period for flagged filings, for notes and reasons (which may deserve a shorter one), for the audit log, for accounts of people who have left, and for backups.
- [ ] The purge that enforces those periods is built and tested. It does not exist.
- [ ] End of pilot: an export of the counts the court wants to keep, deletion of everything else including backups, and written confirmation from the operator.

## 9. Accessibility conformance review

What exists: the design follows an accessibility-first style (labels on every input, visible focus, keyboard operation of the tagging page, a light and a dark theme, reduced motion), and the end-to-end suite (`e2e/`) is where automated axe checks of each page run. Automated checks find a minority of accessibility problems. They are not a conformance review.

- [ ] A manual review against the standard the court is held to (commonly WCAG 2.1 AA) has been done by someone qualified: keyboard only, at least two screen readers, 200 and 400 percent zoom, both themes, and the phone layout.
- [ ] The charts have been checked with a screen reader, including the data table each one offers.
- [ ] Findings are fixed or accepted in writing, and a conformance report exists if the court's purchasing rules ask for one.
- [ ] Clerks who use assistive technology have tried the tagging page.

## 10. Verified on the real platform

The access rules are tested against a real Postgres engine running in memory, set up to behave like Supabase (`npm run test:rls`). They have not been run on a Supabase project.

- [ ] The migrations have been applied to a real project, and the access checks repeated there as a clerk in two different counties, a leader, an administrator, and a signed-in person with no profile.
- [ ] Sign-in by emailed link works end to end with the court's email system, including the link landing in a different browser than the one that asked for it.
- [ ] A backup has been restored into a scratch project and checked (`docs/DEPLOY.md`, "Backups and a restore drill").
- [ ] The production build has been checked with `npm run check:bundle` and the response headers inspected on the deployed site.

## 11. What a real pilot would measure

Agree on these before the pilot starts, with the numbers that would count as success, and say in advance how long the pilot runs.

- **Time to tag.** Seconds from opening the form to saving, observed at the counter. The saved message shows it to the clerk; it is not stored, so measuring it needs observation or a small addition.
- **Coverage.** Of the filings the court rejected or sent back in the period (counted from its own systems), what share were tagged. Low coverage makes every chart misleading.
- **Agreement between clerks.** Two clerks tag the same sample of rejected filings independently. How often do they pick the same problems. This says whether the tag list is clear enough.
- **Imports.** What share of imported reasons were sorted, what share went to "Needs review", and, on a hand-checked sample, how often the sorting (keyword rules, and AI if it is on) matched what a clerk would have chosen.
- **The personal data check.** How often it refused a note that held no personal data, and how many notes in a hand-read sample held personal data it missed.
- **Use by leaders.** Whether court leaders opened the dashboard, and whether any decision (a form revision, a guide) cites it.
- **Before and after.** For any change made during the pilot, whether there are enough full months and enough filings on each side for the comparison to mean anything. The panel compares monthly averages. It does not show that the change caused the difference.
- **Burden and trust.** What clerks say it costs them, in their own words, and whether they believe the numbers.
- **Operations.** Downtime, errors, access problems, and anything reported by people using assistive technology.

The tracker counts what was wrong with filings. It does not say what a filer should do, and a pilot should not measure it as if it did.
