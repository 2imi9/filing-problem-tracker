# Contract: AI features

The app calls the Claude API in three places. The model is one configuration value (`AI_MODEL`, default `claude-fable-5-2`). The rule behind all three is constitution principle III: the model chooses and words things, the code computes and checks.

Rules that apply to this model: do not send `thinking`, `temperature`, `top_p` or `budget_tokens`; forced `tool_choice` (`any` / `tool`) is rejected, so use `auto` plus `strict: true` tools or structured outputs; no assistant prefill; always check `stop_reason` before reading content; enable server-side `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`; set `output_config.effort` explicitly (`low` for classify and compose, `medium` for summary).

1. **Classify** imported rejection reasons. Structured output: for each row id, zero or more tags from the fixed list plus `confidence: high | medium | low`. Anything unknown, empty, malformed or low confidence becomes Needs review. Reasons that fail the PII check are never sent to the model. Batches of up to 100 rows.
2. **Summary** for court leaders. Input is aggregates only. System prompt: describe only the numbers provided, invent nothing, no legal advice, no advice to filers, say "the sample data shows" in demo mode. After generation the server checks that every number in the text appears in the supplied aggregates; if not, the summary is discarded and the UI shows "Summary unavailable".
3. **Compose** the workspace. One tool per panel type with a strict JSON schema, plus the reference lists in the system prompt. Claude only chooses panel types, filters and short titles. It never writes numbers; `computePanel` does. Every tool call is validated with the `PanelSpec` schema; invalid calls are dropped. Max 6 panels per request. If nothing valid comes back, the keyword fallback runs.

**Local classify (prototype).** Classify can run on a decision model on the same computer in place of the Claude API: OpenJev Flash 9B, served at `POST /v1/systemone`. Keyword rules run first. Each row they cannot sort is one Choice question whose options are the fixed list plus "None of these". An answer is kept only if it is on the list and its confidence is at least 0.6; anything else stays Needs review. The page says which rows the model sorted ("OpenJev (AI)") and states in its footer where AI is and is not used. The page looks for the model only where it is served at the same address as the model: `localhost` (`scripts/serve-local.py`) or a Hugging Face Space (`space/server.py`). The static site never calls it. On `localhost` no reason text leaves the machine; on a Space it goes to that Space, so use made-up data there.

Without `ANTHROPIC_API_KEY` every feature uses its fallback: keyword rules for classify, "Summary unavailable" for summary, keyword-to-filter matching for compose. The app is fully usable with no key.

Privacy line: the model sees (a) rejection reasons that passed the PII check and (b) aggregate counts. It never sees notes, user identities, or row-level data beyond the reason text. Nothing AI-generated is shown to litigants; there is no litigant-facing surface.

Rate limits: 20 AI requests per user per minute, 60 mutations per user per minute. 429 with `Retry-After`.
