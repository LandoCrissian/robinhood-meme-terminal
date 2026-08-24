import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import robots from "../app/robots";
import { staticPublicSitemap } from "../app/sitemap";
import {
  legacyTerminalMarketRedirect,
  normalizeLegacyTerminalMarketAddress
} from "./vnext/legacy-terminal-routes";
import {
  RMT_SITE_ALTERNATE_NAME,
  RMT_SITE_NAME,
  RMT_SITE_URL,
  rmtWebsiteStructuredData
} from "./site-identity";

const appUrl = "https://www.rmtlaunch.fun";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const robotsConfig = robots();
const rules = Array.isArray(robotsConfig.rules) ? robotsConfig.rules : [robotsConfig.rules];
const publicRule = rules.find((rule) => rule.userAgent === "*");
assert.equal(robotsConfig.host, appUrl);
assert.equal(robotsConfig.sitemap, `${appUrl}/sitemap.xml`);
assert.equal(publicRule?.allow, "/");
assert.ok(publicRule?.disallow?.includes("/api/"));
assert.ok(publicRule?.disallow?.includes("/admin/"));

const sitemapUrls = staticPublicSitemap().map((entry) => entry.url);
for (const route of [
  "/", "/rmt", "/robinhood-chain", "/markets/robinhood-chain", "/status",
  "/sources", "/support", "/risks", "/terms", "/privacy", "/experience"
]) assert.ok(sitemapUrls.includes(`${appUrl}${route}`), `Sitemap must include ${route}`);
for (const route of [
  "/launch", "/explore", "/sushi", "/rescue", "/deploy-mainnet", "/project/0x", "/token/0x"
]) assert.ok(!sitemapUrls.some((url) => url.startsWith(`${appUrl}${route}`)), `Sitemap must not publish ${route}`);

const layoutSource = read("../app/layout.tsx");
assert.doesNotMatch(layoutSource, /sushi-lab\.css|rescue-lab\.css/);
assert.match(layoutSource, /applicationName:\s*RMT_SITE_NAME/);
assert.match(layoutSource, /siteName:\s*RMT_SITE_NAME/);
assert.match(layoutSource, /type="application\/ld\+json"/);
assert.equal(RMT_SITE_URL, appUrl);
assert.equal(RMT_SITE_NAME, "Robinhood Meme Terminal");
assert.equal(RMT_SITE_ALTERNATE_NAME, "RMT");
assert.equal(rmtWebsiteStructuredData.url, `${appUrl}/`);

const homeSource = read("../app/page.tsx");
const vnextSource = read("../app/vnext/page.tsx");
const nextConfigSource = read("../next.config.mjs");
assert.match(homeSource, /<VNextTerminalShell \/>/, "ROOT_RENDERS_TERMINAL");
assert.match(vnextSource, /<VNextTerminalShell \/>/, "VNEXT_RENDERS_TERMINAL");
assert.match(nextConfigSource, /source: "\/vnext"[\s\S]*destination: "\/"[\s\S]*permanent: true/);

const redirectRoutes = ["explore", "launch", "sushi", "rescue", "deploy-mainnet"] as const;
for (const route of redirectRoutes) {
  const source = read(`../app/${route}/page.tsx`);
  assert.match(source, /redirect\(TERMINAL_ROOT_PATH\)/, `${route} must redirect to Terminal root`);
  assert.doesNotMatch(source, /FreshLaunchFeed|LaunchForm|SushiTrade|V6ReleaseConsole|RehearsalProof/);
}

const validAddress = "0x39DBed3A2BD333467115DE45665Cc57f813C4571";
const normalizedAddress = "0x39dbed3a2bd333467115de45665cc57f813c4571";
assert.equal(normalizeLegacyTerminalMarketAddress(validAddress), normalizedAddress);
assert.equal(legacyTerminalMarketRedirect(validAddress), `/?market=${normalizedAddress}`);
assert.equal(legacyTerminalMarketRedirect("not-an-address"), "/");
assert.equal(legacyTerminalMarketRedirect("0x0000"), "/");

for (const route of ["project", "token"] as const) {
  const source = read(`../app/${route}/[address]/page.tsx`);
  assert.match(source, /legacyTerminalMarketRedirect\(address\)/);
  assert.doesNotMatch(source, /searchParams|launch=|official=|side=/);
  assert.doesNotMatch(source, /ProjectDetailPage|ApprovedProjectPage|MarketPanel/);
}

const chromeSource = read("../app/public-chrome.tsx");
assert.match(chromeSource, /href="\/markets\/robinhood-chain"/);
assert.doesNotMatch(chromeSource, /href="\/(?:launch|explore|sushi|deploy-mainnet)(?:"|\/)/);
assert.doesNotMatch(chromeSource, /Sushi integration|launchpad/i);

const indexNowSource = read("../scripts/indexnow-static-refresh.ts");
assert.doesNotMatch(indexNowSource, /"\/(?:launch|explore|sushi|deploy-mainnet)"/);
const sourcesSource = read("../app/sources/page.tsx");
assert.doesNotMatch(sourcesSource, /LaunchpadNetwork|Sushi integration/i);
assert.match(sourcesSource, /RMT TERMINAL · EVIDENCE BOUNDARIES/);
const rmtSource = read("../app/rmt/page.tsx");
assert.doesNotMatch(rmtSource, /launch 0|retired launchpad|official RMT V6 token/i);
assert.match(rmtSource, /RMT is a trading terminal/);

const removedLaunchpadFiles = [
  "../app/approved-project-directory.tsx",
  "../app/fresh-launch-feed.tsx",
  "../app/launch-form.tsx",
  "../app/launchpad-network.tsx",
  "../app/project-module-grid.tsx",
  "../app/token-share-actions.tsx",
  "../app/project/[address]/project-detail-page.tsx",
  "../app/project/[address]/approved-project-page.tsx",
  "../app/project/[address]/opengraph-image.tsx",
  "../app/deploy-mainnet/v6-release-console.tsx",
  "../app/api/deploy-mainnet/v6-source-status/route.ts",
  "../app/api/launches/route.ts",
  "./project-page.ts",
  "./public-project-discovery.ts",
  "./public-project-visibility.ts",
  "./public-launch-release.ts"
];
for (const path of removedLaunchpadFiles) {
  assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} must remain outside the public application tree`);
}

const externalMarketRouteSource = read("../app/api/markets/external/route.ts");
assert.match(externalMarketRouteSource, /searchParams\.get\("contract"\)/);
assert.doesNotMatch(externalMarketRouteSource, /liquidityUsd < RUNNER_THRESHOLDS\.minimumDisplayLiquidityUsd \|\| volume24h <= 0/);

console.info("Terminal-only public surface and legacy route compatibility smoke tests passed.");
