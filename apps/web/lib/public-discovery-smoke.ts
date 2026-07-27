import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import {
  buildVerifiedTokenProject,
  OFFICIAL_RMT_V6_TOKEN,
  PROJECT_PAGE_SCHEMA_VERSION
} from "./project-page";

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

const sitemapUrls = sitemap().map((entry) => entry.url);
for (const route of ["/", "/explore", "/launch", `/project/${OFFICIAL_RMT_V6_TOKEN}`, "/status", "/sources", "/sushi", "/rescue"]) {
  assert.ok(sitemapUrls.includes(`${appUrl}${route}`), `Sitemap must include ${route}`);
}
for (const route of ["/api/health", "/deploy-mainnet", "/profile", "/portfolio", "/watchlist"]) {
  assert.ok(!sitemapUrls.includes(`${appUrl}${route}`), `Sitemap must not publish ${route}`);
}

const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
assert.doesNotMatch(layoutSource, /alternates:\s*\{\s*canonical:\s*"\/"/);
assert.doesNotMatch(layoutSource, /openGraph:\s*\{\s*url:/);

const homeSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
assert.match(homeSource, /alternates:\s*\{\s*canonical:\s*"\/"/);
assert.match(homeSource, /openGraph:[\s\S]*?url:\s*"\/"/);
assert.match(homeSource, /<ExternalMarketFeed \/>/);
assert.doesNotMatch(homeSource, /<FreshLaunchFeed \/>/);

const exploreSource = readFileSync(new URL("../app/explore/page.tsx", import.meta.url), "utf8");
assert.match(exploreSource, /<FreshLaunchFeed \/>/);
assert.doesNotMatch(exploreSource, /<ExternalMarketFeed \/>/);

const projectPageSource = readFileSync(new URL("../app/project/[address]/project-detail-page.tsx", import.meta.url), "utf8");
const approvedProjectPageSource = readFileSync(new URL("../app/project/[address]/approved-project-page.tsx", import.meta.url), "utf8");
const projectRouteSource = readFileSync(new URL("../app/project/[address]/page.tsx", import.meta.url), "utf8");
const tokenPageSource = readFileSync(new URL("../app/token/[address]/page.tsx", import.meta.url), "utf8");
assert.match(projectPageSource, /ProjectModuleGrid/);
assert.match(projectPageSource, /OFFICIAL RMT · PROJECT VERIFIED/);
assert.match(projectRouteSource, /isAddress/);
assert.match(projectRouteSource, /ApprovedProjectPage/);
assert.match(approvedProjectPageSource, /RMT PAGE · REVIEW APPROVED/);
assert.match(approvedProjectPageSource, /No module is activated by page approval/);
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
assert.match(chromeSource, /Help &amp; safety[\s\S]*?href="\/status"/);
assert.doesNotMatch(chromeSource, /const MORE_PREFIXES = \[[^\]]*"\/explore"/);

console.info("Public discovery smoke test passed");
