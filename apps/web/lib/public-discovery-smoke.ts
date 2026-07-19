import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

const appUrl = "https://www.rmtlaunch.fun";

const robotsConfig = robots();
const rules = Array.isArray(robotsConfig.rules) ? robotsConfig.rules : [robotsConfig.rules];
const publicRule = rules.find((rule) => rule.userAgent === "*");
assert.equal(robotsConfig.host, appUrl);
assert.equal(robotsConfig.sitemap, `${appUrl}/sitemap.xml`);
assert.equal(publicRule?.allow, "/");
assert.ok(publicRule?.disallow?.includes("/api/"));
assert.ok(publicRule?.disallow?.includes("/profile"));
assert.ok(!publicRule?.disallow?.includes("/deploy-mainnet"), "robots.txt must not advertise hidden operator routes");

const sitemapUrls = sitemap().map((entry) => entry.url);
for (const route of ["/", "/runners", "/launch", "/status", "/sources", "/sushi", "/rescue"]) {
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

const rescueSource = readFileSync(new URL("../app/rescue/page.tsx", import.meta.url), "utf8");
assert.match(rescueSource, /openGraph:[\s\S]*?url:\s*"\/rescue"/);

const chromeSource = readFileSync(new URL("../app/public-chrome.tsx", import.meta.url), "utf8");
const mobileDock = chromeSource.match(/<nav className=\{`mobileDock[\s\S]*?<\/nav>/)?.[0];
assert.ok(mobileDock, "Mobile navigation must remain present");
assert.match(mobileDock, /href="\/runners"/);
assert.doesNotMatch(mobileDock, /href="\/status"/);
assert.match(chromeSource, /Help &amp; safety[\s\S]*?href="\/status"/);
assert.doesNotMatch(chromeSource, /const MORE_PREFIXES = \[[^\]]*"\/runners"/);

console.info("Public discovery smoke test passed");
