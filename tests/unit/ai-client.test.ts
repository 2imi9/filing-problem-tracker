import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callClaude, getAiClient } from "@/server/ai/client";
import type { ClaudeCall } from "@/server/ai/client";
import { AI_MODEL } from "@/server/config";
import { fakeClient, systemText, userText } from "./ai-fake";

// The model the app asks for is read from the config (AI_MODEL), so changing the default there does not
// break these tests. OTHER_MODEL is a made-up id for "a different model served this reply", which is
// what a fallback looks like. It only has to differ from the configured one.
const OTHER_MODEL = "another-model-id-for-tests";

const SECRET_SYSTEM = "SYSTEM-PROMPT-TEXT-that-must-not-be-logged";
const SECRET_USER = "USER-TURN-TEXT-that-must-not-be-logged";

const call = (overrides: Partial<ClaudeCall> = {}): ClaudeCall => ({
  feature: "summary",
  system: SECRET_SYSTEM,
  user: SECRET_USER,
  effort: "medium",
  maxTokens: 1234,
  timeoutMs: 30_000,
  ...overrides,
});

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const logged = () => [...log.mock.calls, ...warn.mock.calls].map((args) => String(args[0]));

describe("getAiClient", () => {
  it("is null when no API key is configured", () => {
    expect(getAiClient()).toBeNull();
  });
});

describe("callClaude: the request", () => {
  it("answers 'disabled' without a client and sends nothing", async () => {
    expect(await callClaude(call(), null)).toEqual({ ok: false, reason: "disabled" });
    expect(logged()).toEqual([]);
  });

  it("sends the configured model, the refusal fallback, an explicit effort and a cacheable system prompt", async () => {
    const client = fakeClient(() => ({ text: "ok" }));
    await callClaude(call(), client);
    const { params, options } = client.calls[0];
    expect(params.model).toBe(AI_MODEL);
    expect(params.max_tokens).toBe(1234);
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params.system).toEqual([{ type: "text", text: SECRET_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(params.messages).toEqual([{ role: "user", content: SECRET_USER }]);
    expect(options).toMatchObject({ timeout: 30_000, maxRetries: 1 });
  });

  it("never sends thinking, sampling settings, a forced tool choice or an assistant prefill", async () => {
    const client = fakeClient(() => ({ text: "ok" }));
    await callClaude(call(), client);
    await callClaude(call({ tools: [{ name: "t", strict: true, input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } }] }), client);
    for (const { params } of client.calls) {
      for (const banned of ["thinking", "temperature", "top_p", "top_k", "budget_tokens", "stream"]) expect(params).not.toHaveProperty(banned);
      expect(params.messages.every((message) => message.role === "user")).toBe(true);
    }
    expect(client.calls[0].params).not.toHaveProperty("tools");
    expect(client.calls[0].params).not.toHaveProperty("tool_choice");
    expect(client.calls[1].params.tool_choice).toEqual({ type: "auto" });
    expect(client.calls[1].params.tools).toHaveLength(1);
  });

  it("puts a JSON format next to the effort when one is given", async () => {
    const client = fakeClient(() => ({ text: "{}" }));
    const format = { type: "json_schema" as const, schema: { type: "object", properties: {}, additionalProperties: false } };
    await callClaude(call({ effort: "low", format }), client);
    expect(client.calls[0].params.output_config).toEqual({ effort: "low", format });
  });

  it("passes the caller's abort signal through", async () => {
    const client = fakeClient(() => ({ text: "ok" }));
    const controller = new AbortController();
    await callClaude(call({ signal: controller.signal }), client);
    expect(client.calls[0].options?.signal).toBe(controller.signal);
  });
});

describe("callClaude: reading the reply", () => {
  it("joins the text blocks and lists the tool calls, skipping thinking and fallback blocks", async () => {
    const client = fakeClient(() => ({
      leadingBlocks: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "fallback", from: { model: AI_MODEL }, to: { model: OTHER_MODEL } },
      ],
      text: "Hello.",
      toolCalls: [
        { name: "open_kpi_panel", input: { title: "" } },
        { name: "open_forms_panel", input: { title: "Forms" } },
      ],
      model: OTHER_MODEL,
    }));
    expect(await callClaude(call(), client)).toEqual({
      ok: true,
      text: "Hello.",
      toolCalls: [
        { name: "open_kpi_panel", input: { title: "" } },
        { name: "open_forms_panel", input: { title: "Forms" } },
      ],
      model: OTHER_MODEL,
    });
  });

  it("treats a refusal as a failure and does not read its partial content", async () => {
    const client = fakeClient(() => ({ text: "Partial text that must not be used", stopReason: "refusal" }));
    expect(await callClaude(call(), client)).toEqual({ ok: false, reason: "refusal" });
  });

  it("treats a reply cut off at the token limit as a failure, even when it holds a tool call", async () => {
    const client = fakeClient(() => ({ toolCalls: [{ name: "open_kpi_panel", input: { title: "cut" } }], stopReason: "max_tokens" }));
    expect(await callClaude(call(), client)).toEqual({ ok: false, reason: "max_tokens" });
  });

  it.each(["pause_turn", "model_context_window_exceeded", "stop_sequence", null] as const)("treats stop reason %s as a failure", async (stopReason) => {
    const client = fakeClient(() => ({ text: "x", stopReason }));
    expect(await callClaude(call(), client)).toEqual({ ok: false, reason: "unexpected_stop" });
  });
});

describe("callClaude: failures", () => {
  const headers = new Headers();
  const failures: [string, () => unknown, string][] = [
    ["a rate limit", () => new Anthropic.RateLimitError(429, { type: "error" }, "slow down", headers), "rate_limited"],
    ["a rejected key", () => new Anthropic.AuthenticationError(401, { type: "error" }, "bad key", headers), "auth"],
    ["a permission error", () => new Anthropic.PermissionDeniedError(403, { type: "error" }, "no", headers), "auth"],
    ["a bad request", () => new Anthropic.BadRequestError(400, { type: "error" }, "bad", headers), "bad_request"],
    ["an overloaded service", () => new Anthropic.OverloadedError(529, { type: "error" }, "busy", headers), "overloaded"],
    ["a server error", () => new Anthropic.InternalServerError(500, { type: "error" }, "oops", headers), "api_error"],
    ["a gateway timeout", () => new Anthropic.GatewayTimeoutError(504, { type: "error" }, "late", headers), "timeout"],
    ["a request timeout", () => new Anthropic.APIConnectionTimeoutError(), "timeout"],
    ["a dropped connection", () => new Anthropic.APIConnectionError({ message: "reset" }), "connection"],
    ["an aborted request", () => new Anthropic.APIUserAbortError(), "aborted"],
    ["another API error", () => new Anthropic.NotFoundError(404, { type: "error" }, "no model", headers), "api_error"],
    ["an error from somewhere else", () => new TypeError("boom"), "unknown"],
  ];

  it.each(failures)("maps %s to its reason and does not throw", async (_name, makeError, reason) => {
    const client = fakeClient(() => {
      throw makeError();
    });
    expect(await callClaude(call(), client)).toEqual({ ok: false, reason });
  });
});

describe("callClaude: logging", () => {
  it("logs sizes, model, stop reason and usage, and never the prompt or the reply", async () => {
    const client = fakeClient(() => ({ text: "REPLY-TEXT-that-must-not-be-logged" }));
    await callClaude(call({ logDetail: { scope: "All counties" } }), client);
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET_SYSTEM);
    expect(lines[0]).not.toContain(SECRET_USER);
    expect(lines[0]).not.toContain("REPLY-TEXT");
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "ai_call",
      feature: "summary",
      model: AI_MODEL,
      effort: "medium",
      systemChars: SECRET_SYSTEM.length,
      userChars: SECRET_USER.length,
      ok: true,
      stopReason: "end_turn",
      servedBy: AI_MODEL,
      scope: "All counties",
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  });

  it("logs a failure with the error class and status, not its message", async () => {
    const client = fakeClient(() => {
      throw new Anthropic.BadRequestError(400, { type: "error" }, `echo of ${SECRET_USER}`, new Headers());
    });
    await callClaude(call(), client);
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET_USER);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "ai_call", ok: false, reason: "bad_request", status: 400 });
  });

  it("the fake's prompt readers see what was sent", async () => {
    const client = fakeClient(() => ({ text: "ok" }));
    await callClaude(call(), client);
    expect(systemText(client.calls[0].params)).toBe(SECRET_SYSTEM);
    expect(userText(client.calls[0].params)).toBe(SECRET_USER);
  });
});
