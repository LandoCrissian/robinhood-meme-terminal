import {
  ACROSS_SPOKE_POOLS,
  acrossFundingConfiguration,
  readAcrossSpokePoolDeployment,
  verifyAcrossSpokePoolDeployment
} from "../lib/server/vnext-across-funding";
import { hasRmtAdminConfiguration } from "../lib/server/firebase-admin";
import { acrossDedicatedRpcConfigured, acrossRpcEndpoint, acrossRpcHeaders } from "../lib/server/vnext-across-rpc";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID
} from "../lib/vnext/trusted-asset-registry";

const ACROSS_API_URL = "https://app.across.to/api";
const REQUEST_TIMEOUT_MS = 8_000;

const chains = [{
  chainId: ETHEREUM_MAINNET_CHAIN_ID,
  chainName: "Ethereum"
}, {
  chainId: ARBITRUM_MAINNET_CHAIN_ID,
  chainName: "Arbitrum"
}, {
  chainId: BASE_MAINNET_CHAIN_ID,
  chainName: "Base"
}, {
  chainId: ROBINHOOD_MAINNET_CHAIN_ID,
  chainName: "Robinhood Chain"
}] as const;

function containsChainId(value: unknown, expectedChainId: number): boolean {
  if (Array.isArray(value)) return value.some((item) => containsChainId(item, expectedChainId));
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (object.chainId === expectedChainId || object.chainId === String(expectedChainId)) return true;
  return Object.values(object).some((item) => containsChainId(item, expectedChainId));
}

async function rpcChainId(chainId: typeof chains[number]["chainId"]) {
  const response = await fetch(acrossRpcEndpoint(chainId), {
    method: "POST",
    headers: acrossRpcHeaders(chainId),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const body = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
  if (!response.ok || !body || body.error !== undefined || typeof body.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.result)) {
    throw new Error("A dedicated RPC failed its chain identity check.");
  }
  const observedChainId = Number(BigInt(body.result));
  if (!Number.isSafeInteger(observedChainId)) throw new Error("A dedicated RPC returned an invalid chain ID.");
  return observedChainId;
}

async function main() {
  const configuration = acrossFundingConfiguration();
  if (!configuration) throw new Error("Across credentials and approved deployment pins are not fully configured.");
  if (!hasRmtAdminConfiguration()) throw new Error("Firebase Admin recovery persistence is not configured.");
  if (!acrossDedicatedRpcConfigured()) throw new Error("Dedicated authenticated RPCs are not fully configured.");

  const rpcObservations = await Promise.all(chains.map(async (chain) => {
    const observedChainId = await rpcChainId(chain.chainId);
    if (observedChainId !== chain.chainId) throw new Error(`${chain.chainName} RPC returned the wrong chain ID.`);
    const deployment = await readAcrossSpokePoolDeployment(chain.chainId, ACROSS_SPOKE_POOLS[chain.chainId]);
    const verifiedDeployment = verifyAcrossSpokePoolDeployment(
      deployment,
      configuration.deployments[chain.chainId],
      chain.chainId === ROBINHOOD_MAINNET_CHAIN_ID ? "destination" : "source"
    );
    return {
      chainId: chain.chainId,
      chainName: chain.chainName,
      rpcIdentityVerified: true,
      spokePool: ACROSS_SPOKE_POOLS[chain.chainId],
      ...verifiedDeployment
    };
  }));

  const chainsUrl = new URL("/api/swap/chains", ACROSS_API_URL);
  chainsUrl.searchParams.set("integratorId", configuration.integratorId);
  const apiResponse = await fetch(chainsUrl, {
    headers: { Accept: "application/json", Authorization: `Bearer ${configuration.apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const apiBody: unknown = await apiResponse.json().catch(() => null);
  if (!apiResponse.ok) throw new Error(`Across credential validation failed with ${apiResponse.status}.`);
  if (!containsChainId(apiBody, ROBINHOOD_MAINNET_CHAIN_ID)) {
    throw new Error("Authenticated Across chain discovery did not include Robinhood Chain 4663.");
  }

  console.log(JSON.stringify({
    status: "across_infrastructure_preflight_passed",
    authenticatedApiVerified: true,
    robinhoodChainSupported: true,
    persistenceConfigured: true,
    rpcObservations,
    walletUsed: false,
    transactionAttempted: false,
    quoteRequested: false
  }, null, 2));
}

void main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : "Across infrastructure preflight failed.");
  process.exitCode = 1;
});
