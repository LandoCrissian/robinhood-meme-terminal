import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  directoryMarketFromUniversalSearchResult,
  exactVNextLocalDirectoryMatches,
  filterVNextLocalDirectoryMarkets,
  mergeVNextDirectoryAndSearchMarkets,
  selectVNextMarketDirectoryView,
  verifiedDirectoryAsset,
  type VNextDirectoryMarket
} from "./market-directory";
import {
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

for (const version of [2, 3, 4] as const) {
  const parsed = parseVNextUniversalMarketSearchResult(response(
    version === 4 ? V4_POOL : version === 3 ? V3_POOL : V2_POOL,
    version === 4 ? "pool-id" : "pool",
    [pool(version)]
  ));
  assert.equal(parsed?.results[0].markets[0].version, version);
}

const v4Directory = directoryMarketFromUniversalSearchResult(
  parseVNextUniversalMarketSearchResult(response(V4_POOL, "pool-id"))!.results[0]
);
assert.equal(v4Directory.canonicalMarkets?.[0].poolKey, V4_POOL);
assert.equal(v4Directory.canonicalMarkets?.[0].poolAddress, null);
assert.equal(v4Directory.canonicalMarkets?.[0].hooks, "0x0000000000000000000000000000000000000000");
assert.equal(v4Directory.priceUsd, null);
assert.equal(v4Directory.liquidityUsd, null);
assert.equal(v4Directory.volume24h, null);
assert.equal(v4Directory.marketCapUsd, null);
assert.equal(v4Directory.priceChange24h, null);
assert.equal(v4Directory.ageMinutes, null);
assert.equal(v4Directory.signal, null);
assert.equal(v4Directory.marketDataState, "canonical-only");
assert.deepEqual(selectVNextMarketDirectoryView([v4Directory], "trending"), []);
assert.deepEqual(selectVNextMarketDirectoryView([v4Directory], "active"), []);

const richDirectory: VNextDirectoryMarket = {
  ...v4Directory,
  priceUsd: 1.25,
  liquidityUsd: 20_000,
  marketCapUsd: 1_000_000,
  volume24h: 5_000,
  priceChange24h: 2,
  ageMinutes: 60,
  signal: "moving",
  marketDataState: "live"
};
const merged = mergeVNextDirectoryAndSearchMarkets([richDirectory], [v4Directory]);
assert.equal(merged.length, 1);
assert.equal(merged[0].priceUsd, 1.25);
assert.equal(merged[0].liquidityUsd, 20_000);
assert.equal(merged[0].canonicalMarkets?.[0].poolKey, V4_POOL);
assert.deepEqual(mergeVNextDirectoryAndSearchMarkets([richDirectory], []), [richDirectory]);

assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], "STONKBROKER").map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], "Stonk Broker").map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], "$STONKBROKER").map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], STONKBROKER).map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.deepEqual(filterVNextLocalDirectoryMarkets([richDirectory], V4_POOL).map((market) => market.address.toLowerCase()), [STONKBROKER]);
assert.equal(exactVNextLocalDirectoryMatches([richDirectory], "STONKBROKER").length, 1);

const duplicateName = directoryMarketFromUniversalSearchResult({
  ...parseVNextUniversalMarketSearchResult(response("STONKBROKER", "symbol"))!.results[0],
  address: TOKEN_THREE,
  markets: [{ ...pool(3), token0: TOKEN_THREE }]
});
assert.equal(exactVNextLocalDirectoryMatches([v4Directory, duplicateName], "STONKBROKER").length, 2);
assert.equal(exactVNextLocalDirectoryMatches([v4Directory, duplicateName], "StonkBroker").length, 2);
assert.equal(mergeVNextDirectoryAndSearchMarkets([], [v4Directory, duplicateName]).length, 2);

for (const status of ["not_found", "inventory_unavailable", "candidate_discovery_unavailable", "invalid_query"] as const) {
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

const updateQuery = shell.slice(shell.indexOf("const updateQuery"), shell.indexOf("const selectMarket"));
assert.doesNotMatch(updateQuery, /fetch\(|submitUniversalSearch/);
assert.match(presentation, /onChange=\{\(event\) => setQuery\(event\.target\.value\)\}/);
assert.match(presentation, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onSubmit\(\); \}\}/);
assert.match(shell, /exactVNextLocalDirectoryMatches/);
assert.match(shell, /exactLocalMatches\.length === 1/);
assert.match(shell, /submitUniversalSearch\(submitted\)/);
assert.match(shell, /result\.markets\.length === 1/);
assert.match(hook, /new AbortController\(\)/);
assert.match(hook, /searchController\.current\?\.abort\(\)/);
assert.match(hook, /requestSequence !== searchSequence\.current/);
assert.match(hook, /searchMarketsRef\.current = nextMarkets/);
assert.match(hook, /\/api\/vnext\/market-search\?\$\{parameters\}/);
assert.doesNotMatch(hook, /cache: "no-store"/);
assert.match(hook, /UNIVERSAL_SEARCH_TIMEOUT_MS = 5_000/);
assert.match(hook, /status: "aborted"/);
assert.match(shell, /mergeVNextDirectoryAndSearchMarkets/);
assert.match(shell, /clearUniversalSearch\(\);[\s\S]*setQuery\(nextQuery\)/);
assert.match(presentation, /Search token, contract or pool/);
assert.match(presentation, /rmtSearchContract/);
assert.match(workspace, /marketDataState !== "canonical-only"/);
assert.match(workspaceHook, /externalMarketLookup\s*\?/);
assert.doesNotMatch(hook + shell + presentation, /rmt-market-indexer-shadow-production|RMT_MARKET_INDEXER_READ_TOKEN|sendTransaction|signTransaction|writeContract/);

console.log("VNext Terminal universal search integration preserves local-first filtering, canonical evidence, null metrics, ambiguity, and race-safe explicit submission.");
