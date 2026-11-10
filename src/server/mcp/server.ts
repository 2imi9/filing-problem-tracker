import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SessionUser } from "@/lib/domain";
import { appToday } from "../clock";
import { APP_MODE } from "../config";
import { getRepository } from "../repo";
import { AGGREGATE_TOOLS } from "../tools";
import type { ToolContext } from "../tools";

// The MCP server behind /api/mcp: the read-only tools in tools.ts over Streamable HTTP.
//
// It is stateless. Each HTTP request gets its own server and transport, answers with plain JSON, and
// keeps nothing afterwards, so it works the same on one long-lived server and on short-lived workers.

/** MCP messages are small. A larger body is refused before it is parsed. */
const MAX_BODY_BYTES = 256 * 1024;

const INSTRUCTIONS = [
  "Read-only statistics from the Filing Problem Tracker for Indiana trial courts.",
  "When a filing from a person without a lawyer is rejected or sent back, a clerk tags what was wrong with it. These tools return counts of those tags by county, case type, form and month, and compare a problem before and after a change a court made.",
  "Call list_reference_values first to get the exact names the other tools accept.",
  "The tools return counts only. There are no names, case numbers, notes or individual filings to look up.",
  "The numbers say what was tagged, not why. Do not present them as legal advice or as advice to people filing in court.",
].join(" ");

/**
 * Answers one MCP request as `user`. The tools see what that user's repository returns and nothing else.
 */
export async function handleMcpRequest(request: Request, user: SessionUser): Promise<Response> {
  const server = new McpServer({ name: "filing-problem-tracker", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  // The data is read once, and only if a tool is actually called (initialize and tools/list need none).
  let loading: Promise<ToolContext> | undefined;
  const context = () =>
    (loading ??= (async () => {
      const repo = await getRepository(user);
      const [flags, events] = await Promise.all([repo.listFlags(), repo.listEvents()]);
      return { flags, events, viewerCounty: user.role === "clerk" ? user.county : null, todayIso: appToday(), mode: APP_MODE };
    })());

  for (const tool of AGGREGATE_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (input: unknown) => {
        const outcome = tool.call(input, await context());
        return outcome.ok
          ? { content: [{ type: "text" as const, text: JSON.stringify(outcome.result) }], structuredContent: outcome.result }
          : { content: [{ type: "text" as const, text: outcome.error }], isError: true };
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // With JSON responses the reply is complete by now, so the server can be let go.
    await server.close();
  }
}
