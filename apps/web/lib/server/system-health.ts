import { unstable_cache } from "next/cache";
import { createPublicClient, http } from "viem";
import { activeChain, activeNetworkLabel, isMainnetRelease } from "../network";
import type { SystemHealthCheck, SystemHealthReport } from "../system-health";
import { directoryMarketsFromCanonicalPools } from "../vnext/market-directory";
import {
  publicVNextCanonicalMarketInventoryPool,
  readVNextCanonicalMarketInventory,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

type HealthRpcClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

type InventoryReader = (
  query: VNextCanonicalMarketInventoryQuery
) => Promise<VNextCanonicalMarketInventoryResult>;

export type SystemHealthDependencies = {
  rpcClient?: HealthRpcClient;
  readInventory?: InventoryReader;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
};

const defaultRpcClient = createPublicClient({
  chain: activeChain,
  transport: http(
    isMainnetRelease
      ? process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? activeChain.rpcUrls.default.http[0]
      : process.env.RMT_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_TESTNET_RPC_URL ?? activeChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

function check(
  key: SystemHealthCheck["key"],
  label: string,
  healthy: boolean,
  detail: string
): SystemHealthCheck {
  return { key, label, state: healthy ? "operational" : "degraded", detail };
}

function canonicalBrowseEnabled(env: Readonly<Record<string, string | undefined>>) {
  return env.RMT_CANONICAL_BROWSE_ENABLED === "true";
}

function indexerConfigurationResolved(result: VNextCanonicalMarketInventoryResult | null) {
  return result !== null && result.status !== "not_configured" && result.status !== "misconfigured";
}

export async function readFreshSystemHealth(
  dependencies: SystemHealthDependencies = {}
): Promise<SystemHealthReport> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const checkedAt = new Date(startedAt).toISOString();
  const rpcClient = dependencies.rpcClient ?? defaultRpcClient;
  const readInventory = dependencies.readInventory ?? readVNextCanonicalMarketInventory;
  const env = dependencies.env ?? process.env;
  const checks: SystemHealthCheck[] = [];
  let observedChainId: number = activeChain.id;
  let latestBlock = "unavailable";
  let blockAgeSeconds: number | null = null;

  try {
    const [chainId, blockNumber] = await Promise.all([
      rpcClient.getChainId(),
      rpcClient.getBlockNumber()
    ]);
    const block = await rpcClient.getBlock({ blockNumber });
    observedChainId = chainId;
    latestBlock = blockNumber.toString();
    blockAgeSeconds = Math.max(0, Math.floor(now() / 1_000 - Number(block.timestamp)));
    const healthy = chainId === activeChain.id && blockAgeSeconds <= 60;
    checks.push(check(
      "rpc",
      "Robinhood Chain connection",
      healthy,
      healthy
        ? `Block ${latestBlock} · ${blockAgeSeconds}s old · Chain ${chainId}`
        : "Robinhood Chain head or freshness could not be verified."
    ));
  } catch {
    checks.push(check(
      "rpc",
      "Robinhood Chain connection",
      false,
      "Robinhood Chain verification is temporarily unavailable."
    ));
  }

  let inventory: VNextCanonicalMarketInventoryResult | null = null;
  try {
    inventory = await readInventory({ limit: 1 });
  } catch {
    inventory = null;
  }

  const marketIndexerConfigured = indexerConfigurationResolved(inventory);
  const verifiedInventory = inventory?.status === "verified_shadow" ? inventory : null;
  const canonicalCoverage = verifiedInventory
    ? verifiedInventory.coverage.complete ? "complete" : "partial"
    : "unavailable";
  const inventoryStatus = verifiedInventory
    ? verifiedInventory.coverage.complete ? "ready" : "partial"
    : "unavailable";

  checks.push(check(
    "market-indexer",
    "Canonical market-indexer boundary",
    verifiedInventory !== null,
    verifiedInventory
      ? "Authenticated inventory boundary returned an accepted canonical response."
      : marketIndexerConfigured
        ? "Authenticated inventory verification is temporarily unavailable."
        : "Canonical market-indexer configuration is unavailable."
  ));

  const directoryMarkets = verifiedInventory
    ? directoryMarketsFromCanonicalPools(
        verifiedInventory.pools.map(publicVNextCanonicalMarketInventoryPool)
      )
    : [];
  const validPublicInventory = verifiedInventory !== null
    && directoryMarkets.length > 0
    && directoryMarkets.every((market) => market.address !== ZERO_ADDRESS);
  const browseEnabled = canonicalBrowseEnabled(env);
  const inventoryHealthy = browseEnabled && validPublicInventory;

  checks.push(check(
    "canonical-inventory",
    "Canonical market inventory",
    inventoryHealthy,
    inventoryHealthy
      ? `${directoryMarkets.length} public market ${directoryMarkets.length === 1 ? "identity" : "identities"} sampled · ${canonicalCoverage} coverage`
      : !browseEnabled
        ? "Canonical browse is not enabled for this Terminal configuration."
        : verifiedInventory
          ? "Canonical inventory did not contain usable public market evidence."
          : "Canonical inventory is temporarily unavailable."
  ));

  return {
    schemaVersion: 2,
    product: "rmt-terminal",
    ok: checks.every((item) => item.state === "operational"),
    network: activeNetworkLabel,
    chainId: observedChainId,
    latestBlock,
    blockAgeSeconds,
    latencyMs: Math.max(0, now() - startedAt),
    checkedAt,
    terminalEvidence: {
      canonicalBrowseEnabled: browseEnabled,
      marketIndexerConfigured,
      inventoryStatus,
      canonicalCoverage
    },
    checks
  };
}

const readSystemHealthCached = unstable_cache(
  readFreshSystemHealth,
  ["rmt-terminal-system-health-v2"],
  { revalidate: 15 }
);

export async function readSystemHealth(): Promise<SystemHealthReport> {
  return readSystemHealthCached();
}
