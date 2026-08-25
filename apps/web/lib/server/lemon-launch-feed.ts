import { getAddress, isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import type { ExternalMarket, ExternalProjectMetadata, LaunchpadLifecycleEvidence } from "../external-market";
import { safePonsImageUri, safePonsSocialUrl } from "./pons-project-metadata";

export const LEMON_FUN_CURRENT_FACTORY = getAddress("0x2ba793fd69bf251fd1af90b576be8b9fa6be46db");
export const LEMON_FUN_CURVE_FACTORY = getAddress("0x4924d006EdD8C142eb3F78C4E8437BF718764485");
const LEMON_API = "https://lemon.fun/api/public/launchpad";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PROVIDER_ITEMS = 100;
const MAX_CANDIDATES = 10;
const MAX_RESULTS = 8;

const currentFactoryAbi = [{
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

const curveFactoryAbi = [{
  type: "function",
  name: "getTokenInfo",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{
    name: "info",
    type: "tuple",
    components: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
      { name: "deployer", type: "address" },
      { name: "graduationThreshold", type: "uint256" },
      { name: "creatorFeeBps", type: "uint16" },
      { name: "dexKind", type: "uint8" },
      { name: "graduated", type: "bool" },
      { name: "poolAfterGraduation", type: "address" },
      { name: "lpLocker", type: "address" },
      { name: "tokenReserve", type: "uint256" },
      { name: "ethReserve", type: "uint256" },
      { name: "virtualTokenReserve", type: "uint256" },
      { name: "virtualEthReserve", type: "uint256" }
    ]
  }]
}] as const;

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

const curveTokenAbi = [...tokenAbi, ...[
  { type: "function", name: "launcher", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolSetter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const] as const;

const v3FactoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
  outputs: [{ type: "address" }]
}] as const;

const poolIdentityAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

type LemonCandidate = {
  address: Address;
  name: string;
  symbol: string;
  imageUri: string | null;
  description: string;
  creator: Address;
  createdAt: string;
  graduated: boolean;
  lineage: "current-factory" | "curve-factory";
  curve: Address | null;
  pool: Address | null;
  dex: string;
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
  const rawCurve = bounded(item.curve, 42);
  const name = bounded(item.name, 80);
  const symbol = bounded(item.symbol ?? item.ticker, 20);
  const createdAt = bounded(item.createdAt ?? item.created_at, 80);
  const dex = bounded(item.dex, 80).toLowerCase();
  const graduated = item.graduated === true;
  const pool = isAddress(rawPool) && getAddress(rawPool) !== zeroAddress ? getAddress(rawPool) : null;
  const curve = isAddress(rawCurve) && getAddress(rawCurve) !== zeroAddress ? getAddress(rawCurve) : null;
  const curveLineage = curve !== null && (dex === "curve-uniswap" || dex === "curve-sushi");
  if (
    !isAddress(rawAddress)
    || !isAddress(rawCreator)
    || getAddress(rawAddress) === zeroAddress
    || getAddress(rawCreator) === zeroAddress
    || !name
    || !symbol
    || !Number.isFinite(Date.parse(createdAt))
    || (graduated ? pool === null : !curveLineage || pool !== null)
  ) return null;
  return {
    address: getAddress(rawAddress),
    name,
    symbol,
    imageUri: safePonsImageUri(bounded(item.image, 500)),
    description: bounded(item.description, 1_000),
    creator: getAddress(rawCreator),
    createdAt,
    graduated,
    lineage: curveLineage ? "curve-factory" : "current-factory",
    curve,
    pool,
    dex,
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

function verifiedMarket(
  candidate: LemonCandidate,
  verified: {
    name: string;
    symbol: string;
    factory: Address;
    version: LaunchpadLifecycleEvidence["version"];
    state: "curve-live" | "graduated";
    venue: Address;
    provenance: ExternalProjectMetadata["provenance"];
  }
): ExternalMarket {
  const project: ExternalProjectMetadata = {
    sourceId: "lemon",
    sourceName: "Lemon.fun",
    provenance: verified.provenance,
    creator: candidate.creator,
    launchPool: verified.venue,
    name: verified.name,
    symbol: verified.symbol,
    description: candidate.description,
    imageUri: candidate.imageUri,
    socials: candidate.socials
  };
  const launchpad: LaunchpadLifecycleEvidence = {
    sourceId: "lemon-fun",
    sourceName: "Lemon.fun",
    version: verified.version,
    factory: verified.factory,
    creator: candidate.creator,
    launchId: null,
    launchBlock: null,
    launchTransactionHash: null,
    state: verified.state,
    current: true,
    metricsState: "unavailable",
    venue: {
      kind: verified.state === "graduated" ? "canonical-pool" : "bonding-curve",
      address: verified.venue,
      poolId: null
    },
    activity: { buys1h: null, sells1h: null, buys24h: null, sells24h: null, volumeQuote24h: null, lastActivityAt: null },
    provenance: "verified-public-feed-and-contract-state"
  };
  const createdAtMs = Date.parse(candidate.createdAt);
  return {
    address: candidate.address,
    name: project.name,
    symbol: project.symbol,
    imageUri: project.imageUri ?? undefined,
    pairAddress: verified.venue,
    url: `https://lemon.fun/token/${candidate.address.toLowerCase()}`,
    dexId: verified.state === "graduated" ? "lemon-graduated" : "lemon-bonding-curve",
    project,
    launchpadEvidence: [launchpad],
    origin: { kind: "external", state: "unknown", coverage: "partial" },
    venue: { kind: "external-launchpad", sourceId: "lemon-fun", market: verified.venue, execution: "read-only" },
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

async function readCurrentFactoryCandidate(client: PublicClient, candidate: LemonCandidate) {
  if (!candidate.graduated || candidate.pool === null) return null;
  const [record, name, symbol] = await Promise.all([
    client.readContract({ address: LEMON_FUN_CURRENT_FACTORY, abi: currentFactoryAbi, functionName: "getLaunchedToken", args: [candidate.address] }),
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
  const dex = await client.readContract({ address: LEMON_FUN_CURRENT_FACTORY, abi: currentFactoryAbi, functionName: "getDexConfig", args: [record.dexId] });
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
  return verifiedMarket(candidate, {
    name: bounded(name, 80),
    symbol: bounded(symbol, 20),
    factory: LEMON_FUN_CURRENT_FACTORY,
    version: "current",
    state: "graduated",
    venue: candidate.pool,
    provenance: "public-api-and-dex-pool-cross-checked"
  });
}

async function readCurveFactoryCandidate(client: PublicClient, candidate: LemonCandidate) {
  if (candidate.curve === null) return null;
  const [record, name, symbol, launcher, poolSetter, tokenPool, curveCode] = await Promise.all([
    client.readContract({ address: LEMON_FUN_CURVE_FACTORY, abi: curveFactoryAbi, functionName: "getTokenInfo", args: [candidate.address] }),
    client.readContract({ address: candidate.address, abi: curveTokenAbi, functionName: "name" }),
    client.readContract({ address: candidate.address, abi: curveTokenAbi, functionName: "symbol" }),
    client.readContract({ address: candidate.address, abi: curveTokenAbi, functionName: "launcher" }),
    client.readContract({ address: candidate.address, abi: curveTokenAbi, functionName: "poolSetter" }),
    client.readContract({ address: candidate.address, abi: curveTokenAbi, functionName: "pool" }),
    client.getCode({ address: candidate.curve })
  ]);
  const recordedPool = getAddress(record.poolAfterGraduation);
  const expectedPool = candidate.graduated ? candidate.pool : null;
  if (
    getAddress(record.token) !== candidate.address
    || getAddress(record.curve) !== candidate.curve
    || getAddress(record.deployer) !== candidate.creator
    || record.graduated !== candidate.graduated
    || getAddress(launcher) !== LEMON_FUN_CURVE_FACTORY
    || getAddress(poolSetter) !== candidate.curve
    || bounded(name, 80) !== candidate.name
    || bounded(symbol, 20).toLowerCase() !== candidate.symbol.toLowerCase()
    || !curveCode
    || curveCode === "0x"
    || (!candidate.graduated && (
      record.tokenReserve === 0n
      || record.virtualTokenReserve === 0n
      || record.virtualEthReserve === 0n
    ))
    || (candidate.graduated
      ? expectedPool === null || recordedPool !== expectedPool || getAddress(tokenPool) !== expectedPool
      : recordedPool !== zeroAddress || getAddress(tokenPool) !== zeroAddress)
  ) return null;
  if (candidate.graduated) {
    const [token0, token1, poolCode] = await Promise.all([
      client.readContract({ address: candidate.pool!, abi: poolIdentityAbi, functionName: "token0" }),
      client.readContract({ address: candidate.pool!, abi: poolIdentityAbi, functionName: "token1" }),
      client.getCode({ address: candidate.pool! })
    ]);
    if (
      !poolCode
      || poolCode === "0x"
      || ![getAddress(token0), getAddress(token1)].includes(candidate.address)
    ) return null;
  }
  return verifiedMarket(candidate, {
    name: bounded(name, 80),
    symbol: bounded(symbol, 20),
    factory: LEMON_FUN_CURVE_FACTORY,
    version: "v1",
    state: candidate.graduated ? "graduated" : "curve-live",
    venue: candidate.graduated ? candidate.pool! : candidate.curve,
    provenance: candidate.graduated
      ? "public-api-and-dex-pool-cross-checked"
      : "factory-and-token-cross-checked"
  });
}

async function readCandidate(client: PublicClient, candidate: LemonCandidate): Promise<ExternalMarket | null> {
  return candidate.lineage === "curve-factory"
    ? readCurveFactoryCandidate(client, candidate)
    : readCurrentFactoryCandidate(client, candidate);
}

export async function fetchLemonLaunchMarkets(
  client: PublicClient,
  options: { token?: Address; fetch?: FetchLike } = {}
) {
  const fetcher = options.fetch ?? fetch;
  const candidates = options.token
    ? await fetchJson(`${LEMON_API}/token/${getAddress(options.token)}`, fetcher).then((payload) => (
      [parseCandidate(object(payload).token ?? payload)].filter((candidate): candidate is LemonCandidate => Boolean(candidate))
    ))
    : await Promise.allSettled([
      fetchJson(`${LEMON_API}/tokens?limit=${MAX_PROVIDER_ITEMS}&offset=0&sort=created&graduated=true`, fetcher),
      fetchJson(`${LEMON_API}/tokens?limit=${MAX_PROVIDER_ITEMS}&offset=0&sort=created&graduated=false`, fetcher)
    ]).then((results) => {
      const payloads = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (payloads.length === 0) throw new Error("Lemon.fun current discovery is unavailable.");
      const unique = new Map<string, LemonCandidate>();
      for (const candidate of payloads.flatMap(parseLemonLaunchCandidates)) {
        unique.set(candidate.address.toLowerCase(), candidate);
      }
      return [...unique.values()];
    });
  const markets = await Promise.all(candidates.map((candidate) => readCandidate(client, candidate).catch(() => null)));
  const verified = markets.filter((market): market is ExternalMarket => Boolean(market));
  if (options.token) return verified.slice(0, 1);
  const bonding = verified.filter((market) => market.launchpadEvidence?.some((evidence) => evidence.state === "curve-live"));
  const graduated = verified.filter((market) => market.launchpadEvidence?.some((evidence) => evidence.state === "graduated"));
  return [...bonding.slice(0, MAX_RESULTS / 2), ...graduated.slice(0, MAX_RESULTS / 2)];
}
