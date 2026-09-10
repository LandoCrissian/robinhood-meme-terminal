import assert from "node:assert/strict";
import { mock } from "node:test";
import { getAddress } from "viem";
import { readVNextIndexedMarketDirectoryPage } from "./vnext-indexed-market-directory";
import { readDirectoryIdentityEnrichment } from "./vnext-directory-identity-enrichment";
import { applyProjectIdentityDirectoryAdmission } from "./project-identity-admission";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";
import { parseVNextCanonicalDirectoryResponse, selectVNextMarketDirectoryView, vNextSelectedMarketExecutionState } from "../vnext/market-directory";
import type { VNextCanonicalMarketInventoryResult } from "./vnext-market-indexer";

async function main() {
  const address = (n: number) => getAddress(`0x${(10000 + n).toString(16).padStart(40, "0")}`);
  const template = RMT_CURATED_MARKET_REGISTRY.find((entry) => entry.market.version === 2)!.market;
  const identities = Array.from({ length: 76 }, (_, n) => ({ address: address(n), name: `Token ${n}`, symbol: `T${n}`, decimals: 18, totalSupply: "1000" }));
  let durableCount = 9;
  const inventory = (): VNextCanonicalMarketInventoryResult => ({
    status: "verified_shadow", chainId: 4663, mode: "shadow", authoritative: false,
    sourceManifestHash: `0x${"1".repeat(64)}`, coverage: { complete: true, finalizedHead: "100", sources: [] }, nextCursor: "page2",
    pools: Array.from({ length: 38 }, (_, n) => ({ ...template, sourceId: "uniswap-v2", stateError: null,
      token0: address(n * 2).toLowerCase(), token1: address(n * 2 + 1).toLowerCase(),
      poolKey: address(1000 + n).toLowerCase(), poolAddress: address(1000 + n).toLowerCase() })),
    browseIdentities: { source: "verified-token-identity-index", freshness: "last-known", identities: identities.slice(0, durableCount) }
  });
  type Dependencies = NonNullable<Parameters<typeof readVNextIndexedMarketDirectoryPage>[1]>;
  let liveCalls = 0;
  const dependencies: Dependencies = {
    readInventory: async () => inventory(),
    readIdentities: async addresses => {
      liveCalls++;
      await new Promise(resolve => setTimeout(resolve, 45_000));
      return new Map(identities.filter(i => addresses.some(a => a.toLowerCase() === i.address.toLowerCase())).map(i => [i.address.toLowerCase(), i]));
    },
    readStocks: async () => ({ coverage: "complete", assetsByAddress: new Map([[address(0).toLowerCase(), {
      assetId: "stock", contractAddress: address(0), tokenName: "Stock", tokenSymbol: "STK", currentMultiplier: "1", status: "active", logoUrl: null
    }]]) }),
    admit: async rows => ({ admitted: [...rows], quarantined: [], authorityStatus: "ready" })
  };
  const start = performance.now();
  const initial = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid", dependencies);
  const firstMs = performance.now() - start;
  const parsed = parseVNextCanonicalDirectoryResponse(initial.body)!;
  assert.equal(initial.status, 200); assert.equal(parsed.markets!.length, 9);
  assert.ok(firstMs < 2000); assert.equal(liveCalls, 0);
  assert.equal(parsed.coverage, "partial"); assert.equal(parsed.revalidationComplete, false);
  assert.equal(parsed.identityEvidence, "last-known"); assert.equal(parsed.nextCursor, "page2");
  assert.equal(selectVNextMarketDirectoryView(parsed.markets!, "active").length, 0);
  assert.equal(vNextSelectedMarketExecutionState(parsed.markets!.find(m => m.address.toLowerCase() === address(0).toLowerCase())), "stock-token-view-only");
  mock.timers.enable({ apis: ["setTimeout"] });
  const enriched = readVNextIndexedMarketDirectoryPage("https://fixture.invalid?identityEnrichment=1", dependencies);
  const duplicate = readVNextIndexedMarketDirectoryPage("https://fixture.invalid?identityEnrichment=1", dependencies);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(liveCalls, 1, "overlapping enrichment requests coalesce per address");
  mock.timers.tick(45_000);
  const [later, same] = await Promise.all([enriched, duplicate]);
  mock.timers.reset();
  assert.equal(parseVNextCanonicalDirectoryResponse(later.body)!.markets!.length, 76);
  assert.deepEqual(later.body, same.body);
  durableCount = 76;
  const full = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid?cursor=page2", dependencies);
  assert.equal(parseVNextCanonicalDirectoryResponse(full.body)!.markets!.length, 76);
  assert.equal(liveCalls, 1, "fully durable pages never require live reads");
  durableCount = 0;
  const zero = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid", { ...dependencies, readIdentities: async () => new Map() });
  assert.equal(zero.status, 503); assert.equal("markets" in zero.body, false);
  durableCount = 10;
  await applyProjectIdentityDirectoryAdmission([{ address: address(9), verifiedIdentity: { ...identities[9], name: "Established Project", symbol: "EST" } }], {
    readAuthority: async () => ({ status: "ready", entries: [{ projectId: "est", name: "Established Project", symbol: "EST", contractAddress: address(999), authority: "coingecko-robinhood-contract-registry" }] }),
    readIdentity: async () => ({ address: address(999), name: "Established Project", symbol: "EST" })
  });
  const quarantine = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid", dependencies);
  assert.equal(parseVNextCanonicalDirectoryResponse(quarantine.body)!.markets!.length, 9);
  assert.ok(parseVNextCanonicalDirectoryResponse(quarantine.body)!.quarantinedAddresses!.includes(address(9).toLowerCase()));
  let failures = 0;
  const failing = async () => { failures++; throw new Error("bounded fixture failure"); };
  await readDirectoryIdentityEnrichment([address(0)], undefined, failing);
  await readDirectoryIdentityEnrichment([address(0)], undefined, failing);
  assert.equal(failures, 1, "transient misses respect bounded retry backoff");
  console.log(JSON.stringify({ candidates: 76, durable: 9, initial: 9, firstMs, simulatedDelayMs: 45000, enriched: 76, zeroDurable: 503, fullDurable: 76, quarantinePublished: 9, duplicateReads: 0 }));
}
void main().catch(error => { mock.timers.reset(); console.error(error); process.exitCode = 1; });
