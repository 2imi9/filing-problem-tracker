import { HttpError, handle } from "@/server/http";
import { handleMcpRequest } from "@/server/mcp/server";
import { bearerToken, mcpEnabled, resolveMcpToken } from "@/server/mcp/tokens";
import { enforceRateLimit } from "@/server/ratelimit";
import { noteRequestUser } from "@/server/requestContext";

// The MCP endpoint: read-only aggregate tools over Streamable HTTP, for use from inside Claude.
// It is called by other programs with a bearer token, not by the app's own pages, so there is no cookie
// and no Origin check. Only POST is offered: the server keeps no session and opens no event stream.
export const POST = handle(
  async ({ request }) => {
    if (!mcpEnabled()) throw new HttpError(404, "Not found.");

    const token = bearerToken(request);
    const user = token ? await resolveMcpToken(token) : null;
    if (!user) {
      throw new HttpError(401, "Send a valid token as Authorization: Bearer <token>.", {
        headers: { "WWW-Authenticate": 'Bearer realm="filing-problem-tracker"' },
      });
    }
    noteRequestUser(user.id);
    // Its own allowance per token holder, the same size as the one for changes made in the app.
    await enforceRateLimit(`mcp:${user.id}`, "mutation");
    return handleMcpRequest(request, user);
  },
  { checkOrigin: false },
);
