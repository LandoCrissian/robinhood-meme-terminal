import { isLaunchAddress, type LaunchDirectoryData } from "../launch-data";
import { indexedFreshnessMs, readLaunchDirectory } from "./launch-data";

const clientCache = "private, no-store";
const maxEdgeSeconds = 15;

function edgeLifetime(data: LaunchDirectoryData, now: number): number {
  if (data.coverage === "verified-snapshot") return maxEdgeSeconds;
  if (data.status !== "ready" || !data.checkpoint) return 0;
  // Leave a buffer for upstream response time and CDN clock skew.
  const freshMs = indexedFreshnessMs + Date.parse(data.checkpoint.timestamp) - now - 5_000;
  return Math.max(0, Math.min(maxEdgeSeconds, Math.floor(freshMs / 1_000)));
}

export function createLaunchHistoryHandler(read = readLaunchDirectory, now = Date.now) {
  return async function respondWithLaunchHistory(request: Request, token?: string) {
    const headers = new Headers({
      "Cache-Control": clientCache,
      "Netlify-CDN-Cache-Control": "no-store",
      "Netlify-Vary": "query",
    });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "method_not_allowed" }, { status: 405, headers });
    }
    if (new URL(request.url).search || (token !== undefined && !isLaunchAddress(token))) {
      return Response.json({ error: "invalid_launch_history_request" }, { status: 400, headers });
    }
    const data = await read(token);
    const status = data.status === "unavailable" ? 503 : token && !data.launches.length ? 404 : 200;
    if (status === 200 && request.method === "GET" && (!token || token === token.toLowerCase())) {
      const lifetime = edgeLifetime(data, now());
      if (lifetime > 0) headers.set("Netlify-CDN-Cache-Control", "public, durable, s-maxage=" + lifetime + ", must-revalidate");
    }
    return request.method === "HEAD"
      ? new Response(null, { status, headers })
      : Response.json(data, { status, headers });
  };
}

export const respondWithLaunchHistory = createLaunchHistoryHandler();
