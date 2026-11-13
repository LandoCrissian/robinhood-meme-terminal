import { curveShowcaseExamples } from "../launchpad/curve-showcase";

type Environment = Record<string, string | undefined>;

export function launchSiteMode(env: Environment = process.env) {
  if (env.VERCEL === "1" || env.VERCEL_ENV || env.RMT_LAUNCHPAD_SITE_MODE) return "showcase";
  const curve = env.RMT_CURVE_ENABLED === "true";
  const historical = env.RMT_LAUNCHPAD_ENABLED === "true";
  if (curve === historical) return "showcase";
  return curve ? "curve" : "historical";
}

export function isLaunchShowcase(env: Environment = process.env) {
  return launchSiteMode(env) === "showcase";
}

const showcasePages = new Set([
  "/", "/create-token", "/my-launches", "/wallet", "/rmt",
  "/terms", "/risks", "/privacy", "/sources", "/support",
  "/manifest.webmanifest", "/favicon.ico", "/robots.txt",
  ...curveShowcaseExamples.map(({ slug }) => `/launches/${slug}`),
]);
const showcaseApi = new Set([
  "/api/launchpad/config", "/api/launchpad/curve", "/api/launchpad/launches",
  "/api/launchpad/public/list_launches", "/api/launchpad/public/get_launch",
  "/api/launchpad/public/get_launch_checks", "/api/launchpad/public/get_pool_state",
  "/api/launchpad/public/get_launch_activity",
]);

export function showcaseIngressAllowed(path: string, method: string) {
  if (method !== "GET" && method !== "HEAD") return false;
  if (showcasePages.has(path) || showcaseApi.has(path)) return true;
  const prefix = ["/_next/static/", "/brand/"].find((assetPath) => path.startsWith(assetPath));
  if (!prefix) return false;
  try {
    return path.slice(prefix.length).split("/").every((encodedSegment) => {
      const segment = decodeURIComponent(encodedSegment);
      return /^[\w.@()\[\]-]+$/.test(segment) && segment !== "." && segment !== "..";
    });
  } catch {
    return false;
  }
}
