import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import {
  BROAD_TOKEN_MARKETS,
  TOKEN_MARKETS,
  VISIBLE_TOKEN_MARKETS,
  canonicalDirectoryMarkets
// @ts-expect-error the test-only JavaScript browser fixture has no emitted declaration.
} from "../../../../scripts/visual-qa/legion-fixtures.mjs";
import {
  directoryMarketFromExactLookup,
  directoryMarketFromVerifiedIdentity,
  hasVNextObservedRecentActivity,
  isVNextDirectoryMarketSelectable,
  mergeVNextCanonicalBrowseMarkets,
  selectVNextMarketDirectoryView,
  shouldUseExactAddressDegradedFallback,
  type VNextDirectoryMarket
} from "./market-directory";
import { ROBINHOOD_NATIVE_ASSET_ADDRESS } from "./robinhood-assets";
import { requireVNextExecutionProvider } from "../server/vnext-execution-eligibility";

const providers = ["sushi", "uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"] as const;
type FixtureMarket = VNextDirectoryMarket & {
  executionFixture?: "EXECUTION_ELIGIBLE_V2" | "EXECUTION_ELIGIBLE_V3";
  heldFixture?: boolean;
};
const curated = TOKEN_MARKETS as VNextDirectoryMarket[];
const broad = BROAD_TOKEN_MARKETS as FixtureMarket[];
const visible = VISIBLE_TOKEN_MARKETS as VNextDirectoryMarket[];

assert.equal(curated.length, 8);
assert.ok(visible.length > curated.length, "The deterministic ALL surface must materially exceed the canonical-only fixture");
assert.equal(new Set(visible.map((market) => market.address.toLowerCase())).size, visible.length);
for (const market of curated) {
  assert.ok(visible.some((candidate) => candidate.address.toLowerCase() === market.address.toLowerCase()), `Canonical market disappeared: ${market.symbol}`);
}

const merged = mergeVNextCanonicalBrowseMarkets(canonicalDirectoryMarkets() as VNextDirectoryMarket[], visible);
assert.equal(merged.length, visible.length, "Canonical seeds and broad enrichment must merge without duplicate rows");
assert.equal(mergeVNextCanonicalBrowseMarkets(canonicalDirectoryMarkets() as VNextDirectoryMarket[], []).length, 8, "Broad-provider outage must preserve all canonical markets");

const active = selectVNextMarketDirectoryView(visible, "active");
assert.ok(active.length > 0);
assert.ok(active.every(hasVNextObservedRecentActivity), "ACTIVE may contain only actual recent activity evidence");
const trending = selectVNextMarketDirectoryView(visible, "trending");
assert.ok(trending.length > 0);
assert.ok(trending.every((market) => market.signal === "moving" || market.signal === "early"));
const newest = selectVNextMarketDirectoryView(visible, "new");
assert.ok(newest.length > 0);
assert.ok(newest.every((market) => market.ageMinutes !== null && market.ageMinutes <= 24 * 60));

const nonCuratedV2 = broad.find((market) => market.executionFixture === "EXECUTION_ELIGIBLE_V2")!;
const nonCuratedV3 = broad.find((market) => market.executionFixture === "EXECUTION_ELIGIBLE_V3")!;
const nonCuratedV4 = broad.find((market) => market.dexId === "uniswap-v4")!;
const unsupported = broad.find((market) => market.dexId === "observed-dex")!;
assert.doesNotThrow(() => requireVNextExecutionProvider(ROBINHOOD_NATIVE_ASSET_ADDRESS, getAddress(nonCuratedV2.address), "uniswap-v2", providers));
assert.doesNotThrow(() => requireVNextExecutionProvider(ROBINHOOD_NATIVE_ASSET_ADDRESS, getAddress(nonCuratedV3.address), "uniswap-v3", providers));
assert.throws(() => requireVNextExecutionProvider(ROBINHOOD_NATIVE_ASSET_ADDRESS, getAddress(nonCuratedV4.address), "uniswap-v4", providers));
assert.throws(() => requireVNextExecutionProvider(ROBINHOOD_NATIVE_ASSET_ADDRESS, getAddress(unsupported.address), "sushi", providers));
assert.ok(visible.some((market) => market.address === unsupported.address), "Unsupported DEX markets remain visible");

const exact = directoryMarketFromExactLookup({ markets: [nonCuratedV2] } as never, nonCuratedV2.address);
assert.equal(exact?.address, nonCuratedV2.address, "An exact non-curated contract with market evidence must open a workspace");
const identityOnly = directoryMarketFromVerifiedIdentity({
  resolution: {
    chainId: 4_663,
    requestedAddress: nonCuratedV3.address,
    requestedKind: "token",
    status: "token-only",
    token: { address: nonCuratedV3.address, name: "Identity Only", symbol: "IDENTITY", decimals: 18, totalSupply: "1000000000000000000" }
  }
} as never, nonCuratedV3.address);
assert.ok(identityOnly && isVNextDirectoryMarketSelectable(identityOnly));
assert.equal(identityOnly && identityOnly.verifiedMarkets, undefined, "Asset-only state must not invent market evidence");
assert.equal(shouldUseExactAddressDegradedFallback(nonCuratedV2.address, "not_listed"), true);
assert.equal(shouldUseExactAddressDegradedFallback(nonCuratedV2.address, "not_found"), true);

const partial = broad.find((market) => market.symbol === "PARTIAL")!;
assert.equal(partial.marketCapUsd, null);
assert.notEqual(partial.fdvUsd, null, "FDV evidence remains independent when market cap is unavailable");
assert.ok(broad.some((market) => market.heldFixture), "Held non-curated fixture coverage is required");

const externalRoute = readFileSync(new URL("../../app/api/markets/external/route.ts", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const quoteRoute = readFileSync(new URL("../../app/api/vnext/quotes/route.ts", import.meta.url), "utf8");
const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const tradeComposer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(externalRoute, /fetchGeckoPoolSnapshot\(\)/);
assert.match(externalRoute, /marketCapUsd = evidence\.marketCapUsd;/);
assert.doesNotMatch(externalRoute, /marketCapUsd = evidence\.marketCapUsd \?\? evidence\.fdvUsd/);
assert.doesNotMatch(externalRoute, /marketCapUsd: evidence\.marketCapUsd \?\? evidence\.fdvUsd/);
assert.match(externalRoute, /applyProjectIdentityDirectoryAdmission\(\[\.\.\.marketsByToken\.values\(\)\]\)/);
assert.doesNotMatch(externalRoute, /curatedMarkets = \[\.\.\.marketsByToken\.values\(\)\]\.filter/);
assert.doesNotMatch(hook, /canonicalPayload\?\.status === "not_listed"[\s\S]{0,250}return undefined/);
for (const source of [quoteRoute, verifyRoute, authorizeRoute]) {
  assert.doesNotMatch(source, /requireRmtCuratedExecutionAssets/);
  assert.doesNotMatch(source, /target:\s*z\.|calldata:\s*z\.|value:\s*z\./, "Browser-controlled transaction fields must not enter quote/verify/authorize intent schemas");
  assert.match(source, /requireProjectIdentityDirectoryAdmitted/);
}
assert.match(tradeComposer, /Trading route not verified by RMT/);
assert.match(tradeComposer, /Market data available · trading unavailable/);

console.info(`Token Terminal trade-worthy integration smoke passed (${curated.length} canonical; ${visible.length} deterministic visible)`);
