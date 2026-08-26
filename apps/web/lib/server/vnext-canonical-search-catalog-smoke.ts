import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import {
  CANONICAL_SEARCH_CATALOG_BUILD_DEADLINE_MS,
  CANONICAL_SEARCH_CATALOG_FRESH_MS,
  CANONICAL_SEARCH_CATALOG_MAX_ENTRIES,
  CANONICAL_SEARCH_CATALOG_MAX_MARKETS,
  createVNextCanonicalSearchCatalogReader,
  type VNextCanonicalSearchIdentity
} from "./vnext-canonical-search-catalog";
import type {
  VNextCanonicalMarketInventoryPool,
  VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";

const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const manifestHash = `0x${"1".repeat(64)}`;
const blockHash = `0x${"2".repeat(64)}`;
const transactionHash = `0x${"3".repeat(64)}`;

function address(seed: number) {
  return `0x${seed.toString(16).padStart(40, "0")}`;
}

function market(seed: number): VNextCanonicalMarketInventoryPool {
  const poolAddress = address(seed + 100_000);
  return {
    sourceId: "uniswap-v2",
    protocol: "uniswap",
    version: 2,
    poolKey: poolAddress,
    poolAddress,
    token0: address(seed),
    token1: WETH,
    stable: null,
    fee: null,
    tickSpacing: null,
    hooks: null,
    transactionHash,
    blockNumber: "12345",
    blockHash,
    stateStatus: null,
    liveFee: null,
    feeDenominator: null,
    gaugeAddress: null,
    gaugeAlive: null,
    gaugeWeight: null,
    gaugeClaimable: null,
    feesAddress: null,
    bribeAddress: null,
    stateError: null,
    stateObservedBlock: null,
    stateObservedBlockHash: null
  };
}

function inventory(
  pools: VNextCanonicalMarketInventoryPool[],
  nextCursor: string | null
): VNextCanonicalMarketInventoryResult {
  return {
    status: "verified_shadow",
    chainId: 4_663,
    mode: "shadow",
    authoritative: false,
    sourceManifestHash: manifestHash,
    coverage: { complete: true, finalizedHead: "12345", sources: [] },
    nextCursor,
    pools
  };
}

function identities(addresses: readonly Address[]) {
  return new Map(addresses.map((token, index) => [token.toLowerCase(), {
    address: token,
    name: `Canonical Token ${index}`,
    symbol: `T${index}`,
    decimals: 18
  } satisfies VNextCanonicalSearchIdentity]));
}

async function assertRefreshCoalescingAndLastGoodFallback() {
  const pools = [market(1), market(2), market(3)];
  let now = 1_000_000;
  let inventoryCalls = 0;
  let identityCalls = 0;
  let unavailable = false;
  const reader = createVNextCanonicalSearchCatalogReader({
    now: () => now,
    readInventory: async () => {
      inventoryCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (unavailable) return { status: "upstream_unavailable", reason: "request_failed" };
      return inventory(pools, null);
    },
    readIdentities: async (addresses) => {
      identityCalls += 1;
      return identities(addresses);
    }
  });
  const snapshots = await Promise.all([reader(), reader(), reader()]);
  assert.equal(inventoryCalls, 1, "Concurrent cold catalog reads must coalesce");
  assert.equal(identityCalls, 1, "Concurrent cold catalog reads must share one identity batch");
  assert(snapshots.every((snapshot) => snapshot.status === "ready" && snapshot.entries.length === 4));
  await reader();
  assert.equal(inventoryCalls, 1, "A warm catalog read must remain in memory");

  now += CANONICAL_SEARCH_CATALOG_FRESH_MS + 1;
  unavailable = true;
  const stale = await reader();
  assert.equal(stale.status, "ready");
  assert.equal(stale.status === "ready" ? stale.freshness : null, "last-known");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const afterFailure = await reader();
  assert.equal(afterFailure.status, "ready");
  assert.equal(afterFailure.status === "ready" ? afterFailure.freshness : null, "last-known");
}

async function assertCatalogBounds() {
  const pools = Array.from({ length: 2_050 }, (_, index) => market(index + 1));
  let maximumIdentityRequest = 0;
  let observedCapacity: { tokenCount: number; marketCount: number; truncated: boolean } | undefined;
  const reader = createVNextCanonicalSearchCatalogReader({
    readInventory: async (query) => {
      const page = query.cursor ? Number(query.cursor.slice(1)) : 0;
      const start = page * 500;
      const pagePools = pools.slice(start, start + 500);
      const next = start + pagePools.length < pools.length ? `p${page + 1}` : null;
      return inventory(pagePools, next);
    },
    readIdentities: async (addresses) => {
      maximumIdentityRequest = Math.max(maximumIdentityRequest, addresses.length);
      return identities(addresses);
    },
    observeCapacity: (capacity) => {
      observedCapacity = capacity;
    }
  });
  const snapshot = await reader();
  assert.equal(snapshot.status, "ready");
  assert.equal(maximumIdentityRequest, CANONICAL_SEARCH_CATALOG_MAX_ENTRIES);
  assert.equal(snapshot.status === "ready" ? snapshot.entries.length : 0, CANONICAL_SEARCH_CATALOG_MAX_ENTRIES);
  assert.equal(snapshot.status === "ready" ? snapshot.capacity.marketCount : 0, pools.length);
  assert.equal(snapshot.status === "ready" ? snapshot.capacity.candidateTokenCount : 0, pools.length + 1);
  assert.equal(snapshot.status === "ready" ? snapshot.capacity.tokenCount : 0, CANONICAL_SEARCH_CATALOG_MAX_ENTRIES);
  assert.equal(snapshot.status === "ready" ? snapshot.capacity.truncated : false, true);
  assert.deepEqual(observedCapacity, snapshot.status === "ready" ? snapshot.capacity : undefined,
    "Catalog capacity must be available to bounded operational observability");
  assert.equal(CANONICAL_SEARCH_CATALOG_MAX_MARKETS, 4_000);
  assert.equal(CANONICAL_SEARCH_CATALOG_BUILD_DEADLINE_MS, 2_800);
}

async function assertSlowOrPartialIdentityEvidenceDoesNotBlockSearchCatalog() {
  const first = market(1);
  const second = market(2);
  const partial = createVNextCanonicalSearchCatalogReader({
    readInventory: async () => inventory([first, second], null),
    readIdentities: async (addresses) => identities(addresses.filter(
      (token) => token.toLowerCase() !== second.token0
    ))
  });
  const partialSnapshot = await partial();
  assert.equal(partialSnapshot.status, "ready");
  assert.equal(
    partialSnapshot.status === "ready" && partialSnapshot.entries.some(
      ({ identity }) => identity.address.toLowerCase() === first.token0
    ),
    true,
    "Verified identities from healthy batches must remain searchable"
  );
  assert.equal(
    partialSnapshot.status === "ready" && partialSnapshot.entries.some(
      ({ identity }) => identity.address.toLowerCase() === second.token0
    ),
    false,
    "Unavailable identity evidence must not be fabricated"
  );

  const bounded = createVNextCanonicalSearchCatalogReader({
    buildDeadlineMs: 20,
    readInventory: async () => {
      boundedInventoryCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return inventory([first], null);
    },
    readIdentities: async (addresses) => identities(addresses)
  });
  let boundedInventoryCalls = 0;
  const startedAt = Date.now();
  const unavailable = await bounded();
  assert.equal(unavailable.status, "unavailable");
  assert(Date.now() - startedAt < 70, "A slow catalog rebuild must fail within its own bounded deadline");
  const repeated = await bounded();
  assert.equal(repeated.status, "unavailable");
  assert.equal(boundedInventoryCalls, 1, "A timed-out rebuild must remain coalesced until the underlying read settles");
}

async function main() {
  await assertRefreshCoalescingAndLastGoodFallback();
  await assertCatalogBounds();
  await assertSlowOrPartialIdentityEvidenceDoesNotBlockSearchCatalog();
  console.log("Canonical text-search catalog remains coalesced, last-good, paginated, and memory bounded.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
