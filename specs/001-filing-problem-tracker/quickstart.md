# Quickstart

## Try the prototype now

No install. Open https://claude.ai/artifact/GKhX5hg1m8exSJxZkV5Ddk, or download [`docs/prototype/filing_tracker.html`](../../docs/prototype/filing_tracker.html) and open it. Tag a filing on the first tab, then open the dashboard tab to see it counted.

## Run the web app

The application code arrives by pull request. Once it is merged:

```bash
npm install
npm run dev
```

Open http://localhost:3000 and pick a role (clerk, leader or admin). With no settings at all the app runs in demo mode on made-up data, with the AI features using their rules-based fallbacks.

Optional settings, in `.env.local`:

| Setting | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on the AI features. |
| `AI_MODEL` | Which Claude model to use. |
| `MCP_TOKEN` | Turns on the Claude connector in demo mode. |
| Supabase URL and anon key | Switches to database mode with real sign-in. |

## Check it works

Walk the user stories in [spec.md](spec.md):

1. As a clerk, tag a filing with the keyboard. It appears in recent entries.
2. As a leader, open the dashboard. The total has gone up by one.
3. As a clerk, type a phone number into a note. Saving is refused.
4. Import the sample export, review the preview, commit.
5. In the workspace, type "signature problems in Marion small claims". Panels open. Save them as a folder.

Automated checks: `npm run lint`, `npm run typecheck`, `npm test`.
