import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import type { ExternalMarket, ExternalProjectMetadata, LaunchpadLifecycleEvidence } from "../external-market";
import { launchpadEvidenceIsBrowseRelevant } from "../launchpad-lifecycle";
import { fetchVerifiedContractLogs, type VerifiedContractLog } from "./blockscout-contract-logs";
import {
  readVNextCanonicalMarketInventory,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";

export const PONS_V1_FACTORY = getAddress("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB");
export const PONS_ACTIVE_FACTORY = PONS_V1_FACTORY;
export const ROBINHOOD_WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");

const MAX_PONS_V1_CANDIDATES = 4;
const MAX_PONS_V1_RESULTS = 4;

type InventoryReader = (
  query: VNextCanonicalMarketInventoryQuery
) => Promise<VNextCanonicalMarketInventoryResult>;

type PonsV1LaunchEvent = {
  token: Address;
  pool: Address;
  creator: Address;
  blockNumber: string;
  transactionHash: string;
  timestamp: string;
};

export const ponsFactoryAbi = [{
  type: "function",
  name: "getLaunchedToken",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{
    name: "launched",
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
}] as const;

export const ponsTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "liquidityPool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "dexFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "positionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pairToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  {
    type: "function",
    name: "socials",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" }
    ]
  }
] as const;

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

export function safePonsImageUri(value: string) {
  const uri = bounded(value, 500);
  if (uri.startsWith("ipfs://") && uri.length > 7) return uri;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (/\.(?:svg|html?|xml)(?:$|[?#])/i.test(parsed.pathname)) return null;
    return parsed.href.slice(0, 500);
  } catch {
    return null;
  }
}

export function safePonsSocialUrl(value: string) {
  const uri = bounded(value, 500);
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href.slice(0, 500);
  } catch {
    return null;
  }
}

export type PonsProjectMetadata = Readonly<{
  sourceId: "pons";
  factory: Address;
  token: Address;
  creator: Address;
  name: string;
  symbol: string;
  description: string;
  imageUri: string | null;
  pool: Address;
  pairedToken: Address;
  dexFactory: Address;
  positionManager: Address;
  positionId: bigint;
  poolFee: number;
  restrictionsEndBlock: bigint;
  initialBuyAmount: bigint;
  socials: Readonly<{
    x: string | null;
    telegram: string | null;
    discord: string | null;
    website: string | null;
    farcaster: string | null;
  }>;
  provenance: "factory-and-token-cross-checked";
}>;

export async function readPonsProjectMetadata(
  client: PublicClient,
  tokenInput: Address,
  expectedPool?: Address
): Promise<PonsProjectMetadata> {
  const token = getAddress(tokenInput);
  const launched = await client.readContract({
    address: PONS_ACTIVE_FACTORY,
    abi: ponsFactoryAbi,
    functionName: "getLaunchedToken",
    args: [token]
  });
  if (!launched.exists || getAddress(launched.token) !== token) {
    throw new Error("Token is not recorded by the pinned pons factory");
  }

  const [name, symbol, logo, description, pool, creator, dexFactory, positionManager, pairedToken, poolFee, socials] =
    await Promise.all([
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "name" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "symbol" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "logo" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "description" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "liquidityPool" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "deployer" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "dexFactory" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "positionManager" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "pairToken" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "poolFee" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "socials" })
    ]);

  const canonicalPool = getAddress(pool);
  if (expectedPool && canonicalPool !== getAddress(expectedPool)) {
    throw new Error("pons token pool does not match launch evidence");
  }
  if (
    getAddress(creator) !== getAddress(launched.deployer)
    || getAddress(positionManager) !== getAddress(launched.positionManager)
    || getAddress(pairedToken) !== getAddress(launched.pairedToken)
    || getAddress(pairedToken) !== ROBINHOOD_WETH
    || Number(poolFee) !== launched.poolFee
    || !isAddress(dexFactory)
  ) {
    throw new Error("pons token identity does not match its factory record");
  }

  return Object.freeze({
    sourceId: "pons",
    factory: PONS_ACTIVE_FACTORY,
    token,
    creator: getAddress(creator),
    name: bounded(name, 80),
    symbol: bounded(symbol, 20),
    description: bounded(description, 1_000),
    imageUri: safePonsImageUri(logo),
    pool: canonicalPool,
    pairedToken: getAddress(pairedToken),
    dexFactory: getAddress(dexFactory),
    positionManager: getAddress(positionManager),
    positionId: launched.positionId,
    poolFee: Number(poolFee),
    restrictionsEndBlock: launched.restrictionsEndBlock,
    initialBuyAmount: launched.initialBuyAmount,
    socials: Object.freeze({
      x: safePonsSocialUrl(socials[0]),
      telegram: safePonsSocialUrl(socials[1]),
      discord: safePonsSocialUrl(socials[2]),
      website: safePonsSocialUrl(socials[3]),
      farcaster: safePonsSocialUrl(socials[4])
    }),
    provenance: "factory-and-token-cross-checked"
  });
}

export async function readPonsProjectMetadataBatch(
  client: PublicClient,
  tokenInputs: readonly Address[]
) {
  const tokens = [...new Map(tokenInputs.map((token) => {
    const address = getAddress(token);
    return [address.toLowerCase(), address] as const;
  })).values()];
  if (tokens.length === 0) return new Map<string, PonsProjectMetadata>();

  const launchedTokens: Address[] = [];
  const maximumConcurrentReads = 8;
  for (let index = 0; index < tokens.length; index += maximumConcurrentReads) {
    const chunk = tokens.slice(index, index + maximumConcurrentReads);
    const launchRecords = await Promise.all(chunk.map((token) => client.readContract({
      address: PONS_ACTIVE_FACTORY,
      abi: ponsFactoryAbi,
      functionName: "getLaunchedToken",
      args: [token]
    }).catch(() => null)));
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const token = chunk[offset];
      const record = launchRecords[offset];
      if (token && record?.exists && getAddress(record.token) === token) launchedTokens.push(token);
    }
  }

  const resolved = await Promise.all(launchedTokens.map(async (token) => {
    const metadata = await readPonsProjectMetadata(client, token);
    return [token.toLowerCase(), metadata] as const;
  }));
  return new Map(resolved);
}

export function externalProjectFromPonsV1(metadata: PonsProjectMetadata): ExternalProjectMetadata {
  return {
    sourceId: "pons",
    sourceName: "Pons",
    provenance: metadata.provenance,
    creator: metadata.creator,
    launchPool: metadata.pool,
    name: metadata.name,
    symbol: metadata.symbol,
    description: metadata.description,
    imageUri: metadata.imageUri,
    socials: metadata.socials
  };
}

export function ponsV1LifecycleFromMetadata(metadata: PonsProjectMetadata): LaunchpadLifecycleEvidence {
  return {
    sourceId: "pons-v1",
    sourceName: "Pons V1",
    version: "v1",
    factory: PONS_V1_FACTORY,
    creator: metadata.creator,
    launchId: null,
    launchBlock: null,
    launchTransactionHash: null,
    state: "graduated",
    current: true,
    metricsState: "unavailable",
    venue: { kind: "canonical-pool", address: metadata.pool, poolId: null },
    activity: { buys1h: null, sells1h: null, buys24h: null, sells24h: null, volumeQuote24h: null, lastActivityAt: null },
    provenance: "verified-factory-and-token-state"
  };
}

function eventAddress(log: VerifiedContractLog, name: string) {
  const value = log.parameters.get(name);
  return value && isAddress(value) ? getAddress(value) : null;
}

export function ponsV1LaunchEvents(logs: readonly VerifiedContractLog[]) {
  const launches = new Map<string, PonsV1LaunchEvent>();
  for (const log of logs) {
    if (!log.method?.startsWith("TokenLaunched(")) continue;
    const token = eventAddress(log, "token");
    const pool = eventAddress(log, "pool");
    const creator = eventAddress(log, "deployer");
    if (!token || !pool || !creator) continue;
    launches.set(token.toLowerCase(), {
      token,
      pool,
      creator,
      blockNumber: log.blockNumber.toString(),
      transactionHash: log.transactionHash,
      timestamp: log.blockTimestamp
    });
  }
  return [...launches.values()].slice(0, MAX_PONS_V1_CANDIDATES);
}

async function ponsV1Market(
  client: PublicClient,
  token: Address,
  event: PonsV1LaunchEvent | undefined,
  nowMs: number,
  readInventory: InventoryReader
): Promise<ExternalMarket | null> {
  const metadata = await readPonsProjectMetadata(client, token, event?.pool);
  if (event && event.creator !== metadata.creator) return null;
  const inventory = await readInventory({ token, limit: 100 }).catch(() => null);
  const canonical = inventory?.status === "verified_shadow"
    ? inventory.pools.find((pool) => pool.poolAddress?.toLowerCase() === metadata.pool.toLowerCase())
    : undefined;
  if (!canonical) return null;
  const launchedAtMs = event ? Date.parse(event.timestamp) : null;
  const evidence: LaunchpadLifecycleEvidence = {
    ...ponsV1LifecycleFromMetadata(metadata),
    launchBlock: event?.blockNumber ?? null,
    launchTransactionHash: event?.transactionHash ?? null
  };
  if (!launchpadEvidenceIsBrowseRelevant(evidence, launchedAtMs, true, nowMs)) return null;
  const ageMinutes = launchedAtMs === null ? null : Math.max(0, Math.floor((nowMs - launchedAtMs) / 60_000));
  return {
    address: metadata.token,
    name: metadata.name,
    symbol: metadata.symbol,
    imageUri: metadata.imageUri ?? undefined,
    pairAddress: metadata.pool,
    url: `https://robinhoodchain.blockscout.com/address/${metadata.pool}`,
    dexId: canonical.sourceId,
    project: externalProjectFromPonsV1(metadata),
    launchpadEvidence: [evidence],
    origin: { kind: "external", state: "unknown", coverage: "partial" },
    venue: { kind: "external-launchpad", sourceId: "pons-v1", market: metadata.pool, execution: "read-only" },
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
    pairCreatedAt: launchedAtMs,
    ageMinutes,
    momentumScore: 0,
    buyPressureBps: 0,
    signal: ageMinutes !== null && ageMinutes <= 24 * 60 ? "early" : "active",
    riskFlags: []
  };
}

export async function fetchPonsV1LaunchMarkets(
  client: PublicClient,
  options: { token?: Address; nowMs?: number; fetch?: typeof fetch; readInventory?: InventoryReader } = {}
) {
  const nowMs = options.nowMs ?? Date.now();
  const readInventory = options.readInventory ?? readVNextCanonicalMarketInventory;
  if (options.token) {
    const resolved = await ponsV1Market(client, getAddress(options.token), undefined, nowMs, readInventory).catch(() => null);
    return resolved ? [resolved] : [];
  }
  const logs = await fetchVerifiedContractLogs(PONS_V1_FACTORY, { pages: 2, fetch: options.fetch });
  const events = ponsV1LaunchEvents(logs);
  const markets = await Promise.all(events.map((event) => (
    ponsV1Market(client, event.token, event, nowMs, readInventory).catch(() => null)
  )));
  return markets.filter((market): market is ExternalMarket => Boolean(market))
    .sort((left, right) => (
      (left.ageMinutes ?? Number.MAX_SAFE_INTEGER) - (right.ageMinutes ?? Number.MAX_SAFE_INTEGER)
      || left.address.toLowerCase().localeCompare(right.address.toLowerCase())
    ))
    .slice(0, MAX_PONS_V1_RESULTS);
}
