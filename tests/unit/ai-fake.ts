// A stand-in for the Anthropic SDK client, for tests of the AI features. Nothing here touches the network.

import type Anthropic from "@anthropic-ai/sdk";
import type { AiClient } from "@/server/ai/client";
import { AI_MODEL } from "@/server/config";

type BetaMessage = Anthropic.Beta.BetaMessage;
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

export interface FakeReply {
  /** Text the model "wrote". */
  text?: string;
  /** Tool calls the model "made". */
  toolCalls?: { name: string; input: unknown }[];
  /** Defaults to "tool_use" when there are tool calls and "end_turn" otherwise. */
  stopReason?: BetaMessage["stop_reason"];
  /** The model that served the reply. Defaults to the configured one. */
  model?: string;
  /** Extra content blocks placed before the text, for example a thinking block. */
  leadingBlocks?: unknown[];
}

/** Builds a reply in the shape the API returns. Only the fields the app reads are meaningful. */
export function fakeMessage(reply: FakeReply): BetaMessage {
  const toolCalls = reply.toolCalls ?? [];
  const content: unknown[] = [...(reply.leadingBlocks ?? [])];
  if (reply.text !== undefined) content.push({ type: "text", text: reply.text, citations: null });
  toolCalls.forEach((call, index) => content.push({ type: "tool_use", id: `toolu_${index}`, name: call.name, input: call.input }));
  const message = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: reply.model ?? AI_MODEL,
    content,
    // An explicit null is kept: the API can send one.
    stop_reason: reply.stopReason !== undefined ? reply.stopReason : toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  };
  // The SDK's message type has more fields than the app reads; the cast keeps the fake small.
  return message as unknown as BetaMessage;
}

export interface FakeCall {
  params: CreateParams;
  options: Anthropic.RequestOptions | undefined;
}

export interface FakeClient extends AiClient {
  /** Every request the app made, in order. */
  calls: FakeCall[];
}

/**
 * A client whose `create` answers with what `respond` returns. `respond` gets the request and may throw
 * to act as a failed call.
 */
export function fakeClient(respond: (params: CreateParams, callIndex: number) => FakeReply | BetaMessage): FakeClient {
  const calls: FakeCall[] = [];
  return {
    calls,
    beta: {
      messages: {
        async create(params, options) {
          calls.push({ params, options });
          const reply = respond(params, calls.length - 1);
          return "role" in reply ? reply : fakeMessage(reply);
        },
      },
    },
  };
}

/** The text of the user turn of a request. */
export function userText(params: CreateParams): string {
  const content = params.messages[0]?.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** The text of the system prompt of a request. */
export function systemText(params: CreateParams): string {
  const system = params.system;
  if (typeof system === "string") return system;
  return (system ?? []).map((block) => block.text).join("\n");
}

/** The JSON held in a named data block of a prompt, parsed. */
export function blockJson(text: string, name: string): unknown {
  const match = new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(text);
  if (!match) throw new Error(`No <${name}> block in the prompt.`);
  return JSON.parse(match[1]);
}
