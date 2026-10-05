import assert from "node:assert/strict";
import { directoryMarketFromUniversalSearchResult, normalizeDirectoryMarkets } from "./market-directory";
import { createSearchRowEnrichment, enrichSearchRow, SEARCH_ROW_ENRICHMENT_POLICY, unresolvedSearchRow } from "./search-row-enrichment";
import { selectedMarketSnapshot } from "./selected-market-price";
import { readPublicWorkspace } from "./public-workspace-read";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const identity = (n: number) => directoryMarketFromUniversalSearchResult({ address: address(n), name: `Token ${n}`, symbol: `T${n}`, decimals: 18, matchedBy: "token", markets: [] });
const row = identity(1), pool = `0x${"ab".repeat(32)}`;
const observation = { chainId: 4663 as const, assetId: `eip155:4663/contract:${row.address}`, token: { address: row.address, name: row.name, symbol: row.symbol },
  venue: "uniswap", protocolVersion: 4 as const, pool: { kind: "bytes32" as const, value: pool }, baseToken: { address: row.address, name: row.name, symbol: row.symbol },
  quoteToken: { address: address(999), name: "Quote", symbol: "WETH" }, assetSide: "BASE" as const, displayEligibility: "eligible" as const,
  chartEligibility: "unavailable" as const, executionEligibility: "view-only" as const, provenance: "dexscreener-token-pairs" as const,
  priceUsd: 2, liquidityUsd: 100, volume24h: 50, priceChange24h: 1, marketCapUsd: 200, fdvUsd: 200, pairCreatedAt: null };
const provider = normalizeDirectoryMarkets({ markets: [{ ...row, pairAddress: pool, primaryMarket: observation, verifiedMarkets: [observation], priceUsd: 2 }] })[0];
assert.equal(unresolvedSearchRow(row), true);
assert.equal(unresolvedSearchRow({ ...row, verifiedIdentity: undefined }), false, "No arbitrary contract probes");
assert.equal(unresolvedSearchRow({ ...row, address: "invalid" }), false);
assert.equal(unresolvedSearchRow({ ...row, verifiedIdentity: { ...row.verifiedIdentity!, address: address(2) } }), false);
assert.equal(enrichSearchRow(row, null), null, "No market retains delayed state");
assert.equal(enrichSearchRow(row, { ...provider, address: address(2) }), null);
assert.equal(enrichSearchRow(row, { ...provider, primaryMarket: { ...observation, token: { ...observation.token, address: address(2) } } }), null);
assert.equal(enrichSearchRow(row, { ...provider, primaryMarket: { ...observation, priceUsd: 0 } }), null, "Zero is not price evidence");
const enriched = enrichSearchRow(row, provider)!;
assert.ok(enriched);assert.equal(unresolvedSearchRow(enriched), false);
assert.equal(enriched.address, row.address);assert.equal(enriched.primaryMarket?.pool.value, pool);
assert.equal(enriched.primaryMarket?.quoteToken.symbol, "WETH");assert.equal(enriched.priceUsd, 2);
assert.equal(selectedMarketSnapshot(enriched).source, "DexScreener");assert.equal(selectedMarketSnapshot(enriched).priceUsd, 2);
assert.equal(enrichSearchRow({ ...row, pairAddress: address(7) }, provider), null, "Never replace an already pinned pool");

async function main() {
  let now = 0, visible = true, online = true, fail = false, calls: string[] = [], release: (() => void) | undefined;
  const queue = createSearchRowEnrichment(async (row, signal) => { calls.push(row.address); if (release) await new Promise<void>(resolve => { release = resolve; }); return !fail && !signal.aborted; }, () => visible && online, () => now);
  queue.retain(Array.from({ length: 30 }, (_, i) => identity(i + 1)).concat(row));
  await queue.opportunity();assert.equal(calls.length, 1);
  await Promise.all(Array.from({ length: 24 }, () => queue.opportunity()));assert.equal(calls.length, 1, "24 rendered rows cannot fan out");
  now = 60_000; await queue.opportunity();assert.equal(calls.length, 2);assert.notEqual(calls[0], calls[1], "Fair source identity scheduling");
  now = 120_000; visible = false;await queue.opportunity();online = false;visible = true;await queue.opportunity();assert.equal(calls.length, 2);
  online = true; await Promise.all([queue.opportunity(), queue.opportunity(), queue.opportunity()]);assert.equal(calls.length, 3, "Coalesced resume opportunity");
  queue.retain([enriched]);now += 60_000;await queue.opportunity();assert.equal(calls.length, 3, "Already enriched and normal directory rows do not need reads");
  queue.retain([row, row]);fail = true;await queue.opportunity();assert.equal(calls.length, 4);
  for (const elapsed of [60_000, 60_000]) { now += elapsed;await queue.opportunity(); }
  assert.equal(calls.length, 5, "First failed retry waits at least two minutes");
  now += 60_000;await queue.opportunity();assert.equal(calls.length, 5);
  now += 180_000;await queue.opportunity();assert.equal(calls.length, 6, "Second failed retry waits four minutes");
  now += 60_000;await queue.opportunity();assert.equal(calls.length, 6);
  now += 240_000;fail = false;release = () => {};const active = queue.opportunity();await Promise.resolve();
  queue.retain([row]);await queue.opportunity();assert.equal(calls.length, 7, "Retention while in flight never duplicates");
  queue.retain([]);release!();release = undefined;await active;
  queue.dispose();now += 600_000;queue.retain([row]);await queue.opportunity();assert.equal(calls.length, 7);
  const fetchBefore = globalThis.fetch;let network = 0;
  try {
    globalThis.fetch = (async () => { network++;return Response.json({ markets: [provider] }); }) as typeof fetch;
    const url = `/api/markets/external?contract=${row.address}`;
    const values = await Promise.all([readPublicWorkspace(url), readPublicWorkspace(url)]);assert.deepEqual(values[0], values[1]);
    await readPublicWorkspace(url);assert.equal(network, 1, "Reuse existing exact-token single flight and sixty-second browser cache");
  } finally { globalThis.fetch = fetchBefore; }
  assert.equal(SEARCH_ROW_ENRICHMENT_POLICY.concurrency, 1);
  console.log("Unresolved search rows: exact identity/pool/quote/provider/price, no-market/invalid/zero, one-per-minute no fanout, fair scheduling, backoff, hidden/offline, scope cancellation, cache PASS");
}
void main().catch(error => { console.error(error);process.exitCode = 1; });
