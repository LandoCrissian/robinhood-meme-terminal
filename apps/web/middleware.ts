import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readVNextReleaseReadiness, type VNextReleaseEnvironment } from "./lib/vnext/release-readiness";
import { showcaseIngressAllowed } from "./lib/server/launchpad-site-mode";

const blockedHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function vnextRequestBoundary(env: VNextReleaseEnvironment, method = "GET") {
  const readiness = readVNextReleaseReadiness(env);
  if (readiness.shellEnabled && readiness.configurationConsistent) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-RMT-VNext-Mode", readiness.shellMode);
    response.headers.set("X-RMT-VNext-Release", readiness.mode);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  return new NextResponse(method === "HEAD" ? null : "Not Found", {
    status: 404,
    headers: blockedHeaders,
  });
}

const retiredProducts = [
  "/nft", "/projects", "/project", "/markets", "/robinhood-chain", "/explore", "/runners",
  "/profile", "/invite", "/r", "/watchlist", "/experience", "/sushi", "/creator-consent",
  "/api/community", "/api/experience", "/api/nft", "/api/projects",
  "/api/vnext/chain-pulse", "/api/vnext/capital-flow", "/api/vnext/market-directory", "/api/vnext/market-search",
  "/api/markets/wallet-constellation",
] as const;

export function launchpadRouteRetired(path: string) {
  return retiredProducts.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Explicit showcase mode keeps historical routes off the isolated preview.
  if (process.env.RMT_LAUNCHPAD_SITE_MODE === "showcase") {
    if (showcaseIngressAllowed(path, request.method)) {
      const response = NextResponse.next();
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return response;
    }
    if (request.method === "POST" && path === "/api/launchpad/launches") {
      return NextResponse.json({ status: "disabled", reason: "New launches are disabled on this deployment." }, {
        status: 403, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    return new NextResponse(request.method === "HEAD" ? null : "Not Found", { status: 404, headers: blockedHeaders });
  }
  if (launchpadRouteRetired(path)) {
    return new NextResponse(request.method === "HEAD" ? null : "This RMT product route has retired.", {
      status: 410,
      headers: blockedHeaders,
    });
  }
  if (path === "/vnext" || path.startsWith("/vnext/")) return vnextRequestBoundary(process.env, request.method);
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
