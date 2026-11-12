import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readVNextReleaseReadiness, type VNextReleaseEnvironment } from "./lib/vnext/release-readiness";

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
  matcher: [
    "/vnext/:path*", "/nft/:path*", "/projects/:path*", "/project/:path*", "/markets/:path*",
    "/robinhood-chain/:path*", "/explore/:path*", "/runners/:path*", "/profile/:path*",
    "/invite/:path*", "/r/:path*", "/watchlist/:path*", "/experience/:path*", "/sushi/:path*",
    "/creator-consent/:path*", "/api/community/:path*", "/api/experience/:path*", "/api/nft/:path*",
    "/api/projects/:path*", "/api/vnext/chain-pulse/:path*", "/api/vnext/capital-flow/:path*",
    "/api/vnext/market-directory/:path*", "/api/vnext/market-search/:path*", "/api/markets/wallet-constellation/:path*",
  ],
};
