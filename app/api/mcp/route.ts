import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createHaggleMcpServer } from "@/lib/mcp/server";
import { publicOrigin } from "@/lib/origin";
import { RateLimitError, limit } from "@/lib/rate-limit";

/**
 * Model Context Protocol endpoint (Streamable HTTP, stateless).
 * Connect: claude mcp add --transport http haggle https://<host>/api/mcp
 */
async function handleMcp(req: Request) {
  try {
    limit(req, "mcp");
  } catch (err) {
    if (err instanceof RateLimitError) return Response.json({ error: err.message }, { status: 429 });
    throw err;
  }
  const baseUrl = publicOrigin(req);
  const server = createHaggleMcpServer(baseUrl);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handleMcp as GET, handleMcp as POST, handleMcp as DELETE };
