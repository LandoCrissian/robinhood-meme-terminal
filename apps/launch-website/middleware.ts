import { NextResponse, type NextRequest } from "next/server";
import { isLaunchAddress } from "./lib/launch-data";
import { creationReviewPath } from "./lib/launch-draft";

const publicRoutes = new Set([
  "/", "/create-token", "/my-launches", "/wallet", "/rmt",
  "/terms", "/risks", "/privacy", "/robots.txt", "/api/launchpad/config",
  "/api/launchpad/launches",
]);

function isStaticAsset(path: string) {
  const prefix = "/_next/static/";
  if (!path.startsWith(prefix)) return false;
  try {
    return path.slice(prefix.length).split("/").every((part) => {
      const segment = decodeURIComponent(part);
      return /^[\w.@()\[\]-]+$/.test(segment) && segment !== "." && segment !== "..";
    });
  } catch {
    return false;
  }
}

function isLaunchDetail(path: string) {
  const match = /^\/(?:api\/launchpad\/)?launches\/([^/]+)$/.exec(path);
  return match !== null && isLaunchAddress(match[1]);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Each local-only handler repeats its full manifest, host and origin checks.
  if ((pathname === "/api/launchpad/test-creation" && request.method === "POST") ||
      (/^\/api\/launchpad\/new-engine(?:\/0[xX][0-9A-Fa-f]{40})?$/.test(pathname) &&
        (request.method === "GET" || request.method === "HEAD"))) return NextResponse.next();
  if (request.method === "POST" && pathname === creationReviewPath) return NextResponse.next();
  if ((request.method === "GET" || request.method === "HEAD")
      && (publicRoutes.has(pathname) || isLaunchDetail(pathname) || isStaticAsset(pathname))) {
    return NextResponse.next();
  }
  return new NextResponse(request.method === "HEAD" ? null : "Not Found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export const config = { matcher: ["/:path*"] };
