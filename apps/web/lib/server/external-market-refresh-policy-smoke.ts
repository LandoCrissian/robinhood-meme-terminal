import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BoundedInFlightCoalescer,
  EXTERNAL_BROAD_CACHE_CONTROL,
  EXTERNAL_BROAD_MAX_IN_FLIGHT,
  EXTERNAL_BROAD_REFRESH_KEY,
  EXTERNAL_CONTRACT_CACHE_CONTROL,
  EXTERNAL_CONTRACT_RESOLVER_CACHE_CONTROL
} from "./external-market-refresh-policy";
import {
  filterRmtCuratedProviderPairs,
  missingRmtCuratedProviderTokens,
  rmtCuratedEnrichmentTokens
} from "./rmt-curated-market-enrichment";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";

async function main() {
  assert.equal(EXTERNAL_BROAD_CACHE_CONTROL, "public, s-maxage=300, stale-while-revalidate=600");
  assert.equal(EXTERNAL_CONTRACT_CACHE_CONTROL, "public, s-maxage=30, stale-while-revalidate=90");
  assert.equal(EXTERNAL_CONTRACT_RESOLVER_CACHE_CONTROL, "public, s-maxage=20, stale-while-revalidate=60");
  assert.equal(EXTERNAL_BROAD_MAX_IN_FLIGHT, 1);

  const curatedPairs = RMT_CURATED_MARKET_REGISTRY.map((entry) => ({
    chainId: "robinhood",
    pairAddress: entry.market.poolKey,
    baseToken: { address: entry.market.token0 },
    quoteToken: { address: entry.market.token1 }
  }));
  assert.equal(rmtCuratedEnrichmentTokens().length, 8, "Every enabled curated token must seed broad enrichment");
  assert.equal(Math.ceil(rmtCuratedEnrichmentTokens().length / 30), 1, "The curated eight must fit in one provider batch");
  assert.equal(filterRmtCuratedProviderPairs(curatedPairs).length, 8, "Exact address pools and V4 PoolIds must all bind to their curated entry");
  assert.deepEqual(missingRmtCuratedProviderTokens(curatedPairs), []);
  const wrongPool = { ...curatedPairs[0], pairAddress: curatedPairs[1].pairAddress };
  assert.equal(filterRmtCuratedProviderPairs([wrongPool]).length, 0, "Provider ranking must not substitute another curated pool");
  const missing = missingRmtCuratedProviderTokens(curatedPairs.slice(1));
  assert.deepEqual(missing, [RMT_CURATED_MARKET_REGISTRY[0].token.toLowerCase()]);

  let releaseRefresh: ((value: number) => void) | undefined;
  const refreshGate = new Promise<number>((resolve) => {
    releaseRefresh = resolve;
  });
  const coalescer = new BoundedInFlightCoalescer<number>(EXTERNAL_BROAD_MAX_IN_FLIGHT);
  let refreshes = 0;
  const refresh = async () => {
    refreshes += 1;
    return refreshGate;
  };
  const first = coalescer.run(EXTERNAL_BROAD_REFRESH_KEY, refresh);
  const second = coalescer.run(EXTERNAL_BROAD_REFRESH_KEY, refresh);
  assert.equal(refreshes, 0, "Refresh starts on the next microtask so callers can share it deterministically");
  await Promise.resolve();
  assert.equal(refreshes, 1, "Concurrent broad requests must share one aggregation refresh");
  assert.equal(coalescer.size, 1);
  releaseRefresh?.(7);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  await Promise.resolve();
  assert.equal(coalescer.size, 0, "Settled coalescing entries must be removed");

  const bounded = new BoundedInFlightCoalescer<number>(1);
  let releaseFirst: ((value: number) => void) | undefined;
  const firstGate = new Promise<number>((resolve) => {
    releaseFirst = resolve;
  });
  const boundedFirst = bounded.run("first", () => firstGate);
  const boundedSecond = bounded.run("second", async () => 2);
  assert.equal(bounded.size, 1, "A second key must not grow the map beyond its bound");
  assert.equal(await boundedSecond, 2);
  releaseFirst?.(1);
  assert.equal(await boundedFirst, 1);
  await Promise.resolve();
  assert.equal(bounded.size, 0);

  const recovery = new BoundedInFlightCoalescer<number>(1);
  let recoveryAttempts = 0;
  await assert.rejects(
    recovery.run(EXTERNAL_BROAD_REFRESH_KEY, async () => {
      recoveryAttempts += 1;
      throw new Error("transient refresh failure");
    }),
    /transient refresh failure/
  );
  await Promise.resolve();
  assert.equal(recovery.size, 0, "Rejected refreshes must not poison the coalescer");
  assert.equal(await recovery.run(EXTERNAL_BROAD_REFRESH_KEY, async () => {
    recoveryAttempts += 1;
    return 9;
  }), 9);
  assert.equal(recoveryAttempts, 2);

  const route = readFileSync(new URL("../../app/api/markets/external/route.ts", import.meta.url), "utf8");
  assert.match(route, /requestedContract\s*\?\s*EXTERNAL_CONTRACT_CACHE_CONTROL\s*:\s*EXTERNAL_BROAD_CACHE_CONTROL/);
  assert.match(route, /broadExternalRefreshes\.run\(\s*EXTERNAL_BROAD_REFRESH_KEY/);
  assert.match(route, /return response\.clone\(\)/);
  assert.match(route, /const requestedTokens = requestedContract \? \[requestedContract\] : rmtCuratedEnrichmentTokens\(\)/);
  assert.match(route, /missingRmtCuratedProviderTokens\(batchResults\.flat\(\)\)/);
  assert.match(route, /filterRmtCuratedProviderPairs\(returnedPairs\)/);
  assert.doesNotMatch(route, /fetchPublicDiscoveryTokens|fetchGeckoPoolSnapshot|DEXSCREENER_PROFILES_API|DEXSCREENER_(?:LATEST_)?BOOSTS_API/);

  console.info("External market refresh cache and coalescing checks passed.");
}

void main();
