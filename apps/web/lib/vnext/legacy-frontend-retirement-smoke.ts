import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("../../app/", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const retiredPresentationFiles = [
  "legacy-terminal-page.tsx",
  "responsive-external-market-feed.tsx",
  "external-market-feed.tsx",
  "external-market-feed-v10.tsx",
  "external-market-workspace.tsx",
  "portfolio-panel.tsx",
  "professional-terminal.css",
  "terminal-v7.css",
  "terminal-v8.css",
  "terminal-desktop-v9.css",
  "terminal-high-end-v10.css",
  "execution-reliability-v11.css",
  "terminal-trader-control-v12.css"
];
for (const file of retiredPresentationFiles) {
  assert.equal(existsSync(join(appDirectory, file)), false, `${file} must remain retired.`);
}

const rootPage = readFileSync(join(appDirectory, "page.tsx"), "utf8");
const rootLayout = readFileSync(join(appDirectory, "layout.tsx"), "utf8");
const shell = readFileSync(join(appDirectory, "vnext/vnext-terminal-shell.tsx"), "utf8");
const marketCompatibilityRoute = readFileSync(join(appDirectory, "market/[address]/page.tsx"), "utf8");
const portfolioCompatibilityRoute = readFileSync(join(appDirectory, "portfolio/page.tsx"), "utf8");
const publicChrome = readFileSync(join(appDirectory, "public-chrome.tsx"), "utf8");
const sitemap = readFileSync(join(appDirectory, "sitemap.ts"), "utf8");

assert.match(rootPage, /<VNextTerminalShell \/>/);
assert.doesNotMatch(rootPage, /LegacyTerminalPage|ExternalMarketFeed/);

const globalCssImports = [...rootLayout.matchAll(/^import\s+["'](.+\.css)["'];$/gm)].map((match) => match[1]);
assert.ok(globalCssImports.length > 0);
assert.ok(globalCssImports.includes("./styles.css"));
for (const stylesheet of globalCssImports) {
  assert.doesNotMatch(
    stylesheet,
    /terminal-v(?:7|8|9|10|11|12)|professional-terminal|external-workspace|workspace-v8|automation-v8/,
    `${stylesheet} reintroduced a retired global terminal generation.`
  );
}

assert.match(shell, /new URLSearchParams\(window\.location\.search\)/);
assert.match(shell, /entry\.get\("market"\)/);
assert.match(shell, /entry\.get\("panel"\) === "portfolio"/);
assert.match(shell, /initialSide === "buy" \|\| initialSide === "sell"/);
assert.match(shell, /void selectAddress\(initialMarket\)/);

assert.match(marketCompatibilityRoute, /redirect\(`\/\?\$\{query\}`\)/);
assert.match(marketCompatibilityRoute, /new URLSearchParams\(\{ market: getAddress\(address\) \}\)/);
assert.match(marketCompatibilityRoute, /side === "buy" \|\| side === "sell"/);
assert.doesNotMatch(marketCompatibilityRoute, /ExternalMarketWorkspace|fetchPublicMarket|publicMarketStructuredData/);
assert.match(portfolioCompatibilityRoute, /redirect\("\/\?panel=portfolio"\)/);
assert.doesNotMatch(portfolioCompatibilityRoute, /PortfolioPanel/);
assert.match(publicChrome, /href="\/\?panel=portfolio"/);
assert.doesNotMatch(sitemap, /fetchPublicMarketCatalog|publicMarketSitemapPaths/);

const retiredImports = /legacy-terminal-page|responsive-external-market-feed|external-market-feed-v10|external-market-workspace|portfolio-panel/;
for (const path of sourceFiles(appDirectory)) {
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, retiredImports, `${path} references a retired presentation module.`);
}

for (const route of [
  "api/vnext/quotes/route.ts",
  "api/vnext/verify/route.ts",
  "api/vnext/authorize/route.ts",
  "api/vnext/funding/across/quote/route.ts"
]) {
  assert.equal(existsSync(join(appDirectory, route)), true, `${route} is shared execution infrastructure and must be preserved.`);
}

console.log("Legacy frontend retirement boundary passed.");
