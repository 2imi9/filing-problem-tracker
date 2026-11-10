# Deploying: Vercel and Supabase

This is one way to run the tracker: the app on Vercel, the data and sign-in on Supabase. Any host that runs a Next.js server on Node 22 would do for the app.

**Read this first.**

- These steps were written from the code and from the two platforms' documentation. They have not been carried out: nothing in this repository has been deployed, and no Supabase project has been created for it. Expect to adjust details, and note what you changed.
- Menu names on both platforms change over time. Where a step names a screen, look for the nearest match.
- Deploying it does not make it fit for real court data. `PILOT.md` lists what a court would need first. Until then, deploy it with the sample data only.
- `public/media` holds a photograph and a video whose license is not confirmed (`THIRD_PARTY.md`). Do not make a deployment that includes them public.

There are two kinds of deployment:

| | Demo | Supabase |
|---|---|---|
| Data | Made-up sample data in the server's memory | Postgres, kept |
| Sign-in | Anyone picks a role | Emailed link, invitation only |
| Needs | Nothing | A Supabase project |
| Good for | The class demo | A shared prototype; later, a pilot |

## A. Demo deployment (no database)

1. In Vercel, create a project from the repository. The framework is detected as Next.js.
2. Leave the install command at its default (`npm ci` or `npm install`).
3. Add environment variables:
   - `DEMO_COOKIE_SECRET`: 32 or more random characters (`openssl rand -base64 48`). Without it, or `ALLOW_DEMO=1`, a production server in demo mode refuses to start.
   - `MCP_TOKEN` (optional): 24 or more random characters, if you want to show the Claude connector.
   - `ANTHROPIC_API_KEY` (optional): turns the AI features on.
   - `TRUSTED_PROXY_HOPS`: `1` on Vercel, so sign-in attempts are limited per network address. Left unset, they all share one limit.
4. Deploy. Open `/api/health`: it should answer `{"ok":true,"mode":"demo",...}`.

Know what you are showing. On a serverless host each server instance has its own copy of the sample data, and an instance that has been idle starts fresh. Something tagged a minute ago can vanish, and two people can see different totals. That is acceptable for a short demo and for nothing else. Anyone with the address can sign in as an administrator, so keep the address private or turn on Vercel's deployment protection.

## B. Supabase deployment

### 1. Create two Supabase projects

One for production and one for previews and testing. They must be separate projects with separate keys, so that a preview build can never read or write production data.

For each: choose the region the court (or the team) has agreed to, and store the database password in a password manager. Install the Supabase CLI on your machine and sign in (`supabase login`).

### 2. Run the migrations

From the repository root, for each project:

```bash
supabase link --project-ref <project ref>
supabase db push
```

This applies the three files in `supabase/migrations` in order: reference lists, tables with constraints, access rules. Run them as the project's own `postgres` role, which is what the CLI does. `supabase/README.md` explains why the owner matters.

Check: in the table editor every table shows row level security as enabled, and in the SQL editor

```sql
select count(*) from public.filing_flags;
```

returns 0.

### 3. Seed the sample data (optional)

Only for the preview project, or for a production project that is still a demonstration. Never mix sample rows with real ones.

```bash
psql "<the project's connection string>" -f supabase/seed.sql
```

or paste `supabase/seed.sql` into the SQL editor. It adds the 900 sample filings and the three sample changes, and creates no accounts.

Two things to expect. The sample filings are dated January to October 2026 and the database refuses filing dates in the future, so the seed only loads on or after 28 October 2026. And outside demo mode the app uses the real date, so the sample data will look older as time passes and the before and after panel, which looks back 12 months, will eventually run out of months to compare.

To regenerate the file after changing the sample data: `npm run seed:gen`.

### 4. Configure sign-in

In each Supabase project, under Authentication:

1. **Turn sign-ups off** and turn anonymous sign-ins off. Accounts are by invitation only.
2. **Site URL:** the app's address for that project, for example `https://tracker.example.gov` for production. The emailed links are built from it.
3. **Redirect URLs:** add `<app address>/api/auth/callback`.
4. **Email templates:** replace the "Magic link" and "Invite user" templates with `supabase/templates/magic_link.html` and `supabase/templates/invite.html`. Their links open the app's `/auth/confirm` page with a one-time token. The token is used only when the person presses Sign in on that page, so a mail scanner that opens links does not use it up, and the link also works when the email is opened in a different browser than the one that asked for it. The sign-in link also carries the page the person was on when they were sent to sign in (in its `redirect_to` value), and they land there afterwards; someone who came straight to the sign-in page, or who was invited, lands on their role's start page.
5. **Email delivery:** Supabase's built-in mail service is for trying things out and is tightly limited. Before inviting real users, connect your own SMTP provider and send from a domain the recipients will recognize.
6. Set the link lifetime and the session lifetime to what the court's policy asks for. `supabase/config.toml` shows the values used for local development (15 minute links, 1 hour access tokens).

### 5. Create the Vercel project and set environment variables

Create the project as in part A, steps 1 and 2. Then add variables, each scoped to the environment it belongs to. Vercel keeps separate values for Production and for Preview: use that to point each at its own Supabase project.

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production project URL | Preview project URL | Both must be set, or neither. Built into the browser bundle and the Content-Security-Policy, so a change needs a new build. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production anon key | Preview anon key | Public by design. |
| `APP_ORIGIN` | The production address, for example `https://tracker.example.gov` | The preview address, if it is a fixed one. Otherwise leave unset. | State-changing requests must come from exactly this origin. When unset, the request's own host is used for the comparison. |
| `ANTHROPIC_API_KEY` | Optional | Optional | Use different keys so one can be revoked alone. Leave unset to keep AI off. |
| `AI_MODEL` | Optional | Optional | Only to override the default in `src/server/config.ts`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Only if the MCP endpoint is used | Same | Mark it as sensitive. It bypasses row level security. See `SECURITY.md`, "Secrets". |
| `RATE_LIMIT_MUTATIONS_PER_MINUTE`, `RATE_LIMIT_AI_PER_MINUTE` | Optional | Optional | Defaults 60 and 20. |
| `TRUSTED_PROXY_HOPS` | `1` | `1` | How many proxies in front of the app set `X-Forwarded-For` and can be believed. On Vercel that is 1: Vercel writes the header itself. Use 0 (the default) for a server reached directly, and the number of appending proxies for any other setup. Sign-in attempts are limited per address read this way; at 0 they all share one limit. |

Do not set `DEMO_COOKIE_SECRET`, `ALLOW_DEMO`, `DEMO_RESET_CLEARS_LIMITS` or `MCP_TOKEN` on a Supabase deployment. They belong to demo mode.

Deploy, then open `/api/health`. It should answer `"mode":"supabase"`. If the server fails to start, the log has a line beginning `Configuration error:` that says which setting is wrong.

### 6. Preview deployments

Vercel gives every preview its own address. Sign-in links are built from the Supabase project's Site URL, so a link requested on one preview address would land somewhere else. Pick one stable address for testing sign-in (a branch domain such as `staging`), set it as the preview project's Site URL and redirect URL, and test sign-in there. Other preview addresses are still useful for looking at pages that redirect to `/login`, but not for signing in.

Keep previews private (Vercel deployment protection) while the photograph is not cleared and whenever a preview project holds anything but sample data.

### 7. Invite the first administrator

Nobody has access until a row in `profiles` says so, and the first one has to be added by hand.

1. In the Supabase dashboard, Authentication, Users: invite the person by email. They receive the invitation email with a link.
2. In the SQL editor:

```sql
insert into public.profiles (user_id, role)
select id, 'admin' from auth.users where email = 'first.admin@example.gov';
```

3. The person opens the link, lands on the dashboard, and sees "Admin" in the navigation.

Everyone after that is invited the same way, with their own role. A clerk has a county; a leader or administrator has none:

```sql
insert into public.profiles (user_id, role, county)
select id, 'clerk', 'Marion' from auth.users where email = 'new.clerk@example.gov';
```

To remove someone's access, delete their `profiles` row. It takes effect on their next request. There is no screen in the app for any of this yet.

Access tokens for the MCP endpoint are also issued in SQL: see `supabase/README.md`, "MCP tokens".

### 8. Check the deployment

- `/api/health` answers with `"mode":"supabase"` and the expected `"ai"` value.
- `POST /api/demo/login` answers 404.
- Signed out, `/dashboard` redirects to `/login`, and `/api/flags` answers 401.
- Sign in as a clerk: only that county appears, and a filing can be tagged and undone.
- Sign in as a leader: all counties appear, there is no "Tag a filing", and `/api/flags/needs-review` answers 403.
- Sign in as an administrator: the Admin page shows the audit log with the entries from the steps above.
- Look at the response headers of any page in the browser's developer tools and compare them with the table in `SECURITY.md`.
- Run `npm run check:bundle` after a local production build made with the same public variables.

## Platform limits to know about

- **Request size.** Vercel refuses request bodies above about 4.5 MB before they reach the app. The app itself accepts a CSV up to 5 MB, so on Vercel the largest import is a little smaller than the import page says. Split a large export into two files.
- **Function duration.** The AI summary route asks for up to 90 seconds and the workspace route for 60. Check that your Vercel plan allows that; if not, long AI requests will be cut off and the page will show its non-AI fallback.
- **Rate limits.** They are kept in each server instance's memory. On Vercel there can be several instances, so the real limit is looser than the configured one. A shared store is on the list in `PILOT.md`.
- **Database backups** depend on the Supabase plan. See the next section.

## Backups and a restore drill

A backup that has never been restored is a hope. Do the drill before any data matters, and repeat it on a schedule.

**What to have**

- Know what your Supabase plan provides: whether daily backups are included, how many days they are kept, and whether point-in-time recovery is turned on. Write it down next to the retention period the court has set.
- Take your own logical backup as well, on a schedule, and keep it somewhere the court has approved, encrypted. Supabase's backup and restore guide gives the commands for the CLI version you have. At the time of writing they are:

```bash
supabase db dump --linked -f roles.sql --role-only
supabase db dump --linked -f schema.sql
supabase db dump --linked -f data.sql --use-copy --data-only
```

A dump holds every note and reason, and the staff accounts. Treat the files with the same care as the database.

**The drill** (not yet performed for this project)

1. Create a scratch Supabase project. Do not restore over production to "test".
2. Restore into it: from the platform backup if your plan allows restoring to a new project. Otherwise load the three dump files in one transaction, with triggers and foreign key checks held off while the data loads, as the Supabase guide describes:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "<scratch connection string>"
   ```

   Then check that the sign-in accounts came across (`select count(*) from auth.users`). Every `profiles` row points at one, and a profile without its account is a person who cannot sign in.
3. Compare with production: row counts of `filing_flags`, `change_events`, `profiles`, `workspace_folders` and `audit_log`, and the newest `created_at` in `filing_flags`. The difference from production is the data you would have lost.
4. Confirm the access rules came back: every table has row level security enabled and forced, and the policies exist (`select tablename, policyname from pg_policies where schemaname = 'public'`).
5. Point a preview deployment at the scratch project and sign in as a clerk and as a leader. Check that a clerk still sees one county only. Accounts in the scratch project's Auth are separate, so invite a test user and add a profile row for it.
6. Write down the date, who did it, how long it took from "start" to "people can sign in", and anything that went wrong.
7. Delete the scratch project and the local dump files.

## Rotating keys

Changing an environment variable on Vercel does not affect running deployments: redeploy after every change below.

| Key | How to rotate | Effect |
|---|---|---|
| `ANTHROPIC_API_KEY` | Create a new key in the Claude Console, set it on Vercel, redeploy, confirm `/api/health` shows `"ai":true` and a summary works, then delete the old key. | None for users. |
| Supabase anon key | In the Supabase project's API settings. How depends on the kind of key the project uses: a newer publishable key is replaced by creating a new one and deleting the old; the older anon and service role keys both change when the project's JWT secret is rotated. Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` and redeploy (it is built into the bundle). | Rotating the JWT secret signs everyone out, and they sign in again. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same screen as above. Set the new value on Vercel and redeploy before retiring the old one where the platform allows both to exist at once. | The MCP endpoint refuses tokens while the deployed key is not valid. |
| A person's MCP token | `update public.mcp_tokens set revoked_at = now() where ...`, then issue a new token (`supabase/README.md`). | Takes effect on the next request. |
| `MCP_TOKEN` (demo) | Set a new value, redeploy, update the connector in Claude. | The old token stops working. |
| `DEMO_COOKIE_SECRET` (demo) | Set a new value, redeploy. | Everyone in the demo picks a role again. |
| Database password | Reset it in the Supabase project settings. The app does not use it; update it wherever backups or `psql` do. | None for the app. |

Rotate at once if a key was pasted somewhere it should not be, if someone who held it leaves, or if `npm run check:bundle` ever reports a secret in the bundle. Otherwise on the schedule the court sets.

## Turning demo mode off

There is no switch. The mode follows the environment:

- Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set: Supabase mode. The role picker is gone and the three `/api/demo/*` routes answer 404.
- Neither set: demo mode.
- Only one set: the server stops at startup and says so.

To move a demo deployment to Supabase: complete part B, add the two variables for the Production environment, remove `DEMO_COOKIE_SECRET`, `ALLOW_DEMO` and `MCP_TOKEN`, redeploy, and run the checks in step 8. The "Prototype. All data is made up." flag disappears in Supabase mode, so do not seed sample data into a project that people will take for real.

To make sure a production deployment can never fall back to demo mode by accident (for example if the Supabase variables are deleted): leave `DEMO_COOKIE_SECRET` and `ALLOW_DEMO` unset. A production server with no Supabase settings and neither of those refuses to start.
