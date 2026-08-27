import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveVNextMarketState,
  directoryMarketFromUniversalSearchResult,
  directoryMarketFromVerifiedIdentity,
  exactVNextLocalDirectoryMatches,
  filterVNextLocalDirectoryMarkets,
  isVNextDirectoryMarketSelectable,
  mergeVNextDirectoryAndSearchMarkets,
  selectVNextMarketDirectoryView,
  shouldRequestVNextExternalWorkspaceMarket,
  shouldUseExactAddressDegradedFallback,
  verifiedDirectoryAsset,
  vNextExecutionUiState,
  vNextSelectedMarketExecutionState,
  type VNextDirectoryMarket
} from "./market-directory";
import {
  parseVNextUniversalMarketSearchPool,
  parseVNextUniversalMarketSearchResult,
  type VNextUniversalMarketSearchMatchedBy,
  type VNextUniversalMarketSearchPool
} from "./universal-market-search-contract";

const STONKBROKER = "0xe934e36a439c94017b64a3fece66af12099abf50";
const TOKEN_TWO = "0x1111111111111111111111111111111111111111";
const TOKEN_THREE = "0x2222222222222222222222222222222222222222";
const V2_POOL = "0x3333333333333333333333333333333333333333";
const V3_POOL = "0x4444444444444444444444444444444444444444";
const V4_POOL = `0x${"55".repeat(32)}`;
const HASH = `0x${"66".repeat(32)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

function pool(version: 2 | 3 | 4): VNextUniversalMarketSearchPool {
  return {
    sourceId: version === 4 ? "uniswap-v4" : version === 3 ? "uniswap-v3" : "uniswap-v2",
    protocol: "uniswap",
    version,
    poolKey: version === 4 ? V4_POOL : version === 3 ? V3_POOL : V2_POOL,
    poolAddress: version === 4 ? null : version === 3 ? V3_POOL : V2_POOL,
    token0: STONKBROKER,
    token1: TOKEN_TWO,
    stable: null,
    fee: version === 2 ? null : 3_000,
    tickSpacing: version === 2 ? null : 60,
    hooks: version === 4 ? "0x0000000000000000000000000000000000000000" : null,
    transactionHash: HASH,
    blockNumber: "123456",
    blockHash: HASH,
    stateStatus: null,
    liveFee: null,
    feeDenominator: null,
    gaugeAddress: null,
    gaugeAlive: null,
    gaugeWeight: null,
    gaugeClaimable: null,
    feesAddress: null,
    bribeAddress: null,
    stateObservedBlock: null,
    stateObservedBlockHash: null
  };
}

function response(query: string, matchedBy: VNextUniversalMarketSearchMatchedBy, markets = [pool(4)]) {
  return {
    query,
    queryKind: query === V4_POOL ? "v4-pool-id" : query.startsWith("0x") ? "token-or-pool-address" : "text",
    status: "found",
    results: [{
      address: STONKBROKER,
      name: "StonkBroker",
      symbol: "STONKBROKER",
      decimals: 18,
      matchedBy,
      markets
    }]
  };
}

const parsedVariants = [
  ["STONKBROKER", "symbol"],
  ["StonkBroker", "name"],
  ["StonkBrokers", "plural-alias"],
  ["$STONKBROKER", "symbol"],
  [STONKBROKER, "token"],
  [V4_POOL, "pool-id"]
] as const;
for (const [query, matchedBy] of parsedVariants) {
  const parsed = parseVNextUniversalMarketSearchResult(response(query, matchedBy));
  assert.equal(parsed?.status, "found");
  assert.equal(parsed?.results[0].address, STONKBROKER);
  const directory = directoryMarketFromUniversalSearchResult(parsed!.results[0]);
  assert.equal(directory.address.toLowerCase(), STONKBROKER);
  assert.equal(verifiedDirectoryAsset(directory)?.id.locator.kind, "contract");
}

const parsedTokenOnly = parseVNextUniversalMarketSearchResult(
  response(TOKEN_THREE, "token", [])
);
assert.equal(parsedTokenOnly?.status, "found");
assert.equal(parsedTokenOnly?.results.length, 1);
assert.deepEqual(parsedTokenOnly?.results[0].markets, []);
const tokenOnlyDirectory = directoryMarketFromUniversalSearchResult(
  parsedTokenOnly!.results[0]
);
assert.equal(isVNextDirectoryMarketSelectable(tokenOnlyDirectory), true);
assert.deepEqual(deriveVNextMarketState(tokenOnlyDirectory), {
  asset: "verified",
  market: "none",
  metrics: "unavailable",
  chart: "unavailable",
  execution: "not-evaluated"
});
assert.equal(vNextSelectedMarketExecutionState(tokenOnlyDirectory), "asset-only");
assert.equal(vNextExecutionUiState("asset-only", true), "asset-only");
assert.equal(vNextExecutionUiState("asset-only", false), "asset-only");
assert.equal(parseVNextUniversalMarketSearchResult(response(V2_POOL, "pool", [])), null);
assert.equal(parseVNextUniversalMarketSearchResult(response(V4_POOL, "pool-id", [])), null);

for (const version of [2, 3, 4] as const) {
  const parsed = parseVNextUniversalMarketSearchResult(response(
    version === 4 ? V4_POOL : version === 3 ? V3_POOL : V2_POOL,
    version === 4 ? "pool-id" : "pool",
    [pool(version)]
  ));
  assert.equal(parsed?.results[0].markets[0].version, version);
}

const nativeV4Pool = {
  ...pool(4),
  token0: ZERO_ADDRESS,
  token1: STONKBROKER
};
const parsedNativeV4Pool = parseVNextUniversalMarketSearchPool(nativeV4Pool);
assert.ok(parsedNativeV4Pool);
assert.equal(parsedNativeV4Pool.token0, ZERO_ADDRESS);
assert.equal(parsedNativeV4Pool.token1, STONKBROKER);
assert.equal(parsedNativeV4Pool.poolKey, V4_POOL);
assert.equal(parsedNativeV4Pool.poolAddress, null);
assert.equal(parseVNextUniversalMarketSearchPool({ ...nativeV4Pool, token1: ZERO_ADDRESS }), null);
assert.equal(
  parseVNextUniversalMarketSearchPool({ ...nativeV4Pool, sourceId: "uniswap-v3" }),
  null
);
assert.equal(
  parseVNextUniversalMarketSearchPool({ ...nativeV4Pool, protocol: "sushiswap" }),
  null
);
for (const version of [2, 3] as const) {
  assert.equal(
    parseVNextUniversalMarketSearchPool({ ...pool(version), token0: ZERO_ADDRESS }),
    null
  );
  assert.equal(
    parseVNextUniversalMarketSearchPool({ ...pool(version), token1: ZERO_ADDRESS }),
    null
  );
}
assert.equal(
  parseVNextUniversalMarketSearchPool({
    ...nativeV4Pool,
    sourceId: "sushiswap-v3",
    protocol: "sushiswap",
    version: 3,
    poolKey: V3_POOL,
    poolAddress: V3_POOL,
    fee: 3_000,
    tickSpacing: 60,
    hooks: null
  }),
  null
);

const v4Directory = directoryMarketFromUniversalSearchResult(
  parseVNextUniversalMarketSearchResult(response(V4_POOL, "pool-id"))!.results[0]
);
assert.equal(v4Directory.canonicalMarkets?.[0].poolKey, V4_POOL);
assert.equal(v4Directory.canonicalMarkets?.[0].poolAddress, null);
assert.equal(v4Directory.canonicalMarkets?.[0].hooks, "0x0000000000000000000000000000000000000000");
assert.equal(v4Directory.priceUsd, null);
assert.equal(v4Directory.liquidityUsd, null);
assert.equal(v4Directory.volume5m, null);
assert.equal(v4Directory.volume1h, null);
assert.equal(v4Directory.buys1h, null);
assert.equal(v4Directory.sells1h, null);
assert.equal(v4Directory.momentumScore, null);
assert.equal(v4Directory.volume24h, null);
assert.equal(v4Directory.marketCapUsd, null);
assert.equal(v4Directory.priceChange24h, null);
assert.equal(v4Directory.ageMinutes, null);
assert.equal(v4Directory.signal, null);
assert.deepEqual(deriveVNextMarketState(v4Directory), {
  asset: "verified",
  market: "canonical",
  metrics: "unavailable",
  chart: "unavailable",
  execution: "not-evaluated"
});
assert.equal(shouldRequestVNextExternalWorkspaceMarket(v4Directory), false);
assert.equal(isVNextDirectoryMarketSelectable(v4Directory), true);
assert.deepEqual(selectVNextMarketDirectoryView([v4Directory], "trending"), []);
assert.deepEqual(selectVNextMarketDirectoryView([v4Directory], "active"), []);

const richDirectory: VNextDirectoryMarket = {
  ...v4Directory,
  priceUsd: 1.25,
  liquidityUsd: 20_000,
  marketCapUsd: 1_000_000,
  volume5m: 250,
  volume1h: 2_000,
  volume24h: 5_000,
  priceChange5m: 1,
  priceChange1h: 2,
  priceChange24h: 2,
  buys5m: 4,
  sells5m: 2,
  buys1h: 12,
  sells1h: 8,
  buys24h: 60,
  sells24h: 50,
  pairCreatedAt: 1_700_000_000_000,
  ageMinutes: 60,
  momentumScore: 70,
  buyPressureBps: 6_000,
  riskFlags: [],
  signal: "moving"
};
const merged = mergeVNextDirectoryAndSearchMarkets([richDirectory], [v4Directory]);
assert.equal(merged.length, 1);
assert.equal(merged[0].priceUsd, 1.25);
assert.equal(merged[0].liquidityUsd, 20_000);
assert.equal(merged[0].volume1h, 2_000);
assert.equal(merged[0].buys1h, 12);
assert.equal(merged[0].momentumScore, 70);
assert.equal(merged[0].canonicalMarkets?.[0].poolKey, V4_POOL);
assert.equal(deriveVNextMarketState(merged[0]).market, "canonical");
assert.equal(deriveVNextMarketState(merged[0]).metrics, "complete");
assert.deepEqual(mergeVNextDirectoryAndSearchMarkets([richDirectory], []), [richDirectory]);

assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], "STONKBROKER").map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], "Stonk Broker").map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], "$STONKBROKER").map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], STONKBROKER).map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], V4_POOL).map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.equal(exactVNextLocalDirectoryMatches([richDirectory], "STONKBROKER").length, 1);

assert.equal(shouldUseExactAddressDegradedFallback(STONKBROKER, "inventory_unavailable"), true);
assert.equal(shouldUseExactAddressDegradedFallback(STONKBROKER, "unavailable"), true);
assert.equal(shouldUseExactAddressDegradedFallback(STONKBROKER, "not_found"), false);
assert.equal(shouldUseExactAddressDegradedFallback(STONKBROKER, "invalid_query"), false);
assert.equal(shouldUseExactAddressDegradedFallback("STONKBROKER", "inventory_unavailable"), false);
assert.equal(shouldUseExactAddressDegradedFallback(V4_POOL, "inventory_unavailable"), false);
assert.equal(shouldUseExactAddressDegradedFallback(`0x${"0".repeat(40)}`, "inventory_unavailable"), false);

const identityOnly = directoryMarketFromVerifiedIdentity({
  resolution: {
    chainId: 4_663,
    requestedAddress: TOKEN_THREE,
    requestedKind: "token",
    status: "token-only",
    token: {
      address: TOKEN_THREE,
      name: "Identity Only",
      symbol: "IDENTITY",
      decimals: 18,
      totalSupply: "1000000000000000000"
    },
    pools: [],
    marketData: "identity-only",
    execution: "view-only",
    provenance: "robinhood-chain-contract-reads",
    resolvedAt: new Date(0).toISOString()
  }
}, TOKEN_THREE);
assert.ok(identityOnly);
assert.equal(identityOnly.canonicalMarkets, undefined);
assert.deepEqual(selectVNextMarketDirectoryView([identityOnly], "trending"), []);
assert.deepEqual(selectVNextMarketDirectoryView([identityOnly], "active"), []);

const duplicateName = directoryMarketFromUniversalSearchResult({
  ...parseVNextUniversalMarketSearchResult(response("STONKBROKER", "symbol"))!.results[0],
  address: TOKEN_THREE,
  markets: [{ ...pool(3), token0: TOKEN_THREE }]
});
assert.equal(exactVNextLocalDirectoryMatches([v4Directory, duplicateName], "STONKBROKER").length, 2);
assert.equal(exactVNextLocalDirectoryMatches([v4Directory, duplicateName], "StonkBroker").length, 2);
assert.equal(mergeVNextDirectoryAndSearchMarkets([], [v4Directory, duplicateName]).length, 2);

for (const status of ["not_found", "not_admitted", "inventory_unavailable", "candidate_discovery_unavailable", "invalid_query"] as const) {
  const parsed = parseVNextUniversalMarketSearchResult({
    query: "missing",
    queryKind: "text",
    status,
    results: []
  });
  assert.equal(parsed?.status, status);
}

assert.equal(parseVNextUniversalMarketSearchResult({ ...response("STONKBROKER", "symbol"), results: [{ ...response("STONKBROKER", "symbol").results[0], markets: [{ ...pool(4), poolAddress: V2_POOL }] }] }), null);

const hook = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../app/vnext/vnext-asset-workspace.tsx", import.meta.url), "utf8");
const workspaceHook = readFileSync(new URL("../../app/vnext/use-vnext-asset-workspace.ts", import.meta.url), "utf8");
const serverSearch = readFileSync(new URL("../server/vnext-universal-market-search.ts", import.meta.url), "utf8");

const updateQuery = shell.slice(shell.indexOf("const updateQuery"), shell.indexOf("const selectMarket"));
assert.doesNotMatch(updateQuery, /fetch\(|submitUniversalSearch/);
assert.match(shell, /UNIVERSAL_SEARCH_DEBOUNCE_MS = 400/);
assert.match(shell, /MINIMUM_AUTO_SEARCH_QUERY_LENGTH = 2/);
const passiveSearch = shell.slice(
  shell.indexOf("const searchQuery = query.trim()"),
  shell.indexOf("const writeLocation")
);
assert.match(passiveSearch, /searchQuery\.length < MINIMUM_AUTO_SEARCH_QUERY_LENGTH/);
assert.match(passiveSearch, /window\.setTimeout/);
assert.match(passiveSearch, /submitUniversalSearch\(searchQuery\)/);
assert.doesNotMatch(passiveSearch, /selectMarket|writeLocation|setContext/);
assert.match(presentation, /onChange=\{\(event\) => setQuery\(event\.target\.value\)\}/);
assert.match(presentation, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onSubmit\(\); \}\}/);
assert.match(shell, /exactVNextLocalDirectoryMatches/);
assert.match(shell, /exactLocalMatches\.length === 1/);
assert.match(shell, /submitUniversalSearch\(submitted\)/);
const submitSearch = shell.slice(shell.indexOf("const submitSearch"), shell.indexOf("const showPortfolio"));
assert.ok(submitSearch.indexOf("submitUniversalSearch(submitted)") < submitSearch.indexOf("shouldUseExactAddressDegradedFallback"));
assert.match(submitSearch, /shouldUseExactAddressDegradedFallback\(submitted, result\.status\)/);
assert.match(submitSearch, /selectMarket\(submitted\)/);
assert.match(shell, /result\.markets\.length === 1/);
assert.match(hook, /new AbortController\(\)/);
assert.match(hook, /searchController\.current\?\.abort\(\)/);
assert.match(hook, /requestSequence !== searchSequence\.current/);
assert.match(hook, /searchMarketsRef\.current = nextMarkets/);
assert.match(hook, /\/api\/vnext\/market-search\?\$\{parameters\}/);
assert.doesNotMatch(hook, /cache: "no-store"/);
assert.match(hook, /UNIVERSAL_SEARCH_TIMEOUT_MS = 6_000/);
assert.match(serverSearch, /SERVER_INTERNAL_DEADLINE_MS = 4_000/);
assert.ok(
  serverSearch.indexOf("SERVER_INTERNAL_DEADLINE_MS = 4_000") >= 0
  && hook.indexOf("UNIVERSAL_SEARCH_TIMEOUT_MS = 6_000") >= 0,
  "the bounded server search deadline must leave a meaningful margin before the client aborts"
);
assert.match(hook, /status: "aborted"/);
assert.match(hook, /canonicalPayload\?\.status === "not_admitted"/);
assert.match(hook, /marketPayload\?\.directoryAdmission === "not_admitted"/);
assert.match(shell, /mergeVNextDirectoryAndSearchMarkets/);
assert.match(shell, /clearUniversalSearch\(\);[\s\S]*setQuery\(nextQuery\)/);
assert.match(presentation, /Search token, contract or pool/);
assert.match(presentation, /rmtSearchContract/);
assert.match(presentation, /count=\{props\.expandedSearchResultCount\}/);
assert.match(presentation, /Not admitted to the RMT directory\./);
assert.doesNotMatch(presentation, /SearchStatusMessage status=\{props\.searchStatus\} count=\{props\.filteredMarkets\.length\}/);
assert.match(shell, /expandedSearchResultCount:[\s\S]*searchMarkets\.length/);
assert.match(workspace, /shouldRequestVNextExternalWorkspaceMarket\(directoryMarket\)/);
assert.doesNotMatch(workspace, /fallbackMarketFromResolution/);
assert.doesNotMatch(workspace, /volume5m:\s*0|buys5m:\s*0|sells5m:\s*0|momentumScore:\s*0|buyPressureBps:\s*0/);
assert.match(workspace, /canonicalMarkets=\{directoryMarket\.canonicalMarkets\}/);
assert.match(workspace, /PoolId \$\{shortAddress\(pool\.poolKey\)\}/);
assert.doesNotMatch(workspace, /address\/\$\{pool\.poolKey\}/);
assert.ok(workspace.indexOf("if (canonicalMarkets?.length)") < workspace.indexOf("No canonical market evidence attached"));
assert.match(workspace, /executionState === "asset-only"/);
assert.match(workspace, /No supported market evidence is attached, so execution is not evaluated/);
assert.match(presentation, /executionUiState === "asset-only"/);
assert.match(presentation, /Market evidence unavailable/);
assert.match(presentation, /<button type="button" className="isViewOnly" disabled aria-describedby="rmt-asset-only">Asset only<\/button>/);
assert.match(shell, /if \(selectedExecutionState !== "normal"\) return/);
assert.match(workspaceHook, /externalMarketLookup\s*\?/);
assert.match(serverSearch, /from "\.\.\/vnext\/universal-market-search-contract"/);
assert.match(serverSearch, /function publicMarket/);
assert.doesNotMatch(serverSearch, /export type VNextUniversalMarketSearchResult\s*=/);
assert.doesNotMatch(serverSearch, /stateError: pool\.stateError/);
assert.doesNotMatch(hook + shell + presentation, /rmt-market-indexer-shadow-production|RMT_MARKET_INDEXER_READ_TOKEN|sendTransaction|signTransaction|writeContract/);

console.log("VNext Terminal universal search integration preserves local-first filtering, debounced passive expansion, canonical evidence, null metrics, ambiguity, and race-safe explicit submission.");
