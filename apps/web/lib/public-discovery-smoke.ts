import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import robots from "../app/robots";
import { staticPublicSitemap } from "../app/sitemap";
import {
  buildVerifiedTokenProject,
  OFFICIAL_RMT_V6_TOKEN,
  PROJECT_PAGE_SCHEMA_VERSION
} from "./project-page";
import { parsePublicProject } from "./creator-application";
import { filterGameProjects, sortGameProjects } from "./game-discovery";
import {
  publicCommunityProjectPagesEnabled,
  publicRmtNativeLaunches,
  publicRmtProjectVisibility
} from "./public-project-visibility";
import {
  RMT_SITE_ALTERNATE_NAME,
  RMT_SITE_NAME,
  RMT_SITE_URL,
  rmtWebsiteStructuredData
} from "./site-identity";

const appUrl = "https://www.rmtlaunch.fun";

const robotsConfig = robots();
const rules = Array.isArray(robotsConfig.rules) ? robotsConfig.rules : [robotsConfig.rules];
const publicRule = rules.find((rule) => rule.userAgent === "*");
assert.equal(robotsConfig.host, appUrl);
assert.equal(robotsConfig.sitemap, `${appUrl}/sitemap.xml`);
assert.equal(publicRule?.allow, "/");
assert.ok(publicRule?.disallow?.includes("/api/"));
assert.ok(publicRule?.disallow?.includes("/admin/"));
assert.ok(publicRule?.disallow?.includes("/profile"));
assert.ok(!publicRule?.disallow?.includes("/deploy-mainnet"), "robots.txt must not advertise hidden operator routes");

const sitemapUrls = staticPublicSitemap().map((entry) => entry.url);
for (const route of ["/", "/rmt", "/explore", `/project/${OFFICIAL_RMT_V6_TOKEN}`, "/status", "/sources", "/sushi", "/experience"]) {
  assert.ok(sitemapUrls.includes(`${appUrl}${route}`), `Sitemap must include ${route}`);
}
for (const route of ["/api/health", "/deploy-mainnet", "/profile", "/portfolio", "/watchlist", "/launch", "/rescue"]) {
  assert.ok(!sitemapUrls.includes(`${appUrl}${route}`), `Sitemap must not publish ${route}`);
}
assert.ok(!sitemapUrls.includes(`${appUrl}/token/${OFFICIAL_RMT_V6_TOKEN}`), "Legacy token URL must defer to the canonical Project URL");

const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
assert.doesNotMatch(layoutSource, /alternates:\s*\{\s*canonical:\s*"\/"/);
assert.doesNotMatch(layoutSource, /openGraph:\s*\{\s*url:/);
assert.match(layoutSource, /applicationName:\s*RMT_SITE_NAME/);
assert.match(layoutSource, /siteName:\s*RMT_SITE_NAME/);
assert.match(layoutSource, /manifest:\s*"\/manifest\.webmanifest"/);
assert.match(layoutSource, /googleBot:[\s\S]*?"max-image-preview":\s*"large"/);
assert.match(layoutSource, /type="application\/ld\+json"/);
assert.match(layoutSource, /JSON\.stringify\(rmtWebsiteStructuredData\)/);
assert.equal(RMT_SITE_URL, appUrl);
assert.equal(RMT_SITE_NAME, "Robinhood Meme Terminal");
assert.equal(RMT_SITE_ALTERNATE_NAME, "RMT");
assert.deepEqual(rmtWebsiteStructuredData, {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${appUrl}/#website`,
  url: `${appUrl}/`,
  name: "Robinhood Meme Terminal",
  alternateName: "RMT",
  description: rmtWebsiteStructuredData.description,
  inLanguage: "en-US",
  publisher: { "@id": `${appUrl}/#organization` }
});

const homeSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const vnextSource = readFileSync(new URL("../app/vnext/page.tsx", import.meta.url), "utf8");
const nextConfigSource = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
assert.match(homeSource, /export \{ metadata \} from "\.\/vnext\/page"/);
assert.match(homeSource, /<VNextTerminalShell \/>/);
assert.doesNotMatch(homeSource, /export const dynamic = "force-dynamic"/);
assert.match(vnextSource, /<VNextTerminalShell \/>/);
assert.match(vnextSource, /alternates: \{ canonical: "\/" \}/);
assert.doesNotMatch(nextConfigSource, /source: "\/"[\s\S]*destination: "\/vnext"/);
assert.match(nextConfigSource, /source: "\/vnext"[\s\S]*destination: "\/"[\s\S]*permanent: true/);

const exploreSource = readFileSync(new URL("../app/explore/page.tsx", import.meta.url), "utf8");
assert.match(exploreSource, /<FreshLaunchFeed \/>/);
assert.doesNotMatch(exploreSource, /<ApprovedProjectDirectory \/>/);
assert.doesNotMatch(exploreSource, /<ExternalMarketFeed \/>/);
assert.match(exploreSource, /RMT markets and onchain evidence/);
assert.equal(publicRmtProjectVisibility, "official-only");
assert.equal(publicCommunityProjectPagesEnabled, false);
assert.deepEqual(publicRmtNativeLaunches([
  { token: OFFICIAL_RMT_V6_TOKEN },
  { token: "0x0000000000000000000000000000000000000001" }
] as Parameters<typeof publicRmtNativeLaunches>[0]).map((launch) => launch.token), [OFFICIAL_RMT_V6_TOKEN]);
const freshLaunchFeedSource = readFileSync(new URL("../app/fresh-launch-feed.tsx", import.meta.url), "utf8");
assert.match(freshLaunchFeedSource, /publicRmtNativeLaunches\(result\.launches\)/);
assert.match(freshLaunchFeedSource, /<b>NEW<\/b> CREATION CLOSED/);
assert.match(freshLaunchFeedSource, /Historical V6 compatibility/);

const discoveryGames = [
  {
    slug: "neon-skies",
    name: "Neon Skies",
    summary: "A cooperative adventure game with playable web and Windows builds for community explorers.",
    gameStatus: "playable",
    gamePlatforms: ["web", "windows"],
    gameGenre: "adventure",
    gameModes: ["co-op"]
  },
  {
    slug: "pocket-racer",
    name: "Pocket Racer",
    summary: "A competitive mobile racing game currently progressing through public development milestones.",
    gameStatus: "development",
    gamePlatforms: ["ios", "android"],
    gameGenre: "racing",
    gameModes: ["competitive"]
  }
].map((game, index) => parsePublicProject({
  schemaVersion: 1,
  projectType: "gaming",
  website: "",
  xProfile: "",
  tokenAddress: "",
  availableModules: ["game"],
  status: "live",
  publishedAt: { toMillis: () => index + 1 },
  ...game
})).filter((game): game is NonNullable<typeof game> => Boolean(game));
const sortedDiscoveryGames = sortGameProjects(discoveryGames);
assert.deepEqual(sortedDiscoveryGames.map((game) => game.name), ["Neon Skies", "Pocket Racer"]);
assert.deepEqual(filterGameProjects(sortedDiscoveryGames, {
  query: "co-op",
  status: "all",
  platform: "all"
}).map((game) => game.name), ["Neon Skies"]);
assert.deepEqual(filterGameProjects(sortedDiscoveryGames, {
  query: "",
  status: "development",
  platform: "ios"
}).map((game) => game.name), ["Pocket Racer"]);

const projectPageSource = readFileSync(new URL("../app/project/[address]/project-detail-page.tsx", import.meta.url), "utf8");
const projectRouteSource = readFileSync(new URL("../app/project/[address]/page.tsx", import.meta.url), "utf8");
const tokenPageSource = readFileSync(new URL("../app/token/[address]/page.tsx", import.meta.url), "utf8");
assert.match(projectPageSource, /ProjectModuleGrid/);
assert.match(projectPageSource, /OFFICIAL RMT · PROJECT VERIFIED/);
assert.match(projectPageSource, /MarketPanel/);
assert.match(projectPageSource, /RMT-NATIVE TOOLKIT/);
assert.match(projectPageSource, /Creator risk/);
assert.match(projectPageSource, /initialDetail=\{initialDetail\}/);
const marketPanelSource = readFileSync(new URL("../app/market-panel.tsx", import.meta.url), "utf8");
assert.match(marketPanelSource, /id="market-chart"/);
assert.match(marketPanelSource, /id="market-evidence"/);
assert.match(marketPanelSource, /Native market confidence/);
assert.match(marketPanelSource, /Factory verified/);
assert.match(marketPanelSource, /No mint, tax or blacklist/);
assert.match(marketPanelSource, /cannot guarantee price performance or prevent every loss/);
assert.match(marketPanelSource, /approve exactly this sell amount/);
assert.match(marketPanelSource, /args: \[market, tokensIn\]/);
assert.match(marketPanelSource, /pendingSellOrderRef/);
assert.match(marketPanelSource, /Order blocked · impact above 5%/);
assert.match(marketPanelSource, /Reduce to safer size/);
assert.match(marketPanelSource, /Refreshing the quote and re-checking this exact order onchain/);
assert.match(marketPanelSource, /await publicClient\.estimateContractGas/);
assert.doesNotMatch(marketPanelSource, /maxUint256/);
const externalMarketRouteSource = readFileSync(new URL("../app/api/markets/external/route.ts", import.meta.url), "utf8");
const externalMarketSocialsSource = readFileSync(new URL("./external-market-socials.ts", import.meta.url), "utf8");
const launchpadNetworkSource = readFileSync(new URL("../app/launchpad-network.tsx", import.meta.url), "utf8");
assert.match(externalMarketRouteSource, /searchParams\.get\("contract"\)/);
assert.match(externalMarketRouteSource, /fetchPairByAddress\(requestedContract\)/);
assert.doesNotMatch(
  externalMarketRouteSource,
  /liquidityUsd < RUNNER_THRESHOLDS\.minimumDisplayLiquidityUsd \|\| volume24h <= 0/
);
assert.match(externalMarketRouteSource, /externalMarketSocialsFromPairInfo\(pair\.info\)/);
assert.match(externalMarketSocialsSource, /provenance: "dex-pair-metadata"/);
assert.match(externalMarketSocialsSource, /safeExternalNavigationUrl/);
assert.match(launchpadNetworkSource, /Uniswap Launches/);
assert.match(launchpadNetworkSource, /Sushi Launch/);
assert.match(launchpadNetworkSource, /Individual beta-feed inclusion is never assumed/);
assert.match(projectRouteSource, /isAddress/);
assert.match(projectRouteSource, /if \(!isAddress\(address\)\) redirect\("\/explore"\)/);
assert.doesNotMatch(projectRouteSource, /ApprovedProjectPage/);
assert.match(tokenPageSource, /ProjectDetailPage/);

const officialProject = buildVerifiedTokenProject({
  chainId: 4663,
  token: OFFICIAL_RMT_V6_TOKEN,
  creator: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
  officialMigration: true
});
assert.equal(officialProject.schemaVersion, PROJECT_PAGE_SCHEMA_VERSION);
assert.equal(officialProject.official, true);
assert.equal(officialProject.controllerStatus, "review-required");
assert.equal(officialProject.modules.find((module) => module.id === "token")?.status, "live");
for (const moduleId of ["nft", "marketplace", "music"] as const) {
  assert.equal(officialProject.modules.find((module) => module.id === moduleId)?.status, "planned");
}
assert.equal(buildVerifiedTokenProject({
  chainId: officialProject.chainId,
  token: officialProject.token,
  creator: officialProject.onchainCreator,
  officialMigration: false
}).official, false);

const launchSource = readFileSync(new URL("../app/launch/page.tsx", import.meta.url), "utf8");
assert.match(launchSource, /RMT is a trading terminal, not a launchpad/);
assert.match(launchSource, /No launch reopening is implied/);
assert.doesNotMatch(launchSource, /LaunchForm/);
assert.doesNotMatch(launchSource, /CREATE ON RMT V6/);

const rescueSource = readFileSync(new URL("../app/rescue/page.tsx", import.meta.url), "utf8");
assert.match(rescueSource, /openGraph:[\s\S]*?url:\s*"\/rescue"/);

const chromeSource = readFileSync(new URL("../app/public-chrome.tsx", import.meta.url), "utf8");
const mobileDock = chromeSource.match(/<nav className=\{`mobileDock[\s\S]*?<\/nav>/)?.[0];
assert.ok(mobileDock, "Mobile navigation must remain present");
assert.match(mobileDock, /href="\/explore"/);
assert.match(mobileDock, /href="\/watchlist"/);
assert.match(mobileDock, /href="\/sources"/);
assert.doesNotMatch(mobileDock, /href="\/profile"/);
assert.doesNotMatch(mobileDock, /href="\/status"/);
assert.doesNotMatch(mobileDock, /github\.com\/sponsors/);

assert.match(chromeSource, /https:\/\/github\.com\/sponsors\/LandoCrissian/);
assert.match(chromeSource, /Help &amp; safety[\s\S]*?href="\/status"/);
assert.doesNotMatch(chromeSource, /const MORE_PREFIXES = \[[^\]]*"\/explore"/);

console.info("Public discovery smoke test passed");
