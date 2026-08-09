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

export function middleware(request: NextRequest) {
  return vnextRequestBoundary(process.env, request.method);
}

export const config = {
  matcher: "/vnext/:path*",
};
