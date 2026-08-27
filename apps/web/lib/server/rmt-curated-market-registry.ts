import { createPublicClient, getAddress, http, zeroAddress, type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  RMT_CURATED_MARKET_REGISTRY,
  RMT_CURATED_MARKET_MANIFEST_HASH,
  RMT_CURATED_UNISWAP_FACTORIES,
  isRmtCuratedMarketIdentity,
  type RmtCuratedMarketEntry
} from "../vnext/curated-market-registry";
import { directoryMarketsFromCanonicalPools, type VNextDirectoryMarket } from "../vnext/market-directory";
import {
  ROBINHOOD_NATIVE_ASSET_ADDRESS,
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import { ROBINHOOD_V4_STATE_VIEW } from "../uniswap-v4";
import {
  readRobinhoodTokenIdentities,
  readRobinhoodTokenIdentity
} from "./universal-market-resolver";
import {
  applyProjectIdentityDirectoryAdmission,
  type ProjectIdentityAdmissionCandidate
} from "./project-identity-admission";
import type {
  VNextCanonicalMarketInventoryQuery,
  VNextCanonicalMarketInventoryPool,
  VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";

const SNAPSHOT_FRESH_MS = 5 * 60_000;
const SNAPSHOT_STALE_MS = 60 * 60_000;

const poolAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] }
] as const;
const factoryV2Abi = [{
  type: "function", name: "getPair", stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "address" }]
}] as const;
const factoryV3Abi = [{
  type: "function", name: "getPool", stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }]
}] as const;
const stateViewAbi = [{
  type: "function", name: "getSlot0", stateMutability: "view",
  inputs: [{ type: "bytes32" }],
  outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint24" }, { type: "uint24" }]
}] as const;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 12_000 }
  )
});

export type RmtCuratedMarketSnapshot = {
  status: "ready";
  stale: boolean;
  verifiedAt: string;
  markets: VNextDirectoryMarket[];
};

type SnapshotDependencies = {
  readIdentities?: typeof readRobinhoodTokenIdentities;
  verifyMarket?: (entry: RmtCuratedMarketEntry) => Promise<void>;
  now?: () => number;
};

let lastGood: { freshUntil: number; staleUntil: number; snapshot: RmtCuratedMarketSnapshot } | null = null;
let inFlight: Promise<RmtCuratedMarketSnapshot> | null = null;

const SETTLEMENT_ASSETS = new Set([
  ROBINHOOD_NATIVE_ASSET_ADDRESS.toLowerCase(),
  ROBINHOOD_USDG_ADDRESS.toLowerCase(),
  ROBINHOOD_WETH_ADDRESS.toLowerCase()
]);

export class RmtCuratedMarketAdmissionError extends Error {
  constructor() {
    super("Token exists but is not currently listed on RMT.");
    this.name = "RmtCuratedMarketAdmissionError";
  }
}

type RmtCuratedContractListingDependencies = {
  readIdentity?: typeof readRobinhoodTokenIdentity;
  admitProjectIdentities?: (
    candidates: readonly ProjectIdentityAdmissionCandidate[]
  ) => Promise<{ quarantined: readonly unknown[] }>;
};

export type RmtCuratedContractListing =
  | { status: "listed" }
  | { status: "not_found" }
  | {
      status: "not_listed";
      identity: NonNullable<Awaited<ReturnType<typeof readRobinhoodTokenIdentity>>>;
    }
  | {
      status: "not_admitted";
      identity: NonNullable<Awaited<ReturnType<typeof readRobinhoodTokenIdentity>>>;
    };

export async function classifyRmtCuratedContractListing(
  address: Address,
  dependencies: RmtCuratedContractListingDependencies = {}
): Promise<RmtCuratedContractListing> {
  if (isRmtCuratedMarketIdentity(address)) {
    return { status: "listed" };
  }
  const readIdentity = dependencies.readIdentity ?? readRobinhoodTokenIdentity;
  const identity = await readIdentity(address);
  if (!identity) return { status: "not_found" };
  const admitProjectIdentities = dependencies.admitProjectIdentities
    ?? applyProjectIdentityDirectoryAdmission;
  const admission = await admitProjectIdentities([{
    address: identity.address,
    verifiedIdentity: {
      address: identity.address,
      name: identity.name,
      symbol: identity.symbol
    }
  }]);
  return admission.quarantined.length > 0
    ? { status: "not_admitted", identity }
    : { status: "not_listed", identity };
}

export function requireRmtCuratedExecutionAssets(inputAsset: Address, outputAsset: Address) {
  const assets = [inputAsset, outputAsset].map((address) => address.toLowerCase());
  const marketAssets = assets.filter((address) => !SETTLEMENT_ASSETS.has(address));
  if (
    marketAssets.length === 0
    || marketAssets.some((address) => !RMT_CURATED_MARKET_REGISTRY.some((entry) => entry.token.toLowerCase() === address))
  ) throw new RmtCuratedMarketAdmissionError();
}

export function rmtCuratedMarketAdmissionErrorResponse(cause: unknown) {
  return cause instanceof RmtCuratedMarketAdmissionError
    ? Response.json({ error: cause.message, listingAdmission: "not_listed" }, {
        status: 409,
        headers: { "Cache-Control": "no-store" }
      })
    : null;
}

async function verifyAddressMarket(entry: RmtCuratedMarketEntry) {
  const market = entry.market;
  const pool = getAddress(market.poolAddress!);
  const expectedFactory = market.version === 2
    ? RMT_CURATED_UNISWAP_FACTORIES.v2
    : RMT_CURATED_UNISWAP_FACTORIES.v3;
  const [code, factory, token0, token1, fee, tickSpacing, canonical] = await Promise.all([
    client.getBytecode({ address: pool }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "factory" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
    market.version === 3
      ? client.readContract({ address: pool, abi: poolAbi, functionName: "fee" })
      : Promise.resolve(null),
    market.version === 3
      ? client.readContract({ address: pool, abi: poolAbi, functionName: "tickSpacing" })
      : Promise.resolve(null),
    market.version === 3
      ? client.readContract({
          address: expectedFactory, abi: factoryV3Abi, functionName: "getPool",
          args: [getAddress(market.token0), getAddress(market.token1), market.fee!]
        })
      : client.readContract({
          address: expectedFactory, abi: factoryV2Abi, functionName: "getPair",
          args: [getAddress(market.token0), getAddress(market.token1)]
        })
  ]);
  if (
    !code || code === "0x"
    || getAddress(factory) !== expectedFactory
    || getAddress(token0).toLowerCase() !== market.token0
    || getAddress(token1).toLowerCase() !== market.token1
    || getAddress(canonical) !== pool
    || (market.version === 3 && (Number(fee) !== market.fee || Number(tickSpacing) !== market.tickSpacing))
  ) throw new Error(`Curated ${entry.token} market binding is invalid.`);
}

async function verifyV4Market(entry: RmtCuratedMarketEntry) {
  const market = entry.market;
  const slot0 = await client.readContract({
    address: ROBINHOOD_V4_STATE_VIEW,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [market.poolKey as `0x${string}`]
  });
  if (slot0[0] <= 0n || market.poolAddress !== null || market.token0 !== zeroAddress) {
    throw new Error(`Curated ${entry.token} V4 PoolId is not initialized.`);
  }
}

export async function verifyRmtCuratedMarket(entry: RmtCuratedMarketEntry) {
  if (entry.market.version === 4) return verifyV4Market(entry);
  return verifyAddressMarket(entry);
}

async function buildSnapshot(dependencies: SnapshotDependencies) {
  const now = dependencies.now ?? Date.now;
  const readIdentities = dependencies.readIdentities ?? readRobinhoodTokenIdentities;
  const verifyMarket = dependencies.verifyMarket ?? verifyRmtCuratedMarket;
  const identitiesPromise = readIdentities(RMT_CURATED_MARKET_REGISTRY.map((entry) => entry.token));
  await Promise.all(RMT_CURATED_MARKET_REGISTRY.map(verifyMarket));
  const identities = await identitiesPromise;
  if (identities.size !== RMT_CURATED_MARKET_REGISTRY.length) {
    throw new Error("One or more curated ERC20 identities could not be independently verified.");
  }
  const markets = directoryMarketsFromCanonicalPools(
    RMT_CURATED_MARKET_REGISTRY.map((entry) => entry.market)
  ).filter((market) => RMT_CURATED_MARKET_REGISTRY.some((entry) => entry.token.toLowerCase() === market.address.toLowerCase()))
    .map((market) => {
    const identity = identities.get(market.address.toLowerCase());
    if (!identity) throw new Error("Curated identity result is incomplete.");
    return {
      ...market,
      name: identity.name,
      symbol: identity.symbol,
      verifiedIdentity: {
        address: identity.address,
        name: identity.name,
        symbol: identity.symbol,
        decimals: identity.decimals
      }
    };
  });
  const snapshot: RmtCuratedMarketSnapshot = {
    status: "ready",
    stale: false,
    verifiedAt: new Date(now()).toISOString(),
    markets
  };
  lastGood = {
    freshUntil: now() + SNAPSHOT_FRESH_MS,
    staleUntil: now() + SNAPSHOT_STALE_MS,
    snapshot
  };
  return snapshot;
}

export async function readRmtCuratedMarketSnapshot(
  dependencies: SnapshotDependencies = {}
): Promise<RmtCuratedMarketSnapshot> {
  const now = dependencies.now ?? Date.now;
  if (!dependencies.readIdentities && !dependencies.verifyMarket && lastGood?.freshUntil && lastGood.freshUntil > now()) {
    return lastGood.snapshot;
  }
  if (!dependencies.readIdentities && !dependencies.verifyMarket && inFlight) return inFlight;
  const request = buildSnapshot(dependencies).catch((error) => {
    if (lastGood && lastGood.staleUntil > now()) return { ...lastGood.snapshot, stale: true };
    throw error;
  });
  if (!dependencies.readIdentities && !dependencies.verifyMarket) inFlight = request;
  try {
    return await request;
  } finally {
    if (inFlight === request) inFlight = null;
  }
}

export function resetRmtCuratedMarketSnapshotForTests() {
  lastGood = null;
  inFlight = null;
}

export async function readRmtCuratedCanonicalMarketInventory(
  query: VNextCanonicalMarketInventoryQuery
): Promise<VNextCanonicalMarketInventoryResult> {
  if (query.cursor) return { status: "invalid_query", reason: "invalid_cursor" };
  await readRmtCuratedMarketSnapshot();
  const token = query.token?.toLowerCase();
  const poolKey = query.poolKey?.toLowerCase();
  const pools = RMT_CURATED_MARKET_REGISTRY
    .filter((entry) => !token || entry.market.token0 === token || entry.market.token1 === token)
    .filter((entry) => !poolKey || entry.market.poolKey === poolKey)
    .slice(0, query.limit ?? RMT_CURATED_MARKET_REGISTRY.length)
    .map((entry) => ({ ...entry.market, stateError: null } as VNextCanonicalMarketInventoryPool));
  const finalizedHead = RMT_CURATED_MARKET_REGISTRY.reduce(
    (maximum, entry) => BigInt(entry.market.stateObservedBlock ?? entry.market.blockNumber) > maximum
      ? BigInt(entry.market.stateObservedBlock ?? entry.market.blockNumber)
      : maximum,
    0n
  ).toString();
  return {
    status: "verified_shadow",
    chainId: 4_663,
    mode: "shadow",
    authoritative: false,
    sourceManifestHash: RMT_CURATED_MARKET_MANIFEST_HASH,
    coverage: {
      complete: true,
      finalizedHead,
      sources: ["uniswap-v2", "uniswap-v3", "uniswap-v4"].map((sourceId) => ({
        sourceId: sourceId as "uniswap-v2" | "uniswap-v3" | "uniswap-v4",
        status: "shadow-ready" as const,
        indexedThrough: finalizedHead
      }))
    },
    nextCursor: null,
    pools
  };
}
