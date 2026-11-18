import { NextResponse, type NextRequest } from "next/server";
import { isLaunchAddress } from "./lib/launch-data";
import { creationReviewPath } from "./lib/launch-draft";
import { isProfileApiRoute } from "./lib/server/profiles/config";
import { admitRailwayRequest, railwayHosting } from "./lib/server/railway-read-only";

const publicRoutes = new Set([
  "/", "/create-token", "/my-launches", "/wallet",
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
  if (process.env.RAILWAY_ENVIRONMENT_ID || process.env.RMT_WEB_HOSTING === "railway-read-only-v1") {
    const hosting = railwayHosting();
    if (!hosting) return new NextResponse("Read-only hosting configuration unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    // Railway's health probe uses its own Host, but receives only public liveness
    // or freshness status. Other routes bind the exact assigned preview origin.
    if (["/healthz", "/readyz"].includes(pathname) && ["GET", "HEAD"].includes(request.method)) return NextResponse.next();
    if (request.headers.get("host") !== new URL(hosting.origin).host) return new NextResponse("Misdirected Request", { status: 421, headers: { "Cache-Control": "no-store" } });
    const budget = admitRailwayRequest(pathname, request.method);
    if (!budget.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: {
      "Cache-Control": "private, no-store", "Retry-After": String(budget.retryAfter),
    } });
  }
  // These handlers enforce their own backend availability, exact origin,
  // session, CSRF and request budgets. This is only a narrow routing allowlist.
  if (isProfileApiRoute(pathname, request.method)) return NextResponse.next();
  if ((request.method === "GET" || request.method === "HEAD") &&
      (pathname === "/account/profile" || /^\/u\/[a-z][a-z0-9_]{2,23}$/.test(pathname) ||
       /^\/creator\/0x[0-9a-fA-F]{40}$/.test(pathname))) return NextResponse.next();
  if (process.env.RMT_MOBILE_REVIEW_FIXTURE === "local-reviewed-31337" &&
      !process.env.NETLIFY && !process.env.VERCEL && !process.env.DEPLOY_ID && !process.env.CONTEXT && !process.env.RAILWAY_ENVIRONMENT_ID &&
      request.nextUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(request.nextUrl.hostname) &&
      request.headers.get("host") === request.nextUrl.host.replace(/^localhost:/, "127.0.0.1:") &&
      !request.headers.has("forwarded") &&
      ((pathname === "/wallet/mobile-review" && (request.method === "GET" || request.method === "HEAD")) ||
      (pathname === "/api/launchpad/test-mobile-review" && request.method === "POST"))) {
    return NextResponse.next({ headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
  }
  // Each local-only handler repeats its full manifest, host and origin checks.
  if (((pathname === "/api/launchpad/test-creation" || pathname === "/api/launchpad/test-lifecycle") && request.method === "POST") ||
      (pathname === "/api/launchpad/production-creation" && request.method === "POST") ||
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
