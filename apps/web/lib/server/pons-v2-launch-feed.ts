import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type PublicClient
} from "viem";
import type { ExternalMarket, ExternalProjectMetadata, LaunchpadLifecycleEvidence } from "../external-market";
import { launchpadEvidenceIsBrowseRelevant } from "../launchpad-lifecycle";
import { ROBINHOOD_V4_STATE_VIEW } from "../uniswap-v4";
import { safePonsImageUri, safePonsSocialUrl } from "./pons-project-metadata";
import { fetchVerifiedContractLogs, type VerifiedContractLog } from "./blockscout-contract-logs";
import {
  readVNextCanonicalMarketInventory,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";

export const PONS_V2_FACTORY = getAddress("0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
export const PONS_V2_LAUNCH_AND_BUY = getAddress("0xe33E9E479dF8802cb0866d5d05258bEc4cF62948");
export const PONS_V2_MEME_HOOK = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");

const MAX_CANDIDATES = 12;
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
      { name: "curve", type: "address" },
      { name: "deployer", type: "address" },
      { name: "creatorFeeRecipient", type: "address" },
      { name: "pairToken", type: "address" },
      { name: "graduationThreshold", type: "uint256" },
      { name: "poolFee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "creatorTaxBps", type: "uint16" },
      { name: "buybackEnabled", type: "bool" },
      { name: "phase", type: "uint8" },
      { name: "sweptQuote", type: "uint256" },
      { name: "sweptTokens", type: "uint256" },
      { name: "sweptAt", type: "uint256" },
      { name: "exists", type: "bool" }
    ]
  }]
}, {
  type: "function",
  name: "memeHook",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }]
}] as const;

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
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

const v4StateViewAbi = [{
  type: "function",
  name: "getSlot0",
  stateMutability: "view",
  inputs: [{ name: "poolId", type: "bytes32" }],
  outputs: [
    { name: "sqrtPriceX96", type: "uint160" },
    { name: "tick", type: "int24" },
    { name: "protocolFee", type: "uint24" },
    { name: "lpFee", type: "uint24" }
  ]
}] as const;

type LaunchEvent = {
  token: Address;
  curve: Address;
  creator: Address;
  blockNumber: string;
  transactionHash: string;
  timestamp: string;
};

type InventoryReader = (
  query: VNextCanonicalMarketInventoryQuery
) => Promise<VNextCanonicalMarketInventoryResult>;

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

function addressParameter(log: VerifiedContractLog, name: string) {
  const value = log.parameters.get(name);
  return value && isAddress(value) ? getAddress(value) : null;
}

export function ponsV2LaunchEvents(logs: readonly VerifiedContractLog[]) {
  const launches = new Map<string, LaunchEvent>();
  for (const log of logs) {
    if (!log.method?.startsWith("TokenLaunched(")) continue;
    const token = addressParameter(log, "token");
    const curve = addressParameter(log, "curve");
    const creator = addressParameter(log, "deployer");
    if (!token || !curve || !creator) continue;
    launches.set(token.toLowerCase(), {
      token,
      curve,
      creator,
      blockNumber: log.blockNumber.toString(),
      transactionHash: log.transactionHash,
      timestamp: log.blockTimestamp
    });
  }
  return [...launches.values()].slice(0, MAX_CANDIDATES);
}

export function ponsV2PoolId(tokenInput: Address, pairTokenInput: Address, poolFee: number, tickSpacing: number) {
  const token = getAddress(tokenInput);
  const pairToken = getAddress(pairTokenInput);
  const [currency0, currency1] = BigInt(token.toLowerCase()) < BigInt(pairToken.toLowerCase())
    ? [token, pairToken]
    : [pairToken, token];
  return keccak256(encodeAbiParameters(
    parseAbiParameters("address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks"),
    [currency0, currency1, poolFee, tickSpacing, PONS_V2_MEME_HOOK]
  ));
}

function curveActivity(logs: readonly VerifiedContractLog[], nowMs: number) {
  let buys1h = 0;
  let sells1h = 0;
  let buys24h = 0;
  let sells24h = 0;
  let volumeQuote24h = 0;
  let lastActivityAt: string | null = null;
  for (const log of logs) {
    const buy = log.method?.startsWith("CurveBuy(") === true;
    const sell = log.method?.startsWith("CurveSell(") === true;
    if (!buy && !sell) continue;
    const ageMs = nowMs - Date.parse(log.blockTimestamp);
    if (ageMs <= 60 * 60 * 1_000) buy ? buys1h += 1 : sells1h += 1;
    if (ageMs <= 24 * 60 * 60 * 1_000) {
      buy ? buys24h += 1 : sells24h += 1;
      const value = log.parameters.get(buy ? "quoteIn" : "quoteOut");
      if (value && /^\d+$/.test(value)) volumeQuote24h += Number(BigInt(value)) / 1e18;
    }
    if (!lastActivityAt || Date.parse(log.blockTimestamp) > Date.parse(lastActivityAt)) lastActivityAt = log.blockTimestamp;
  }
  return { buys1h, sells1h, buys24h, sells24h, volumeQuote24h, lastActivityAt };
}

async function optionalTokenText(client: PublicClient, token: Address, functionName: "logo" | "description") {
  return client.readContract({ address: token, abi: tokenAbi, functionName }).catch(() => "");
}

async function readPonsV2Market(
  client: PublicClient,
  token: Address,
  launchEvent: LaunchEvent | undefined,
  nowMs: number,
  fetcher: typeof fetch | undefined,
  readInventory: InventoryReader,
  requireBrowseRelevance: boolean
): Promise<ExternalMarket | null> {
  const [record, hook, name, symbol, logo, description, socials] = await Promise.all([
    client.readContract({ address: PONS_V2_FACTORY, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] }),
    client.readContract({ address: PONS_V2_FACTORY, abi: factoryAbi, functionName: "memeHook" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
    optionalTokenText(client, token, "logo"),
    optionalTokenText(client, token, "description"),
    client.readContract({ address: token, abi: tokenAbi, functionName: "socials" }).catch(() => ["", "", "", "", ""] as const)
  ]);
  if (!record.exists || getAddress(record.token) !== token || getAddress(hook) !== PONS_V2_MEME_HOOK) return null;
  if (launchEvent && (launchEvent.curve !== getAddress(record.curve) || launchEvent.creator !== getAddress(record.deployer))) return null;
  const phase = Number(record.phase);
  const state: LaunchpadLifecycleEvidence["state"] = phase === 0 ? "curve-live" : phase === 1 ? "swept" : phase === 2 ? "graduated" : "aborted";
  const activityLogs = state === "curve-live" && requireBrowseRelevance
    ? await fetchVerifiedContractLogs(record.curve, { pages: 1, fetch: fetcher }).catch(() => [])
    : [];
  const observedActivity = activityLogs.length > 0 ? curveActivity(activityLogs, nowMs) : null;
  const activity = observedActivity ?? {
    buys1h: null,
    sells1h: null,
    buys24h: null,
    sells24h: null,
    volumeQuote24h: null,
    lastActivityAt: null
  };
  const poolId = state === "graduated"
    ? ponsV2PoolId(token, getAddress(record.pairToken), Number(record.poolFee), Number(record.tickSpacing))
    : null;
  const canonicalPool = poolId === null
    ? null
    : await readInventory({ token, source: "uniswap-v4", limit: 100 }).then((inventory) => (
        inventory.status === "verified_shadow"
          ? inventory.pools.find((pool) => (
              pool.poolKey.toLowerCase() === poolId.toLowerCase()
              && pool.poolAddress === null
              && pool.hooks?.toLowerCase() === PONS_V2_MEME_HOOK.toLowerCase()
              && (pool.token0.toLowerCase() === token.toLowerCase() || pool.token1.toLowerCase() === token.toLowerCase())
            )) ?? null
          : null
      )).catch(() => null);
  const initializedCanonicalV4Pool = poolId === null || canonicalPool
    ? canonicalPool !== null
    : await client.readContract({
        address: ROBINHOOD_V4_STATE_VIEW,
        abi: v4StateViewAbi,
        functionName: "getSlot0",
        args: [poolId]
      }).then((slot0) => slot0[0] > 0n).catch(() => false);
  if (state === "graduated" && !initializedCanonicalV4Pool) return null;
  const launchAtMs = launchEvent ? Date.parse(launchEvent.timestamp) : null;
  const lifecycle: LaunchpadLifecycleEvidence = {
    sourceId: "pons-v2",
    sourceName: "Pons V2",
    version: "v2",
    factory: PONS_V2_FACTORY,
    creator: getAddress(record.deployer),
    launchId: null,
    launchBlock: launchEvent?.blockNumber ?? null,
    launchTransactionHash: launchEvent?.transactionHash ?? null,
    state,
    current: state !== "aborted",
    metricsState: "unavailable",
    venue: {
      kind: state === "graduated" ? "canonical-pool" : state === "curve-live" ? "bonding-curve" : "launch-pending",
      address: state === "curve-live" ? getAddress(record.curve) : null,
      poolId
    },
    activity,
    provenance: "verified-contract-state-and-events"
  };
  if (requireBrowseRelevance && !launchpadEvidenceIsBrowseRelevant(lifecycle, launchAtMs, initializedCanonicalV4Pool, nowMs)) return null;
  const project: ExternalProjectMetadata = {
    sourceId: "pons-v2",
    sourceName: "Pons V2",
    provenance: "factory-and-token-cross-checked",
    creator: getAddress(record.deployer),
    launchPool: getAddress(record.curve),
    name: bounded(name, 80),
    symbol: bounded(symbol, 20),
    description: bounded(description, 1_000),
    imageUri: safePonsImageUri(logo),
    socials: {
      x: safePonsSocialUrl(socials[0]),
      telegram: safePonsSocialUrl(socials[1]),
      discord: safePonsSocialUrl(socials[2]),
      website: safePonsSocialUrl(socials[3]),
      farcaster: safePonsSocialUrl(socials[4])
    }
  };
  const ageMinutes = launchAtMs === null ? null : Math.max(0, Math.floor((nowMs - launchAtMs) / 60_000));
  const buys1h = observedActivity?.buys1h ?? 0;
  const sells1h = observedActivity?.sells1h ?? 0;
  const buys24h = observedActivity?.buys24h ?? 0;
  const sells24h = observedActivity?.sells24h ?? 0;
  const trades1h = buys1h + sells1h;
  return {
    address: token,
    name: project.name,
    symbol: project.symbol,
    imageUri: project.imageUri ?? undefined,
    pairAddress: state === "curve-live" ? getAddress(record.curve) : PONS_V2_FACTORY,
    url: `https://pons.fun/token/${token.toLowerCase()}`,
    dexId: state === "graduated" ? "pons-v2-uniswap-v4" : "pons-v2-curve",
    project,
    launchpadEvidence: [lifecycle],
    origin: { kind: "external", state: "unknown", coverage: "partial" },
    venue: { kind: "external-launchpad", sourceId: "pons-v2", market: getAddress(record.curve), execution: "read-only" },
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
    buys1h,
    sells1h,
    buys24h,
    sells24h,
    pairCreatedAt: launchAtMs,
    ageMinutes,
    momentumScore: Math.min(100, trades1h * 12 + (state === "curve-live" ? 20 : 0)),
    buyPressureBps: trades1h > 0 ? Math.round(buys1h * 10_000 / trades1h) : 0,
    signal: trades1h >= 4 ? "moving" : trades1h > 0 || (ageMinutes !== null && ageMinutes <= 24 * 60) ? "early" : "active",
    riskFlags: []
  };
}

export async function fetchPonsV2LaunchMarkets(
  client: PublicClient,
  options: { token?: Address; nowMs?: number; fetch?: typeof fetch; readInventory?: InventoryReader } = {}
) {
  const nowMs = options.nowMs ?? Date.now();
  const readInventory = options.readInventory ?? readVNextCanonicalMarketInventory;
  if (options.token) {
    const market = await readPonsV2Market(client, getAddress(options.token), undefined, nowMs, options.fetch, readInventory, false).catch(() => null);
    return market ? [market] : [];
  }
  const logs = await fetchVerifiedContractLogs(PONS_V2_FACTORY, { pages: 1, fetch: options.fetch });
  const events = ponsV2LaunchEvents(logs);
  const markets = await Promise.all(events.map((event) => readPonsV2Market(client, event.token, event, nowMs, options.fetch, readInventory, true).catch(() => null)));
  return markets.filter((market): market is ExternalMarket => Boolean(market))
    .sort((left, right) => (
      (right.buys1h + right.sells1h) - (left.buys1h + left.sells1h)
      || (left.ageMinutes ?? Number.MAX_SAFE_INTEGER) - (right.ageMinutes ?? Number.MAX_SAFE_INTEGER)
      || left.address.toLowerCase().localeCompare(right.address.toLowerCase())
    ))
    .slice(0, MAX_RESULTS);
}
