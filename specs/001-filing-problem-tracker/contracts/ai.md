# Contract: AI features

The app calls the Claude API in three places, all through `callClaude` in `src/server/ai/client.ts`. The model is one setting (`AI_MODEL`, default `claude-fable-5-2`). The rule behind all three is constitution principle III: the model chooses and words things, the code computes and checks.

How every request is built: no `thinking`, `temperature`, `top_p` or `budget_tokens`; tools use `tool_choice: auto` with strict schemas, or the reply uses a structured output format; no assistant prefill; `stop_reason` is checked before the content is read; server-side `fallbacks: "default"` with the beta `server-side-fallback-2026-07-01`; `output_config.effort` is set every time (`low` for classify and compose, `medium` for summary).

1. **Classify** imported rejection reasons. Structured output: for each row id, zero or more problems from the fixed list plus `confidence: high | medium | low`. Anything unknown, empty, malformed or low confidence becomes "Needs review". Each distinct wording is sent once, in batches of up to 40. Reasons that fail the personal-data check are never sent, and the keyword rules answer for any row the model does not.
2. **Summary** for court leaders. The input is counts worked out on the server, nothing else. The system prompt says: describe only the numbers given, invent nothing, no legal advice, no advice to filers, and begin with "The sample data shows" in demo mode. The server then discards the summary if it contains a number that was not in its input, reads as advice, or (in demo mode) does not say the numbers are sample data. The page shows "Summary unavailable".
3. **Compose** the workspace. One tool per panel type with a strict JSON schema, plus the reference lists in the system prompt. The model only chooses panel types, filters and short titles. It never writes a number; `computePanel` does. Every tool call is validated with the `PanelSpec` schema and dropped if it fails. At most 6 panels per request. A request that looks like it holds personal data is not sent, and if nothing valid comes back the keyword matcher answers.

Without `ANTHROPIC_API_KEY` every feature uses its fallback: keyword rules for classify, "Summary unavailable" for summary, keyword matching for compose. The app is fully usable with no key.

## What the model sees

| Feature | Sent | Never sent |
|---|---|---|
| Classify | Reason text that passed the personal-data check, and the list of problems | Notes, refused reasons, county, date, form, who imported it |
| Summary | Counts and percentages, the filters in words, today's date and, when a recorded change is picked, its name, date, county, case type and before and after averages | Any single filing, notes, reasons, who is asking |
| Compose | The typed request, today's date, the recorded changes, the order of counties by volume, and the reference lists | Any filing, any count, notes, reasons |

Text from people is placed in the prompt as marked data with angle brackets escaped. The name of a recorded change is written by an admin and is sent as typed. Nothing the model writes is shown to litigants; there is no litigant-facing page. The server logs sizes, the model id, the stop reason and token counts for each call, never prompts or replies.

Rate limit: 20 AI requests per person per minute by default; over it, 429 with `Retry-After`.
