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
for (const route of ["/", "/explore", "/launch", `/project/${OFFICIAL_RMT_V6_TOKEN}`, "/status", "/sources", "/sushi", "/rescue", "/experience"]) {
  assert.ok(sitemapUrls.includes(`${appUrl}${route}`), `Sitemap must include ${route}`);
}
for (const route of ["/api/health", "/deploy-mainnet", "/profile", "/portfolio", "/watchlist"]) {
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
assert.equal(RMT_SITE_URL, appUrl);
assert.equal(RMT_SITE_NAME, "RMT Launch");
assert.equal(RMT_SITE_ALTERNATE_NAME, "Robinhood Meme Terminal");
assert.deepEqual(rmtWebsiteStructuredData, {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${appUrl}/#website`,
  url: `${appUrl}/`,
  name: "RMT Launch",
  alternateName: "Robinhood Meme Terminal",
  description: rmtWebsiteStructuredData.description,
  inLanguage: "en-US"
});

const homeSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
assert.match(homeSource, /alternates:\s*\{\s*canonical:\s*"\/"/);
assert.match(homeSource, /openGraph:[\s\S]*?url:\s*"\/"/);
assert.match(homeSource, /type="application\/ld\+json"/);
assert.match(homeSource, /JSON\.stringify\(rmtWebsiteStructuredData\)/);
assert.match(homeSource, /RMT LAUNCH · MARKET TERMINAL/);
assert.match(homeSource, /<ExternalMarketFeed \/>/);
assert.match(homeSource, /<OfficialRmtMarket \/>/);
assert.doesNotMatch(homeSource, /<FreshLaunchFeed \/>/);

const officialRmtMarketSource = readFileSync(new URL("../app/official-rmt-market.tsx", import.meta.url), "utf8");
assert.match(officialRmtMarketSource, /OFFICIAL_RMT_V6_TOKEN/);
assert.match(officialRmtMarketSource, /candidate\.launchId === "0"/);
assert.match(officialRmtMarketSource, /candidate\.officialMigration === true/);
assert.match(officialRmtMarketSource, /It has not graduated into a Sushi or Uniswap pool/);
assert.match(officialRmtMarketSource, /New V6 launches paused · existing market remains open/);
assert.match(officialRmtMarketSource, /Open native RMT market/);

const exploreSource = readFileSync(new URL("../app/explore/page.tsx", import.meta.url), "utf8");
const approvedDirectorySource = readFileSync(new URL("../app/approved-project-directory.tsx", import.meta.url), "utf8");
assert.match(exploreSource, /<FreshLaunchFeed \/>/);
assert.match(exploreSource, /<ApprovedProjectDirectory \/>/);
assert.doesNotMatch(exploreSource, /<ExternalMarketFeed \/>/);
assert.match(approvedDirectorySource, /OFFICIAL RMT · FACTORY VERIFIED/);
assert.match(approvedDirectorySource, /Only official RMT is public until V7 opens/);
assert.match(approvedDirectorySource, /publicCommunityProjectPagesEnabled/);
assert.match(approvedDirectorySource, /publicCommunityProjectPagesEnabled && <GameDirectorySection/);
assert.match(approvedDirectorySource, /RMT GAMES/);
assert.match(approvedDirectorySource, /A token is optional/);
assert.match(approvedDirectorySource, /Play or view/);
assert.match(approvedDirectorySource, /project\.gamePlatforms/);
assert.match(approvedDirectorySource, /Filter approved games/);
assert.match(approvedDirectorySource, /Reset filters/);
assert.match(exploreSource, /Projects, games and verified markets/);
assert.equal(publicRmtProjectVisibility, "official-only");
assert.equal(publicCommunityProjectPagesEnabled, false);
assert.deepEqual(publicRmtNativeLaunches([
  { token: OFFICIAL_RMT_V6_TOKEN },
  { token: "0x0000000000000000000000000000000000000001" }
] as Parameters<typeof publicRmtNativeLaunches>[0]).map((launch) => launch.token), [OFFICIAL_RMT_V6_TOKEN]);
const freshLaunchFeedSource = readFileSync(new URL("../app/fresh-launch-feed.tsx", import.meta.url), "utf8");
assert.match(freshLaunchFeedSource, /publicRmtNativeLaunches\(result\.launches\)/);
assert.match(freshLaunchFeedSource, /<b>V7<\/b> RELEASE GATE/);

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
const approvedProjectPageSource = readFileSync(new URL("../app/project/[address]/approved-project-page.tsx", import.meta.url), "utf8");
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
const tradeTicketUiSource = readFileSync(new URL("../app/trade-ticket-ui.tsx", import.meta.url), "utf8");
const externalSushiTicketSource = readFileSync(new URL("../app/external-sushi-quote-panel.tsx", import.meta.url), "utf8");
const externalUniswapTicketSource = readFileSync(new URL("../app/external-uniswap-trade-panel.tsx", import.meta.url), "utf8");
assert.match(tradeTicketUiSource, /FINAL PRE-SIGN REVIEW/);
assert.match(tradeTicketUiSource, /SAFER SIZE APPLIED/);
assert.match(tradeTicketUiSource, /PROTECTED MINIMUM/);
assert.match(tradeTicketUiSource, /EXECUTION ROUTE/);
assert.match(tradeTicketUiSource, /EXECUTION CHECK · \{routeLabel\}/);
assert.match(tradeTicketUiSource, /LIQUIDITY DEPTH/);
assert.match(tradeTicketUiSource, /EVIDENCE \/ CONTROL/);
assert.match(externalSushiTicketSource, /setSaferOrderOriginal\(amountIn\)/);
assert.match(externalSushiTicketSource, /routeLabel="Sushi · RedSnwapper"/);
assert.match(externalSushiTicketSource, /evidenceBlocked \|\| impactBlocked/);
assert.match(externalUniswapTicketSource, /setSaferOrderOriginal\(amountIn\)/);
assert.match(externalUniswapTicketSource, /routeLabel="Uniswap V3 · Router02"/);
assert.match(externalUniswapTicketSource, /evidenceBlocked \|\| impactBlocked/);
assert.match(projectRouteSource, /isAddress/);
assert.match(projectRouteSource, /ApprovedProjectPage/);
assert.match(approvedProjectPageSource, /RMT PAGE · REVIEW APPROVED/);
assert.match(approvedProjectPageSource, /No module is activated by page approval/);
assert.match(approvedProjectPageSource, /Eligible for assigned-creator review · inactive by default/);
assert.match(approvedProjectPageSource, /ProjectCreatorControls/);
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
assert.match(launchSource, /Launching reopens with V7—not before/);
assert.doesNotMatch(launchSource, /LaunchForm/);
assert.doesNotMatch(launchSource, /CREATE ON RMT V6/);

const rescueSource = readFileSync(new URL("../app/rescue/page.tsx", import.meta.url), "utf8");
assert.match(rescueSource, /openGraph:[\s\S]*?url:\s*"\/rescue"/);

const chromeSource = readFileSync(new URL("../app/public-chrome.tsx", import.meta.url), "utf8");
const mobileDock = chromeSource.match(/<nav className=\{`mobileDock[\s\S]*?<\/nav>/)?.[0];
assert.ok(mobileDock, "Mobile navigation must remain present");
assert.match(mobileDock, /href="\/explore"/);
assert.match(mobileDock, /href="\/watchlist"/);
assert.doesNotMatch(mobileDock, /href="\/status"/);
assert.doesNotMatch(mobileDock, /github\.com\/sponsors/);

assert.match(chromeSource, /https:\/\/github\.com\/sponsors\/LandoCrissian/);
assert.match(chromeSource, /Help &amp; safety[\s\S]*?href="\/status"/);
assert.doesNotMatch(chromeSource, /const MORE_PREFIXES = \[[^\]]*"\/explore"/);

console.info("Public discovery smoke test passed");
