import { getAddress, isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import type { ExternalMarket, ExternalProjectMetadata, LaunchpadLifecycleEvidence } from "../external-market";
import { safePonsImageUri, safePonsSocialUrl } from "./pons-project-metadata";

export const LEMON_FUN_CURRENT_FACTORY = getAddress("0x2ba793fd69bf251fd1af90b576be8b9fa6be46db");
const LEMON_API = "https://lemon.fun/api/public/launchpad";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_CANDIDATES = 10;
const MAX_RESULTS = 8;

const factoryAbi = [{
  type: "function",
  name: "getLaunchedToken",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{
    type: "tuple",
    components: [
      { name: "token", type: "address" },
      { name: "deployer", type: "address" },
      { name: "pairedToken", type: "address" },
      { name: "positionManager", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "dexId", type: "uint256" },
      { name: "launchConfigId", type: "uint256" },
      { name: "restrictionsEndBlock", type: "uint256" },
      { name: "supply", type: "uint256" },
      { name: "isToken0", type: "bool" },
      { name: "poolFee", type: "uint24" },
      { name: "exists", type: "bool" },
      { name: "initialBuyAmount", type: "uint256" }
    ]
  }]
}, {
  type: "function",
  name: "getDexConfig",
  stateMutability: "view",
  inputs: [{ name: "id", type: "uint256" }],
  outputs: [{
    type: "tuple",
    components: [
      { name: "name", type: "string" },
      { name: "factory", type: "address" },
      { name: "positionManager", type: "address" },
      { name: "swapRouter", type: "address" },
      { name: "poolFee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "enabled", type: "bool" }
    ]
  }]
}] as const;

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

const v3FactoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
  outputs: [{ type: "address" }]
}] as const;

type LemonCandidate = {
  address: Address;
  name: string;
  symbol: string;
  imageUri: string | null;
  description: string;
  creator: Address;
  createdAt: string;
  pool: Address;
  priceEth: number;
  marketCapEth: number;
  socials: ExternalProjectMetadata["socials"];
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function bounded(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseCandidate(value: unknown): LemonCandidate | null {
  const item = object(value);
  const socials = object(item.socials);
  const rawAddress = bounded(item.address, 42);
  const rawCreator = bounded(item.deployer, 42);
  const rawPool = bounded(item.poolAddress, 42);
  const name = bounded(item.name, 80);
  const symbol = bounded(item.symbol ?? item.ticker, 20);
  const createdAt = bounded(item.createdAt ?? item.created_at, 80);
  if (
    !isAddress(rawAddress)
    || !isAddress(rawCreator)
    || !isAddress(rawPool)
    || getAddress(rawAddress) === zeroAddress
    || getAddress(rawPool) === zeroAddress
    || !name
    || !symbol
    || !Number.isFinite(Date.parse(createdAt))
    || item.graduated !== true
  ) return null;
  return {
    address: getAddress(rawAddress),
    name,
    symbol,
    imageUri: safePonsImageUri(bounded(item.image, 500)),
    description: bounded(item.description, 1_000),
    creator: getAddress(rawCreator),
    createdAt,
    pool: getAddress(rawPool),
    priceEth: finite(item.priceEth ?? item.price_eth),
    marketCapEth: finite(item.marketCapEth ?? item.mcap_eth),
    socials: {
      x: safePonsSocialUrl(bounded(socials.twitter ?? socials.x, 500)),
      telegram: safePonsSocialUrl(bounded(socials.telegram, 500)),
      discord: safePonsSocialUrl(bounded(socials.discord, 500)),
      website: safePonsSocialUrl(bounded(socials.website, 500)),
      farcaster: safePonsSocialUrl(bounded(socials.farcaster, 500))
    }
  };
}

async function fetchJson(url: string, fetcher: FetchLike) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 20 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Lemon.fun discovery failed with ${response.status}.`);
    const announced = Number(response.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) throw new Error("Lemon.fun response exceeded its size limit.");
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new Error("Lemon.fun response exceeded its size limit.");
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseLemonLaunchCandidates(payload: unknown) {
  const items = Array.isArray(payload) ? payload : object(payload).tokens;
  if (!Array.isArray(items)) throw new Error("Lemon.fun discovery returned malformed data.");
  return items.map(parseCandidate).filter((candidate): candidate is LemonCandidate => Boolean(candidate)).slice(0, MAX_CANDIDATES);
}

async function readCandidate(client: PublicClient, candidate: LemonCandidate): Promise<ExternalMarket | null> {
  const [record, name, symbol] = await Promise.all([
    client.readContract({ address: LEMON_FUN_CURRENT_FACTORY, abi: factoryAbi, functionName: "getLaunchedToken", args: [candidate.address] }),
    client.readContract({ address: candidate.address, abi: tokenAbi, functionName: "name" }),
    client.readContract({ address: candidate.address, abi: tokenAbi, functionName: "symbol" })
  ]);
  if (
    !record.exists
    || getAddress(record.token) !== candidate.address
    || getAddress(record.deployer) !== candidate.creator
    || bounded(name, 80) !== candidate.name
    || bounded(symbol, 20).toLowerCase() !== candidate.symbol.toLowerCase()
  ) return null;
  const dex = await client.readContract({ address: LEMON_FUN_CURRENT_FACTORY, abi: factoryAbi, functionName: "getDexConfig", args: [record.dexId] });
  if (
    !dex.enabled
    || getAddress(dex.positionManager) !== getAddress(record.positionManager)
    || Number(dex.poolFee) !== Number(record.poolFee)
  ) return null;
  const canonicalPool = await client.readContract({
    address: dex.factory,
    abi: v3FactoryAbi,
    functionName: "getPool",
    args: [candidate.address, record.pairedToken, record.poolFee]
  });
  if (getAddress(canonicalPool) !== candidate.pool) return null;
  const project: ExternalProjectMetadata = {
    sourceId: "lemon",
    sourceName: "Lemon.fun",
    provenance: "public-api-and-dex-pool-cross-checked",
    creator: candidate.creator,
    launchPool: candidate.pool,
    name: bounded(name, 80),
    symbol: bounded(symbol, 20),
    description: candidate.description,
    imageUri: candidate.imageUri,
    socials: candidate.socials
  };
  const launchpad: LaunchpadLifecycleEvidence = {
    sourceId: "lemon-fun",
    sourceName: "Lemon.fun",
    version: "current",
    factory: LEMON_FUN_CURRENT_FACTORY,
    creator: candidate.creator,
    launchId: null,
    launchBlock: null,
    launchTransactionHash: null,
    state: "graduated",
    current: true,
    metricsState: "unavailable",
    venue: { kind: "canonical-pool", address: candidate.pool, poolId: null },
    activity: { buys1h: null, sells1h: null, buys24h: null, sells24h: null, volumeQuote24h: null, lastActivityAt: null },
    provenance: "verified-public-feed-and-contract-state"
  };
  const createdAtMs = Date.parse(candidate.createdAt);
  return {
    address: candidate.address,
    name: project.name,
    symbol: project.symbol,
    imageUri: project.imageUri ?? undefined,
    pairAddress: candidate.pool,
    url: `https://lemon.fun/token/${candidate.address.toLowerCase()}`,
    dexId: "lemon-uniswap-v3",
    project,
    launchpadEvidence: [launchpad],
    origin: { kind: "external", state: "unknown", coverage: "partial" },
    venue: { kind: "external-launchpad", sourceId: "lemon-fun", market: candidate.pool, execution: "read-only" },
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
    pairCreatedAt: createdAtMs,
    ageMinutes: Math.max(0, Math.floor((Date.now() - createdAtMs) / 60_000)),
    momentumScore: 0,
    buyPressureBps: 0,
    signal: "active",
    riskFlags: []
  };
}

export async function fetchLemonLaunchMarkets(
  client: PublicClient,
  options: { token?: Address; fetch?: FetchLike } = {}
) {
  const fetcher = options.fetch ?? fetch;
  const payload = await fetchJson(
    options.token
      ? `${LEMON_API}/token/${getAddress(options.token)}`
      : `${LEMON_API}/tokens?limit=${MAX_CANDIDATES}&offset=0&sort=created`,
    fetcher
  );
  const candidates = options.token
    ? [parseCandidate(object(payload).token ?? payload)].filter((candidate): candidate is LemonCandidate => Boolean(candidate))
    : parseLemonLaunchCandidates(payload);
  const markets = await Promise.all(candidates.map((candidate) => readCandidate(client, candidate).catch(() => null)));
  return markets.filter((market): market is ExternalMarket => Boolean(market)).slice(0, options.token ? 1 : MAX_RESULTS);
}
