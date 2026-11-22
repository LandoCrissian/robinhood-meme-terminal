import { NextResponse, type NextRequest } from "next/server";
import { isLaunchAddress } from "./lib/launch-data";
import { creationReviewPath } from "./lib/launch-draft";
import { isProfileApiRoute } from "./lib/server/profiles/config";
import { admitRailwayRequest, railwayHosting } from "./lib/server/railway-read-only";

const publicRoutes = new Set([
  "/", "/create-token", "/my-launches", "/my-launches/earnings", "/my-launches/treasury", "/my-launches/treasury/nft-purchases", "/wallet", "/reclaim",
  "/people", "/leaderboard", "/terms", "/risks", "/privacy", "/robots.txt", "/api/launchpad/config",
  "/api/launchpad/launches", "/api/launchpad/project-treasury", "/api/launchpad/reclaim",
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
  if (["GET","HEAD"].includes(request.method) && (pathname === "/share/default.png" ||
      /^\/share\/(?:u\/[a-z][a-z0-9_]{2,23}|(?:creator|launches)\/0x[0-9a-f]{40})\/[0-9a-f]{24}\.png$/.test(pathname))) return NextResponse.next();
  // The handler repeats all local manifest/origin/runtime checks. Hosted GET
  // and POST both return 404; this is never a production transaction route.
  if (pathname === "/api/nft-acquisition" && ["GET", "HEAD", "POST"].includes(request.method)) return NextResponse.next();
  // Forward only the separately versioned review surface to its complete
  // loopback/manifest/runtime gate. Both handlers return public 404s.
  if ((pathname === "/api/seaport-acquisition" && ["GET", "HEAD", "POST"].includes(request.method)) ||
      (pathname === "/my-launches/treasury/seaport-purchases" && ["GET", "HEAD"].includes(request.method))) return NextResponse.next();
  // These read-only handlers validate recipient/deployment/checkpoint context;
  // test claims repeat the explicit local fixture gate, production claims stay off.
  if ((["GET", "HEAD"].includes(request.method) && /^\/api\/launchpad\/earnings(?:\/(?:factory|history|0x[0-9a-fA-F]{40}))?$/.test(pathname))
    || (request.method === "POST" && ["/api/launchpad/test-earnings", "/api/launchpad/test-claim-profiles", "/api/launchpad/test-project-treasury", "/api/launchpad/test-reclaim", "/api/launchpad/production-earnings"].includes(pathname))) return NextResponse.next();
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
  if (["GET","HEAD"].includes(request.method) && /^\/api\/artwork\/bafkrei[a-z2-7]{52}\/(?:metadata\.json|image\.webp|logo\.webp)$/.test(pathname)) return NextResponse.next();
  if (isProfileApiRoute(pathname, request.method) ||
      ((pathname === "/api/launchpad/production-creation" || pathname === "/api/artwork/upload") && request.method === "POST")) {
    // A same-URL rewrite with response headers makes the Netlify adapter retain
    // this request's URL when dispatching to a reused Next server instance.
    return NextResponse.rewrite(request.nextUrl, { headers: { "Cache-Control": "private, no-store" } });
  }
  // Each local-only handler repeats its full manifest, host and origin checks.
  if (((pathname === "/api/launchpad/test-creation" || pathname === "/api/launchpad/test-lifecycle") && request.method === "POST") ||
      (pathname === "/api/launchpad/production-lifecycle" && request.method === "POST") ||
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
