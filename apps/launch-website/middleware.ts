import { NextResponse, type NextRequest } from "next/server";
import { curveShowcaseExamples } from "./lib/curve-showcase";

const publicRoutes = new Set([
  "/", "/create-token", "/my-launches", "/wallet", "/rmt",
  "/terms", "/risks", "/privacy", "/robots.txt", "/api/launchpad/config",
  ...curveShowcaseExamples.map(({ slug }) => `/launches/${slug}`),
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if ((request.method === "GET" || request.method === "HEAD")
      && (publicRoutes.has(pathname) || isStaticAsset(pathname))) {
    return NextResponse.next();
  }
  return new NextResponse(request.method === "HEAD" ? null : "Not Found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export const config = { matcher: ["/:path*"] };
