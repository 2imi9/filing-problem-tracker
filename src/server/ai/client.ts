import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, ANTHROPIC_API_KEY } from "../config";
import { currentRequestId } from "../requestContext";

// The one place the app talks to the Claude API. Every AI feature goes through callClaude, which owns
// the model, the refusal fallback, the timeout, the stop_reason check and the error handling, and
// answers with a result instead of throwing, so each feature can fall back to its non-AI path.
//
// What is logged per call: sizes, model, stop reason, token usage and the choices the caller names.
// Prompt text and model output are never logged.

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaTool = Anthropic.Beta.BetaTool;
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

/** Lets a declined request be re-run on the model Anthropic recommends for it, inside the same call. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The part of the SDK client the app uses. Tests pass a stand-in with the same shape. */
export interface AiClient {
  beta: {
    messages: {
      create(params: CreateParams, options?: Anthropic.RequestOptions): PromiseLike<BetaMessage>;
    };
  };
}

export type AiFeature = "classify" | "summary" | "compose";

export type AiFailureReason =
  /** No API key is configured. */
  | "disabled"
  /** The model, and any fallback model, declined the request. */
  | "refusal"
  /** The reply was cut off at the token limit, so it cannot be trusted to be complete. */
  | "max_tokens"
  /** The reply ended for a reason this app never asks for (a paused turn, a full context window). */
  | "unexpected_stop"
  | "timeout"
  | "aborted"
  | "connection"
  | "auth"
  | "rate_limited"
  | "overloaded"
  | "bad_request"
  | "api_error"
  | "unknown";

export type LogDetail = Record<string, string | number | boolean | null>;

export interface ClaudeCall {
  feature: AiFeature;
  /** Stable instructions. Sent as a cacheable block, so keep anything that varies out of it. */
  system: string;
  /** The user turn: the data for this one request. */
  user: string;
  effort: "low" | "medium";
  /** A hard limit on the whole reply, thinking included. */
  maxTokens: number;
  timeoutMs: number;
  /** Strict tools the model may call. It decides whether to call any (tool choice is auto). */
  tools?: BetaTool[];
  /** A JSON schema the reply text must follow. */
  format?: Anthropic.Beta.BetaJSONOutputFormat;
  signal?: AbortSignal;
  /** Counts and choices worth logging. Never prompt text. */
  logDetail?: LogDetail;
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export type ClaudeResult =
  | {
      ok: true;
      /** The reply's text blocks, joined. */
      text: string;
      /** The tool calls the model made, in order. */
      toolCalls: ToolCall[];
      /** The model that wrote the reply. It differs from the configured one when a fallback served it. */
      model: string;
    }
  | { ok: false; reason: AiFailureReason };

let sharedClient: AiClient | null | undefined;

/** The shared SDK client, or null when no API key is configured. */
export function getAiClient(): AiClient | null {
  if (sharedClient === undefined) {
    sharedClient = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 1 }) : null;
  }
  return sharedClient;
}

function failureReason(error: unknown): AiFailureReason {
  // Most specific first: several of these classes extend one another.
  if (error instanceof Anthropic.APIUserAbortError) return "aborted";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.APIConnectionError) return "connection";
  if (error instanceof Anthropic.AuthenticationError) return "auth";
  if (error instanceof Anthropic.PermissionDeniedError) return "auth";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (error instanceof Anthropic.RequestTimeoutError) return "timeout";
  if (error instanceof Anthropic.BadRequestError) return "bad_request";
  if (error instanceof Anthropic.OverloadedError) return "overloaded";
  if (error instanceof Anthropic.GatewayTimeoutError) return "timeout";
  if (error instanceof Anthropic.InternalServerError) return "api_error";
  if (error instanceof Anthropic.APIError) return "api_error";
  return "unknown";
}

function logCall(call: ClaudeCall, started: number, outcome: Record<string, unknown>): void {
  const line = {
    event: "ai_call",
    requestId: currentRequestId(),
    feature: call.feature,
    model: AI_MODEL,
    effort: call.effort,
    systemChars: call.system.length,
    userChars: call.user.length,
    tools: call.tools?.length ?? 0,
    ms: Math.round(performance.now() - started),
    ...call.logDetail,
    ...outcome,
  };
  if (outcome.ok === true) console.log(JSON.stringify(line));
  else console.warn(JSON.stringify(line));
}

/**
 * Sends one request to Claude and reads the reply.
 * Never throws for anything the API or the network does: the result says what went wrong and the caller
 * uses its fallback. `client` defaults to the shared one; pass null to act as if AI were switched off.
 */
export async function callClaude(call: ClaudeCall, client: AiClient | null = getAiClient()): Promise<ClaudeResult> {
  if (!client) return { ok: false, reason: "disabled" };
  const started = performance.now();

  const params: CreateParams = {
    model: AI_MODEL,
    max_tokens: call.maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.user }],
    output_config: call.format ? { effort: call.effort, format: call.format } : { effort: call.effort },
  };
  if (call.tools && call.tools.length > 0) {
    params.tools = call.tools;
    params.tool_choice = { type: "auto" };
  }

  let message: BetaMessage;
  try {
    message = await client.beta.messages.create(params, { timeout: call.timeoutMs, maxRetries: 1, signal: call.signal });
  } catch (error) {
    const reason = failureReason(error);
    logCall(call, started, {
      ok: false,
      reason,
      errorName: error instanceof Error ? error.name : "unknown",
      status: error instanceof Anthropic.APIError ? (error.status ?? null) : null,
      errorType: error instanceof Anthropic.APIError ? error.type : null,
      apiRequestId: error instanceof Anthropic.APIError ? (error.requestID ?? null) : null,
    });
    return { ok: false, reason };
  }

  const outcome = {
    servedBy: message.model,
    stopReason: message.stop_reason,
    fallbackRan: (message.usage.iterations ?? []).some((entry) => entry.type === "fallback_message"),
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
    },
  };

  // The stop reason is checked before any content is read. A refused reply has empty or partial content,
  // and a reply cut off at the limit can hold a tool call or JSON that parses but is incomplete.
  let reason: AiFailureReason | null = null;
  if (message.stop_reason === "refusal") reason = "refusal";
  else if (message.stop_reason === "max_tokens") reason = "max_tokens";
  else if (message.stop_reason !== "end_turn" && message.stop_reason !== "tool_use") reason = "unexpected_stop";
  if (reason) {
    logCall(call, started, { ok: false, reason, refusalCategory: message.stop_details?.category ?? null, ...outcome });
    return { ok: false, reason };
  }

  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") toolCalls.push({ name: block.name, input: block.input });
  }
  logCall(call, started, { ok: true, toolCalls: toolCalls.length, textChars: text.length, ...outcome });
  return { ok: true, text, toolCalls, model: message.model };
}
