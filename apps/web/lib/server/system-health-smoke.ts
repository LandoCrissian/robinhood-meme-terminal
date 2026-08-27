import assert from "node:assert/strict";
import { readFreshSystemHealth } from "./system-health";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";
import { activeChain } from "../network";

const now = Date.parse("2026-08-27T12:00:00.000Z");
const rpcClient = {
  async getChainId() { return activeChain.id; },
  async getBlockNumber() { return 1_000n; },
  async getBlock() { return { timestamp: BigInt(now / 1_000 - 5) }; }
};
const curatedMarkets = RMT_CURATED_MARKET_REGISTRY.map((entry) => ({
  address: entry.token,
  canonicalMarkets: [entry.market]
})) as never;

async function main() {
  const healthy = await readFreshSystemHealth({
    rpcClient,
    readCuratedSnapshot: async () => ({
      status: "ready",
      stale: false,
      verifiedAt: new Date(now).toISOString(),
      markets: curatedMarkets
    }),
    now: () => now
  });
  assert.equal(healthy.schemaVersion, 2);
  assert.equal(healthy.product, "rmt-terminal");
  assert.equal(healthy.ok, true);
  assert.deepEqual(healthy.checks.map((item) => item.key), ["rpc", "curated-registry", "curated-markets"]);
  assert.deepEqual(healthy.terminalEvidence, {
    curatedRegistryReady: true,
    curatedMarketsVerified: true,
    curatedMarketCount: RMT_CURATED_MARKET_REGISTRY.length,
    historicalMarketIndexerRequired: false
  });

  const unavailable = await readFreshSystemHealth({
    rpcClient,
    readCuratedSnapshot: async () => { throw new Error("unavailable"); },
    now: () => now
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.terminalEvidence.curatedMarketsVerified, false);
  assert.equal(unavailable.checks.find((item) => item.key === "curated-markets")?.state, "degraded");

  const wrongChain = await readFreshSystemHealth({
    rpcClient: { ...rpcClient, async getChainId() { return 1; } },
    readCuratedSnapshot: async () => ({
      status: "ready",
      stale: true,
      verifiedAt: new Date(now).toISOString(),
      markets: curatedMarkets
    }),
    now: () => now
  });
  assert.equal(wrongChain.ok, false);
  assert.equal(wrongChain.checks.find((item) => item.key === "rpc")?.state, "degraded");

  console.info("Terminal curated system-health smoke test passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
