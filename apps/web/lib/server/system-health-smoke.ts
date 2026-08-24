import assert from "node:assert/strict";
import type { VNextCanonicalMarketInventoryResult } from "./vnext-market-indexer";
import { readFreshSystemHealth } from "./system-health";

const now = Date.parse("2026-08-23T12:00:00.000Z");
const zeroAddress = `0x${"0".repeat(40)}`;
const tokenAddress = [
  "0xe934e36a43",
  "9c94017b64",
  "a3fece66af",
  "12099abf50"
].join("");
const sourceIds = [
  "sushiswap-v2",
  "sushiswap-v3",
  "uniswap-v2",
  "uniswap-v3",
  "uniswap-v4",
  "up-v2",
  "up-cl"
] as const;

function verifiedInventory(complete: boolean): VNextCanonicalMarketInventoryResult {
  return {
    status: "verified_shadow",
    chainId: 4_663,
    mode: "shadow",
    authoritative: false,
    sourceManifestHash: `0x${"ab".repeat(32)}`,
    coverage: {
      complete,
      finalizedHead: "200",
      sources: sourceIds.map((sourceId, index) => ({
        sourceId,
        status: complete || index > 0 ? "shadow-ready" : "backfilling",
        indexedThrough: complete || index > 0 ? "200" : "199"
      }))
    },
    nextCursor: "next-page",
    pools: [{
      sourceId: "uniswap-v4",
      protocol: "uniswap",
      version: 4,
      poolKey: `0x${"42".repeat(32)}`,
      poolAddress: null,
      token0: zeroAddress,
      token1: tokenAddress,
      stable: null,
      fee: 3_000,
      tickSpacing: 60,
      hooks: zeroAddress,
      transactionHash: `0x${"21".repeat(32)}`,
      blockNumber: "100",
      blockHash: `0x${"31".repeat(32)}`,
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
    }]
  };
}

const rpcClient = {
  async getChainId() { return 4_663; },
  async getBlockNumber() { return 1_000n; },
  async getBlock() { return { timestamp: BigInt(now / 1_000 - 5) }; }
};

async function healthFor(
  inventory: VNextCanonicalMarketInventoryResult,
  env: Readonly<Record<string, string | undefined>> = { RMT_CANONICAL_BROWSE_ENABLED: "true" }
) {
  let requestedLimit: number | undefined;
  const report = await readFreshSystemHealth({
    rpcClient,
    readInventory: async (query) => {
      requestedLimit = query.limit;
      return inventory;
    },
    env,
    now: () => now
  });
  assert.equal(requestedLimit, 1);
  return report;
}

async function main() {
const partial = await healthFor(verifiedInventory(false));
assert.equal(partial.schemaVersion, 2);
assert.equal(partial.product, "rmt-terminal");
assert.equal(partial.ok, true);
assert.equal(partial.chainId, 4_663);
assert.equal(partial.terminalEvidence.canonicalBrowseEnabled, true);
assert.equal(partial.terminalEvidence.marketIndexerConfigured, true);
assert.equal(partial.terminalEvidence.inventoryStatus, "partial");
assert.equal(partial.terminalEvidence.canonicalCoverage, "partial");
assert.deepEqual(partial.checks.map((item) => item.key), [
  "rpc",
  "market-indexer",
  "canonical-inventory"
]);
assert.equal(partial.checks.every((item) => item.state === "operational"), true);
assert.equal(JSON.stringify(partial).includes(zeroAddress), false);

const complete = await healthFor(verifiedInventory(true));
assert.equal(complete.ok, true);
assert.equal(complete.terminalEvidence.inventoryStatus, "ready");
assert.equal(complete.terminalEvidence.canonicalCoverage, "complete");

const disabled = await healthFor(
  verifiedInventory(false),
  { RMT_CANONICAL_BROWSE_ENABLED: "false" }
);
assert.equal(disabled.ok, false);
assert.equal(disabled.terminalEvidence.canonicalBrowseEnabled, false);
assert.equal(disabled.checks.find((item) => item.key === "canonical-inventory")?.state, "degraded");

const unavailable = await healthFor({
  status: "not_configured",
  reason: "market_indexer_not_configured"
});
assert.equal(unavailable.ok, false);
assert.equal(unavailable.terminalEvidence.marketIndexerConfigured, false);
assert.equal(unavailable.terminalEvidence.inventoryStatus, "unavailable");
assert.equal(unavailable.terminalEvidence.canonicalCoverage, "unavailable");

const upstreamFailure = await healthFor({
  status: "upstream_unavailable",
  reason: "http_failure"
});
assert.equal(upstreamFailure.ok, false);
assert.equal(upstreamFailure.terminalEvidence.marketIndexerConfigured, true);
assert.equal(upstreamFailure.checks.find((item) => item.key === "market-indexer")?.state, "degraded");

const wrongChain = await readFreshSystemHealth({
  rpcClient: { ...rpcClient, async getChainId() { return 1; } },
  readInventory: async () => verifiedInventory(false),
  env: { RMT_CANONICAL_BROWSE_ENABLED: "true" },
  now: () => now
});
assert.equal(wrongChain.ok, false);
assert.equal(wrongChain.chainId, 1);
assert.equal(wrongChain.checks.find((item) => item.key === "rpc")?.state, "degraded");

console.info("Terminal system-health smoke test passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
