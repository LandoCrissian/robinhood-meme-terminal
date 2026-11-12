import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { readBoundedJsonRequest } from "../../lib/server/media-request-guard";
import { createLaunchpadMcpServer } from "../../lib/server/new-launchpad-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
const maximumRequestBytes = 8 * 1024;
const requestWindowMs = 60_000;
const requestsPerWindow = 120;
let requestCount = 0;
let windowEndsAt = 0;

function error(status: number, code: number, message: string, extra?: Record<string, string>) {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { ...headers, ...extra } });
}

function requestBoundary(request: Request) {
  const url = new URL(request.url);
  if (process.env.VERCEL_ENV || url.protocol !== "http:" || !loopbackHosts.has(url.hostname)) {
    return error(404, -32000, "MCP is available only on the local preview.");
  }
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== url.origin) || (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")) {
    return error(403, -32000, "Origin is forbidden.");
  }

  // Protocol requests use one bounded in-process counter. Data tools also use
  // the launchpad domain's shared quotas.
  const now = Date.now();
  if (now >= windowEndsAt) {
    windowEndsAt = now + requestWindowMs;
    requestCount = 0;
  }
  if (requestCount >= requestsPerWindow) {
    const retryAfter = Math.max(1, Math.ceil((windowEndsAt - now) / 1000));
    return error(429, -32000, "Request limit reached.", { "Retry-After": String(retryAfter) });
  }
  requestCount += 1;
  return null;
}

export async function POST(request: Request) {
  const blocked = requestBoundary(request);
  if (blocked) return blocked;
  const body = await readBoundedJsonRequest(request, maximumRequestBytes);
  if (!body.ok) return error(body.status, -32700, body.error);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return error(400, -32600, "Send one JSON-RPC message per request.");
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createLaunchpadMcpServer();
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody: body.value });
    const responseHeaders = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } finally {
    await server.close();
  }
}

export function GET(request: Request) {
  return requestBoundary(request) ?? error(405, -32000, "Server event streams are unavailable.", { Allow: "POST" });
}

export function DELETE(request: Request) {
  return requestBoundary(request) ?? error(405, -32000, "This endpoint has no sessions.", { Allow: "POST" });
}

export function OPTIONS(request: Request) {
  return requestBoundary(request) ?? error(405, -32000, "Only JSON-RPC POST is available.", { Allow: "POST" });
}
