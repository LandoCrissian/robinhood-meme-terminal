import { pathToFileURL } from "node:url";
import { submitIndexNowUrls } from "../lib/server/indexnow";
import { RMT_SITE_URL } from "../lib/site-identity";

const OFFICIAL_RMT_PROJECT_ROUTE = "/project/0xdBa33be56C89CC9fc014c4459028d7e5c7878671";

const ALL_MARKET_DIRECTORY_ROUTES = [
  "/markets/robinhood-chain",
  "/markets/robinhood-chain/trending",
  "/markets/robinhood-chain/new",
  "/markets/robinhood-chain/active"
] as const;

const ALL_STATIC_PUBLIC_ROUTES = [
  "/",
  "/rmt",
  "/robinhood-chain",
  ...ALL_MARKET_DIRECTORY_ROUTES,
  "/explore",
  OFFICIAL_RMT_PROJECT_ROUTE,
  "/status",
  "/sources",
  "/sushi",
  "/support",
  "/risks",
  "/terms",
  "/privacy",
  "/experience"
] as const;

const staticRules = [
  {
    matches: (file: string) => [
      "apps/web/lib/site-identity.ts",
      "apps/web/app/layout.tsx",
      "apps/web/app/public-chrome.tsx",
      "apps/web/app/site-footer.tsx",
      "apps/web/app/sitemap.ts",
      "apps/web/next.config.mjs"
    ].includes(file) || file.startsWith("apps/web/public/brand/"),
    routes: ALL_STATIC_PUBLIC_ROUTES
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/rmt/"),
    routes: ["/rmt"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/robinhood-chain/"),
    routes: ["/robinhood-chain"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/markets/robinhood-chain/"),
    routes: ALL_MARKET_DIRECTORY_ROUTES
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/explore/"),
    routes: ["/explore"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/sushi/"),
    routes: ["/sushi"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/sources/"),
    routes: ["/sources"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/status/"),
    routes: ["/status"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/support/"),
    routes: ["/support"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/risks/"),
    routes: ["/risks"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/terms/"),
    routes: ["/terms"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/privacy/"),
    routes: ["/privacy"] as const
  },
  {
    matches: (file: string) => file.startsWith("apps/web/app/experience/"),
    routes: ["/experience"] as const
  }
] as const;

function canonicalRouteUrl(route: string) {
  return new URL(route, `${RMT_SITE_URL}/`).toString();
}

export function indexNowUrlsForChangedStaticFiles(files: readonly string[]) {
  const routes = new Set<string>();
  for (const rawFile of files) {
    const file = rawFile.trim().replaceAll("\\", "/");
    if (!file) continue;
    for (const rule of staticRules) {
      if (!rule.matches(file)) continue;
      for (const route of rule.routes) routes.add(route);
    }
  }
  return [...routes].map(canonicalRouteUrl);
}

export async function runIndexNowStaticRefresh(files = process.argv.slice(2)) {
  const urls = indexNowUrlsForChangedStaticFiles(files);
  if (urls.length === 0) {
    console.info("IndexNow static refresh found no canonical public URL changes; nothing submitted.");
    return { status: null, submitted: 0 } as const;
  }
  const result = await submitIndexNowUrls(urls);
  console.info(`IndexNow accepted ${result.submitted} changed canonical RMT URL(s) with HTTP ${result.status}.`);
  return result;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runIndexNowStaticRefresh().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
