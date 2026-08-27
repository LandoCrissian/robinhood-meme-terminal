import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { externalChartRefreshMs } from "../external-ohlcv";
import { VNEXT_CLIENT_REFRESH_POLICY, visibilityRefreshDelay } from "./client-refresh-policy";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const visibilityHook = source("../../app/vnext/use-visibility-refresh.ts");
const directory = source("../../app/vnext/use-vnext-market-directory.ts");
const workspace = source("../../app/vnext/use-vnext-asset-workspace.ts");
const chart = source("../../app/vnext/vnext-market-chart.tsx");
const wallet = source("../../app/vnext/use-vnext-wallet-assets.ts");
const spendBalance = source("../../app/vnext/spend-balance.tsx");
const tradeComposer = source("../../app/vnext/trade-intent-composer.tsx");
const layout = source("../../app/layout.tsx");

assert.equal(VNEXT_CLIENT_REFRESH_POLICY.marketDirectoryMs, 300_000);
assert.equal(VNEXT_CLIENT_REFRESH_POLICY.ecosystemDirectoryMs, 300_000);
assert.equal(VNEXT_CLIENT_REFRESH_POLICY.assetWorkspaceMs, 60_000);
assert.equal(VNEXT_CLIENT_REFRESH_POLICY.walletBalanceMs, 60_000);
assert.equal(VNEXT_CLIENT_REFRESH_POLICY.walletDiscoveryMs, 300_000);
assert.equal(VNEXT_CLIENT_REFRESH_POLICY.ethPriceMs, 300_000);
assert.equal(externalChartRefreshMs("5M"), 15_000);
assert.ok(externalChartRefreshMs("15M") >= 20_000);
assert.ok(externalChartRefreshMs("1H") >= 30_000);
assert.equal(visibilityRefreshDelay(null, 60_000, 100_000), 0);
assert.equal(visibilityRefreshDelay(90_000, 60_000, 100_000), 50_000);
assert.equal(visibilityRefreshDelay(20_000, 60_000, 100_000), 0);

assert.match(visibilityHook, /document\.visibilityState === "hidden"/);
assert.match(visibilityHook, /visibilitychange/);
assert.match(visibilityHook, /running/);
assert.doesNotMatch(visibilityHook, /setInterval/);

for (const publicReadClient of [directory, workspace, chart, spendBalance]) {
  assert.match(publicReadClient, /useVisibilityRefresh/);
  assert.doesNotMatch(publicReadClient, /cache: "no-store"/);
  assert.doesNotMatch(publicReadClient, /setInterval/);
}

assert.match(wallet, /useVisibilityRefresh/);
assert.match(wallet, /VNEXT_CLIENT_REFRESH_POLICY\.walletDiscoveryMs/);
assert.match(wallet, /cache: "no-store"/);
assert.doesNotMatch(wallet, /setInterval/);
const immediateSearch = directory.slice(
  directory.indexOf("const submitUniversalSearch ="),
  directory.indexOf("const refresh =")
);
assert.match(immediateSearch, /\/api\/vnext\/market-search/);
assert.doesNotMatch(immediateSearch, /marketDirectoryMs|ecosystemDirectoryMs/);
const immediateSelection = directory.slice(
  directory.indexOf("const selectAddress"),
  directory.indexOf("const clearUniversalSearch")
);
assert.match(immediateSelection, /\/api\/vnext\/asset-identity/);
assert.match(immediateSelection, /\/api\/markets\/external/);
assert.doesNotMatch(immediateSelection, /marketDirectoryMs|ecosystemDirectoryMs/);
assert.match(spendBalance, /refreshBalances\.current\(false\)/);
assert.match(tradeComposer, /document\.visibilityState === "hidden"/);
assert.match(tradeComposer, /visibilitychange/);
assert.match(layout, /<meta property="og:site_name" content=\{RMT_SITE_NAME\} \/>/);

console.log("RMT VNext client efficiency checks passed.");
