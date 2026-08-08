import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Address
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import type {
  ExternalMarket,
  RobinhoodStockAssetRelationship,
  UniversalMarketPool,
  UniversalMarketResolution
} from "../external-market";
import { rankExternalMarket } from "../external-market-ranking";
import { ROBINHOOD_V3_FACTORY, ROBINHOOD_WETH } from "../uniswap-v4";
import type { RobinhoodStockRegistrySnapshot } from "./robinhood-stock-token-registry";

export const ROBINHOOD_USDC = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
export const ROBINHOOD_UNISWAP_V2_FACTORY = "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f" as Address;
export const ROBINHOOD_SUSHI_V2_FACTORY = "0xE52abd50ad151ecDf56427effD715E703696a6B1" as Address;
export const ROBINHOOD_SUSHI_V3_FACTORY = "0xE51960f1B45f1C9FB6D166E6a884F866fC70433B" as Address;

const V3_FEES = [100, 500, 3_000, 10_000] as const;
const BLOCKSCOUT = robinhoodChain.blockExplorers?.default.url ?? "https://explorer.mainnet.chain.robinhood.com";
const factoryV2Abi = [{
  type: "function",
  name: "getPair",
  stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }],
  outputs: [{ type: "address" }]
}] as const;
const factoryV3Abi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
  outputs: [{ type: "address" }]
}] as const;
const poolIdentityAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] }
] as const;

type TokenIdentity = UniversalMarketResolution["token"];
type ResolverDependencies = {
  readToken?: (address: Address) => Promise<TokenIdentity | null>;
  readPool?: (address: Address, quoteTokens: readonly Address[]) => Promise<UniversalMarketPool | null>;
  discoverPools?: (token: Address, quoteTokens: readonly Address[]) => Promise<UniversalMarketPool[]>;
  now?: () => Date;
};

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 2, timeout: 8_000, batch: { batchSize: 100, wait: 0 } }
  )
});

function safeText(value: string, fallback: string, maximum: number) {
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  return normalized || fallback;
}

export async function readRobinhoodTokenIdentity(address: Address): Promise<TokenIdentity | null> {
  try {
    const [code, name, symbol, decimals, totalSupply] = await Promise.all([
      client.getBytecode({ address }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address, abi: erc20Abi, functionName: "totalSupply" })
    ]);
    if (!code || code === "0x" || decimals > 36 || totalSupply <= 0n) return null;
    return {
      address: getAddress(address),
      name: safeText(name, "Token", 80),
      symbol: safeText(symbol, "TOKEN", 20),
      decimals,
      totalSupply: totalSupply.toString()
    };
  } catch {
    return null;
  }
}

function venueForFactory(factory: Address, version: 2 | 3) {
  const normalized = factory.toLowerCase();
  if (version === 3 && normalized === ROBINHOOD_V3_FACTORY.toLowerCase()) return "uniswap-v3" as const;
  if (version === 3 && normalized === ROBINHOOD_SUSHI_V3_FACTORY.toLowerCase()) return "sushi-v3" as const;
  if (version === 2 && normalized === ROBINHOOD_UNISWAP_V2_FACTORY.toLowerCase()) return "uniswap-v2" as const;
  if (version === 2 && normalized === ROBINHOOD_SUSHI_V2_FACTORY.toLowerCase()) return "sushi-v2" as const;
  return null;
}

function quoteTokenForPair(token0: Address, token1: Address, quoteTokens: readonly Address[]) {
  const known = new Set(quoteTokens.map((address) => address.toLowerCase()));
  if (known.has(token0.toLowerCase())) return token0;
  if (known.has(token1.toLowerCase())) return token1;
  return token1;
}

async function readPool(address: Address, quoteTokens: readonly Address[]): Promise<UniversalMarketPool | null> {
  try {
    const code = await client.getBytecode({ address });
    if (!code || code === "0x") return null;
    const [factory, token0, token1] = await Promise.all([
      client.readContract({ address, abi: poolIdentityAbi, functionName: "factory" }),
      client.readContract({ address, abi: poolIdentityAbi, functionName: "token0" }),
      client.readContract({ address, abi: poolIdentityAbi, functionName: "token1" })
    ]);
    let fee: number | null = null;
    let version: 2 | 3 = 2;
    try {
      fee = Number(await client.readContract({ address, abi: poolIdentityAbi, functionName: "fee" }));
      version = 3;
    } catch {
      version = 2;
    }
    const venue = venueForFactory(getAddress(factory), version);
    if (!venue) return null;
    const canonical = version === 3
      ? await client.readContract({
          address: getAddress(factory),
          abi: factoryV3Abi,
          functionName: "getPool",
          args: [token0, token1, fee!]
        })
      : await client.readContract({
          address: getAddress(factory),
          abi: factoryV2Abi,
          functionName: "getPair",
          args: [token0, token1]
        });
    if (canonical.toLowerCase() !== address.toLowerCase()) return null;
    const quoteToken = quoteTokenForPair(token0, token1, quoteTokens);
    return {
      venue,
      protocolVersion: version,
      poolAddress: getAddress(address),
      token0: getAddress(token0),
      token1: getAddress(token1),
      quoteToken: getAddress(quoteToken),
      fee,
      canonical: true,
      execution: version === 3 && quoteToken.toLowerCase() === ROBINHOOD_WETH.toLowerCase()
        ? "route-check-required"
        : "view-only"
    };
  } catch {
    return null;
  }
}

async function discoverPoolsForQuotes(token: Address, quoteTokens: readonly Address[]) {
  const uniqueQuotes = [...new Map(quoteTokens
    .filter((quote) => quote.toLowerCase() !== token.toLowerCase())
    .map((quote) => [quote.toLowerCase(), getAddress(quote)])).values()];
  const requests = uniqueQuotes.flatMap((quote) => [
    ...([ROBINHOOD_V3_FACTORY, ROBINHOOD_SUSHI_V3_FACTORY] as const).flatMap((factory) => (
      V3_FEES.map((fee) => ({
        version: 3 as const,
        factory,
        quote,
        fee
      }))
    )),
    ...([ROBINHOOD_UNISWAP_V2_FACTORY, ROBINHOOD_SUSHI_V2_FACTORY] as const).map((factory) => ({
      version: 2 as const,
      factory,
      quote,
      fee: null
    }))
  ]);
  const results = await Promise.allSettled(requests.map((request) => request.version === 3
    ? client.readContract({
        address: request.factory,
        abi: factoryV3Abi,
        functionName: "getPool",
        args: [token, request.quote, request.fee]
      })
    : client.readContract({
        address: request.factory,
        abi: factoryV2Abi,
        functionName: "getPair",
        args: [token, request.quote]
      })));
  const pools: UniversalMarketPool[] = [];
  results.forEach((result, resultIndex) => {
      if (result.status !== "fulfilled" || !isAddress(result.value) || result.value === zeroAddress) return;
      const request = requests[resultIndex];
      const venue = venueForFactory(request.factory, request.version);
      if (!venue) return;
      pools.push({
        venue,
        protocolVersion: request.version,
        poolAddress: getAddress(result.value),
        token0: getAddress(token),
        token1: getAddress(request.quote),
        quoteToken: getAddress(request.quote),
        fee: request.fee,
        canonical: true,
        execution: request.version === 3 && request.quote.toLowerCase() === ROBINHOOD_WETH.toLowerCase()
          ? "route-check-required"
          : "view-only"
      });
    });
  const verified = await Promise.all(pools.map(async (pool) => {
    const code = await client.getBytecode({ address: getAddress(pool.poolAddress) }).catch(() => undefined);
    return code && code !== "0x" ? pool : null;
  }));
  return [...new Map(verified.flatMap((pool) => pool ? [[pool.poolAddress.toLowerCase(), pool] as const] : [])).values()];
}

async function discoverPools(token: Address, quoteTokens: readonly Address[]) {
  const priorityQuotes = quoteTokens.filter((quote) => (
    quote.toLowerCase() === ROBINHOOD_WETH.toLowerCase()
    || quote.toLowerCase() === ROBINHOOD_USDC.toLowerCase()
  ));
  const priorityPools = await discoverPoolsForQuotes(token, priorityQuotes);
  if (priorityPools.length > 0) return priorityPools;
  return discoverPoolsForQuotes(token, quoteTokens.filter((quote) => (
    quote.toLowerCase() !== ROBINHOOD_WETH.toLowerCase()
    && quote.toLowerCase() !== ROBINHOOD_USDC.toLowerCase()
  )));
}

function quoteTokens(snapshot: RobinhoodStockRegistrySnapshot) {
  return [
    ROBINHOOD_WETH,
    ROBINHOOD_USDC,
    ...[...snapshot.assetsByAddress.values()]
      .filter((asset) => asset.status === "active")
      .map((asset) => getAddress(asset.contractAddress))
  ];
}

function primaryTokenFromPool(pool: UniversalMarketPool, knownQuotes: readonly Address[]) {
  const quotes = new Set(knownQuotes.map((address) => address.toLowerCase()));
  if (quotes.has(pool.token0.toLowerCase()) && !quotes.has(pool.token1.toLowerCase())) return getAddress(pool.token1);
  return getAddress(pool.token0);
}

export async function resolveUniversalMarketAddress(
  requested: string,
  stockRegistry: RobinhoodStockRegistrySnapshot,
  dependencies: ResolverDependencies = {}
): Promise<UniversalMarketResolution | null> {
  if (!isAddress(requested) || requested.toLowerCase() === zeroAddress) return null;
  const address = getAddress(requested);
  const quotes = quoteTokens(stockRegistry);
  const tokenReader = dependencies.readToken ?? readRobinhoodTokenIdentity;
  const poolReader = dependencies.readPool ?? readPool;
  const poolDiscovery = dependencies.discoverPools ?? discoverPools;
  let token = await tokenReader(address);
  let requestedKind: UniversalMarketResolution["requestedKind"] = "token";
  let pools: UniversalMarketPool[] = [];
  if (!token) {
    const pool = await poolReader(address, quotes);
    if (!pool) return null;
    requestedKind = "pool";
    token = await tokenReader(primaryTokenFromPool(pool, quotes));
    if (!token) return null;
    pools = [pool];
  } else {
    pools = await poolDiscovery(getAddress(token.address), quotes);
  }
  const execution = pools.some((pool) => pool.execution === "route-check-required")
    ? "route-check-required"
    : "view-only";
  return {
    chainId: 4663,
    requestedAddress: address,
    requestedKind,
    status: pools.length > 0 ? "pool-found" : "token-only",
    token,
    pools,
    marketData: "identity-only",
    execution,
    provenance: "robinhood-chain-contract-reads",
    resolvedAt: (dependencies.now?.() ?? new Date()).toISOString()
  };
}

export async function verifyUniversalMarketPoolForToken(
  token: Address,
  poolAddress: Address,
  stockRegistry: RobinhoodStockRegistrySnapshot
) {
  const resolution = await resolveUniversalMarketAddress(poolAddress, stockRegistry);
  const pool = resolution?.pools.find((candidate) => (
    candidate.poolAddress.toLowerCase() === poolAddress.toLowerCase()
  ));
  if (
    !resolution
    || resolution.requestedKind !== "pool"
    || resolution.token.address.toLowerCase() !== token.toLowerCase()
    || !pool
  ) {
    throw new Error("This is not a canonical Robinhood Chain pool for the requested token.");
  }
  return pool;
}

function relationshipForQuote(
  pool: UniversalMarketPool,
  snapshot: RobinhoodStockRegistrySnapshot
): RobinhoodStockAssetRelationship[] {
  const asset = snapshot.assetsByAddress.get(pool.quoteToken.toLowerCase());
  return asset ? [{ ...asset, relationship: "paired-market-asset", provenance: "robinhood-live-asset-registry" }] : [];
}

function preferredPool(pools: UniversalMarketPool[]) {
  const order: Record<UniversalMarketPool["venue"], number> = {
    "uniswap-v3": 0,
    "sushi-v3": 1,
    "uniswap-v2": 2,
    "sushi-v2": 3
  };
  return [...pools].sort((left, right) => (
    Number(right.execution === "route-check-required") - Number(left.execution === "route-check-required")
    || order[left.venue] - order[right.venue]
    || left.poolAddress.localeCompare(right.poolAddress)
  ))[0];
}

export function marketFromUniversalResolution(
  resolution: UniversalMarketResolution,
  stockRegistry: RobinhoodStockRegistrySnapshot
): ExternalMarket | null {
  const pool = preferredPool(resolution.pools);
  if (!pool) return null;
  const ranking = rankExternalMarket({
    liquidityUsd: 0,
    marketCapUsd: 0,
    volume5m: 0,
    volume1h: 0,
    volume24h: 0,
    priceChange5m: 0,
    priceChange1h: 0,
    buys5m: 0,
    sells5m: 0,
    buys1h: 0,
    sells1h: 0,
    pairCreatedAt: null
  });
  const url = `${BLOCKSCOUT}/address/${pool.poolAddress}`;
  return {
    address: resolution.token.address,
    name: resolution.token.name,
    symbol: resolution.token.symbol,
    pairAddress: pool.poolAddress,
    url,
    dexId: pool.venue,
    stockAssetRelationships: relationshipForQuote(pool, stockRegistry),
    resolution,
    origin: { kind: "external", state: "unknown", coverage: "unavailable" },
    venue: { kind: "dex", dexId: pool.venue, pairAddress: pool.poolAddress, url, execution: "read-only" },
    priceUsd: 0,
    liquidityUsd: 0,
    marketCapUsd: 0,
    fdvUsd: 0,
    volume5m: 0,
    volume1h: 0,
    volume24h: 0,
    priceChange5m: 0,
    priceChange1h: 0,
    priceChange24h: 0,
    buys5m: 0,
    sells5m: 0,
    buys1h: 0,
    sells1h: 0,
    buys24h: 0,
    sells24h: 0,
    pairCreatedAt: null,
    ...ranking
  };
}
