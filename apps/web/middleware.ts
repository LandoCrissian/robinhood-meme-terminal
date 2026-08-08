import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  type VNextShellEnvironment,
  vnextShellAvailable,
} from "./lib/vnext/vnext-shell-access";

const blockedHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function vnextRequestBoundary(env: VNextShellEnvironment, method = "GET") {
  if (vnextShellAvailable(env)) return NextResponse.next();

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
