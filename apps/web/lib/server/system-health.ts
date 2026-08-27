import { unstable_cache } from "next/cache";
import { createPublicClient, http } from "viem";
import { activeChain, activeNetworkLabel, isMainnetRelease } from "../network";
import type { SystemHealthCheck, SystemHealthReport } from "../system-health";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";
import { readRmtCuratedMarketSnapshot, type RmtCuratedMarketSnapshot } from "./rmt-curated-market-registry";

type HealthRpcClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

export type SystemHealthDependencies = {
  rpcClient?: HealthRpcClient;
  readCuratedSnapshot?: () => Promise<RmtCuratedMarketSnapshot>;
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

export async function readFreshSystemHealth(
  dependencies: SystemHealthDependencies = {}
): Promise<SystemHealthReport> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const checkedAt = new Date(startedAt).toISOString();
  const rpcClient = dependencies.rpcClient ?? defaultRpcClient;
  const readCuratedSnapshot = dependencies.readCuratedSnapshot ?? readRmtCuratedMarketSnapshot;
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

  let curatedSnapshot: RmtCuratedMarketSnapshot | null = null;
  try {
    curatedSnapshot = await readCuratedSnapshot();
  } catch {
    curatedSnapshot = null;
  }
  const registryReady = RMT_CURATED_MARKET_REGISTRY.length > 0;
  checks.push(check(
    "curated-registry",
    "RMT curated market registry",
    registryReady,
    registryReady
      ? `${RMT_CURATED_MARKET_REGISTRY.length} owner-admitted markets are configured.`
      : "The owner-curated market registry is empty."
  ));
  const curatedMarketsVerified = curatedSnapshot?.markets.length === RMT_CURATED_MARKET_REGISTRY.length;
  checks.push(check(
    "curated-markets",
    "Curated market and ERC20 verification",
    curatedMarketsVerified,
    curatedMarketsVerified
      ? `${curatedSnapshot!.markets.length} curated ERC20 identities and canonical markets verified${curatedSnapshot!.stale ? " from the last-good snapshot" : ""}.`
      : "Curated ERC20 identity or canonical market verification is unavailable."
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
      curatedRegistryReady: registryReady,
      curatedMarketsVerified,
      curatedMarketCount: RMT_CURATED_MARKET_REGISTRY.length,
      historicalMarketIndexerRequired: false
    },
    checks
  };
}

const readSystemHealthCached = unstable_cache(
  readFreshSystemHealth,
  ["rmt-terminal-system-health-curated-v1"],
  { revalidate: 15 }
);

export async function readSystemHealth(): Promise<SystemHealthReport> {
  return readSystemHealthCached();
}
