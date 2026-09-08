import assert from "node:assert/strict";
import { getAddress } from "viem";
import { readVNextIndexedMarketDirectoryPage } from "./vnext-indexed-market-directory";
import { applyProjectIdentityDirectoryAdmission } from "./project-identity-admission";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";
import { parseVNextCanonicalDirectoryResponse, selectVNextMarketDirectoryView, vNextSelectedMarketExecutionState, vNextMarketDirectoryViewCounts } from "../vnext/market-directory";
import { pendingTradeEntryMatches } from "../vnext/pending-trade-entry";
import type { VNextCanonicalMarketInventoryResult } from "./vnext-market-indexer";

export async function verifyIndexedDirectory() {
  const address = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
  const template = RMT_CURATED_MARKET_REGISTRY.find((entry) => entry.market.version === 2)!.market;
  const pools = Array.from({ length: 48 }, (_, i) => ({ ...template, sourceId: "uniswap-v2" as const, stateError: null,
    token0: address(i + 100).toLowerCase(), token1: address(1).toLowerCase(),
    poolKey: address(i + 1000).toLowerCase(), poolAddress: address(i + 1000).toLowerCase() }));
  const inventory: VNextCanonicalMarketInventoryResult = { status: "verified_shadow", chainId: 4663,
    mode: "shadow", authoritative: false, sourceManifestHash: `0x${"1".repeat(64)}`,
    coverage: { complete: false, finalizedHead: "1", sources: [] }, nextCursor: "next_page", pools };
  const dependencies: NonNullable<Parameters<typeof readVNextIndexedMarketDirectoryPage>[1]> = {
    readInventory: async (query) => { assert.equal(query?.limit, 100); return inventory; },
    readIdentities: async (addresses) => new Map(addresses.map((value) => [value.toLowerCase(), {
      address: value, name: value === address(100) ? "Established Project" : `Token ${value}`,
      symbol: value === address(100) ? "EST" : "TOKEN", decimals: 18, totalSupply: "1000000"
    }])),
    readStocks: async () => ({ coverage: "complete", assetsByAddress: new Map([[address(101).toLowerCase(), {
      assetId: "stock", contractAddress: address(101), tokenName: "Stock", tokenSymbol: "STK", currentMultiplier: "1", status: "active", logoUrl: null
    }]]) }),
    admit: (candidates) => applyProjectIdentityDirectoryAdmission(candidates, {
      readAuthority: async () => ({ status: "ready", entries: [{ projectId: "est", name: "Established Project", symbol: "EST", contractAddress: address(999), authority: "coingecko-robinhood-contract-registry" }] }),
      readIdentity: async (value) => value === address(999) ? { address: value, name: "Established Project", symbol: "EST" } : null
    })
  };
  const started = performance.now();
  const result = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid/api/vnext/market-directory", dependencies);
  assert.equal(result.status, 200);
  assert.ok(performance.now() - started < 2000);
  const parsed = parseVNextCanonicalDirectoryResponse(result.body);
  assert.ok(parsed);
  assert.equal(parsed.markets!.length, 48);
  assert.equal(parsed.nextCursor, "next_page");
  assert.equal(parsed.coverage, "partial");
  assert.equal(parsed.inventorySource, "indexed");
  assert.equal(parsed.revalidationComplete, true, "partial source coverage does not mean an incomplete page read");
  const incomplete = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid", {
    ...dependencies, readIdentities: async (addresses) => {
      const identities = await dependencies.readIdentities!(addresses);
      const partial = new Map(identities); partial.delete(addresses[0].toLowerCase()); return partial;
    }
  });
  assert.equal(parseVNextCanonicalDirectoryResponse(incomplete.body)?.revalidationComplete, false);
  assert.equal(parsed.markets!.some((market) => market.address === address(100)), false, "Positive identity conflict remains quarantined");
  assert.equal(vNextSelectedMarketExecutionState(parsed.markets!.find((market) => market.address === address(101))), "stock-token-view-only");
  assert.equal(selectVNextMarketDirectoryView(parsed.markets!, "active").length, 0);
  assert.equal(selectVNextMarketDirectoryView(parsed.markets!, "trending").length, 0);
  const counts = vNextMarketDirectoryViewCounts(parsed.markets!);
  for (const view of ["active", "trending", "new", "held", "rwa", "all"] as const) assert.equal(counts[view], selectVNextMarketDirectoryView(parsed.markets!, view).length);
  assert.ok(parsed.markets!.every((market) => market.priceUsd === null && market.volume24h === null && market.verifiedIdentity));
  const unavailable = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid", { ...dependencies, readStocks: async () => ({ coverage: "unavailable", assetsByAddress: new Map() }) });
  assert.equal(unavailable.status, 503);
  const malformed = structuredClone(result.body) as typeof parsed & { markets: NonNullable<typeof parsed>["markets"] };
  malformed!.markets![0].verifiedIdentity!.address = address(9999);
  assert.equal(parseVNextCanonicalDirectoryResponse(malformed), null);
  const entry = { marketAddress: address(101), side: "buy" as const };
  assert.equal(pendingTradeEntryMatches(entry, address(101), "buy", address(2)), true, "Login retains exact contract despite the new account/balance request key");
  assert.equal(pendingTradeEntryMatches(entry, address(102), "buy", address(2)), false);
  assert.equal(pendingTradeEntryMatches(entry, address(101), "sell", address(2)), false);
  assert.equal(pendingTradeEntryMatches({ ...entry, wallet: address(2) }, address(101), "buy", address(3)), false);
  console.log("Indexed directory admission, Stock Token, truthful counts and pending trade entry: PASS");
}
