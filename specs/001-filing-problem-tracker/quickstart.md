# Quickstart: Filing Problem Tracker

## Run the app

Node 22 and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000 and choose a demo role. With no settings the app runs in demo mode: 900 made-up filings kept in memory, AI off. No accounts, database or keys are needed, and the data resets when the server restarts.

The single-file demo behind the live link is separate: `sh scripts/build-site.sh` writes `site/index.html`, and `render.yaml` publishes it as a static site.

## Check it works

1. Sign in as Clerk, Marion County. On Tag a filing, choose a case type and a form, tick two problems, choose an outcome and save. The entry appears in Recent entries, and Undo removes it.
2. Type a phone number in the note. The form warns and refuses to save.
3. On Import, fill in the made-up example and sort it. The preview shows 10 rows, one marked "Needs review". Add the rows.
4. Sign in as Court leader. The dashboard total includes the new rows, changing the county filter changes every panel, and no note is shown anywhere.
5. In Before and after a change, pick a change. It compares full months before and after.
6. On Workspace, type a request such as "Missing signatures in Marion small claims". Panels open with AI off, and a set of panels can be saved as a folder and reopened.
7. `GET /api/health` answers `{"ok":true,"mode":"demo","ai":false,...}`.

## Run the checks

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates route types, then `tsc --noEmit` |
| `npm run test:unit` | Unit tests |
| `npm run test:rls` | The SQL access rules, run against Postgres in memory (PGlite) |
| `npm run build` | Production build |
| `npm run check:bundle` | Fails if a secret or server code is in the browser bundle. Needs a build. |
| `npm run test:e2e` | Browser and accessibility tests against a production build in demo mode on port 3100 |
| `npm run verify` | All of the above, in that order. CI runs the same steps. |

The browser tests need Chromium (`npx playwright install chromium`). `E2E_SKIP_BUILD=1` serves the build already in `.next`, and `E2E_PORT` changes the port.

## Settings

Copy `.env.example` to `.env.local`. Every setting is optional; an empty value counts as not set. Only the two `NEXT_PUBLIC_` values reach the browser.

| Setting | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Set both for Supabase mode, neither for demo mode. One alone stops the server at startup. Rebuild after changing them. |
| `DEMO_COOKIE_SECRET` | Signs the demo sign-in cookie. At least 32 characters. A production start in demo mode needs this or `ALLOW_DEMO=1`. |
| `ALLOW_DEMO` | `1` confirms that a production start in demo mode is intended. |
| `DEMO_RESET_CLEARS_LIMITS` | `1` makes a demo reset also clear rate limits. For a throwaway test server only. |
| `ANTHROPIC_API_KEY` | Turns the AI features on. Without it every feature uses its fallback. |
| `AI_MODEL` | Overrides the default model id, `claude-fable-5-2`. |
| `MCP_TOKEN` | Demo mode: the bearer token for `POST /api/mcp`, at least 24 characters. Unset, the endpoint answers 404. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase mode: needed only for the MCP endpoint. It bypasses row level security, so leave it unset unless the endpoint is used. |
| `APP_ORIGIN` | The app's own address. When set, state-changing requests must carry exactly this origin. |
| `TRUSTED_PROXY_HOPS` | How many proxies in front of the app can be believed for the caller's address: 0 when reached directly, 1 behind one proxy. At 0 all sign-in attempts share one limit. |
| `RATE_LIMIT_MUTATIONS_PER_MINUTE`, `RATE_LIMIT_AI_PER_MINUTE` | Per person. Defaults 60 and 20. |

## Supabase mode

These steps come from the code and have not been carried out on a hosted Supabase project.

1. Create a Supabase project and apply the three migrations in `supabase/migrations` as the project owner (`supabase link`, then `supabase db push`). `supabase/seed.sql` adds the sample filings if you want them; never mix them with real records.
2. In the project's sign-in settings, turn sign-ups and anonymous sign-ins off, set the site URL to the app's address, add `<app address>/api/auth/callback` as a redirect URL, and use the email templates in `supabase/templates`. `supabase/config.toml` shows the values used locally.
3. Set the two `NEXT_PUBLIC_SUPABASE_` settings and `APP_ORIGIN`, then build and start the app. `GET /api/health` answers `"mode":"supabase"`, and `POST /api/demo/login` answers 404.
4. Nobody has access until a row in `profiles` says so. Invite the person in Supabase Auth, then add the row in the SQL editor. A clerk has a county; a leader or admin has none. Deleting the row removes access.

   ```sql
   insert into public.profiles (user_id, role, county)
   select id, 'clerk', 'Marion' from auth.users where email = 'new.clerk@example.gov';
   ```

5. To let a person use the MCP endpoint, set `SUPABASE_SERVICE_ROLE_KEY` and store the hash of a long random token in the SQL editor. Revoke it by setting `revoked_at`.

   ```sql
   insert into public.mcp_tokens (token_hash, user_id, label)
   select encode(sha256(convert_to('<the token>', 'UTF8')), 'hex'), id, 'Leader laptop'
   from auth.users where email = 'leader@example.gov';
   ```

## Deploy

- Any host that runs a Next.js server on Node 22: `npm run build`, then `npm run start`. A configuration error stops the server at startup with a line that begins `Configuration error:`.
- A public demo needs `DEMO_COOKIE_SECRET` or `ALLOW_DEMO=1`. Anyone who can reach it can sign in as an admin, so it must hold only the sample data. On a host that runs several instances, each has its own copy of the sample data and its own rate limits.
- The AI routes may run for up to 90 seconds; check that the host allows it.
- After changing a key, redeploy. Changing `DEMO_COOKIE_SECRET` signs everyone out of the demo.

## Run the demo page with a local model (optional)

Needs an Apple silicon Mac with 16 GB of memory. The first run downloads about 9.5 GB.

```bash
sh scripts/start-openjev.sh       # terminal 1: OpenJev Flash 9B on 127.0.0.1:3000
python3 scripts/serve-local.py    # terminal 2: the tracker on http://localhost:8080
```

The Import tab says whether the model is ready. Rows the keyword rules cannot sort go to the model and come back marked "OpenJev (AI)" with a reason, or "OpenJev (AI) was not sure" if it left them for review. On Tag a filing, type a note such as "petition only talks about being followed home last week": a few seconds after you stop typing, "AI suggests" appears with a reason and Accept and Change buttons. Stop terminal 1 and Import falls back to the rules alone. For a Mac with less memory, start the model with `OPENJEV_MODEL=openjev/OpenJev-Flash-9B-MLX-4bit` (about 5 GB).

## Run the demo page on a Hugging Face Space (optional)

One free Docker Space serves the page and the model together (the 5.6 GB build on llama.cpp, no GPU, so each leftover row takes a while).

```bash
sh scripts/build-space.sh   # collects six files into space-build/
```

Create a Space with the Docker SDK and upload the six files. The first build downloads the model.
