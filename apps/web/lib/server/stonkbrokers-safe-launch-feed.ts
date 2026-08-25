import {
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type PublicClient
} from "viem";
import type { ExternalMarket, ExternalProjectMetadata, LaunchpadLifecycleEvidence } from "../external-market";
import { launchpadEvidenceIsBrowseRelevant } from "../launchpad-lifecycle";
import { fetchVerifiedContractLogs, type VerifiedContractLog } from "./blockscout-contract-logs";

export const STONKBROKERS_SAFE_LAUNCHPAD = getAddress("0xEcA5726dae1e53365c37fFc02369d947A91d71f9");
export const STONKBROKERS_SAFE_LAUNCH_DEPLOY_BLOCK = 38_814_054n;
export const STONKBROKERS_SAFE_LAUNCH_DEPLOY_TRANSACTION = "0x11b1a6028ca6ee91ad3f33f9c950c5b5ac189d38aeb298272c26dd8f5d3c1730";

const MAX_BROWSE_LAUNCHES = 10;
const MAX_CANDIDATE_LAUNCHES = 32n;
const MAX_ACTIVITY_LAUNCHES = 8;

export const stonkSafeLaunchpadAbi = [{
  type: "function",
  name: "launchCount",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }]
}, {
  type: "function",
  name: "launchIdOfToken",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{ type: "uint256" }]
}, {
  type: "function",
  name: "getLaunch",
  stateMutability: "view",
  inputs: [{ name: "id", type: "uint256" }],
  outputs: [{
    type: "tuple",
    components: [
      { name: "token", type: "address" },
      { name: "creator", type: "address" },
      { name: "startMcapUsd8", type: "uint64" },
      { name: "gradMcapUsd8", type: "uint64" },
      { name: "startTaxBps", type: "uint16" },
      { name: "decayPerMinuteBps", type: "uint16" },
      { name: "creatorFeeBpsSnap", type: "uint16" },
      { name: "protocolFeeBpsSnap", type: "uint16" },
      { name: "windowSecs", type: "uint32" },
      { name: "startTime", type: "uint64" },
      { name: "deadline", type: "uint64" },
      { name: "externalToken", type: "bool" },
      { name: "sellsEnabled", type: "bool" },
      { name: "armed", type: "bool" },
      { name: "graduated", type: "bool" },
      { name: "bonded", type: "bool" },
      { name: "aborted", type: "bool" },
      { name: "loadedSupply", type: "uint256" },
      { name: "vEth", type: "uint256" },
      { name: "vToken", type: "uint256" },
      { name: "realEth", type: "uint256" },
      { name: "buyCount", type: "uint256" }
    ]
  }]
}, {
  type: "function",
  name: "poolsOf",
  stateMutability: "view",
  inputs: [{ name: "id", type: "uint256" }],
  outputs: [{ name: "pools", type: "address[]" }, { name: "lockIds", type: "uint256[]" }]
}, {
  type: "function",
  name: "viewLaunches",
  stateMutability: "view",
  inputs: [{ name: "startId", type: "uint256" }, { name: "count", type: "uint256" }],
  outputs: [{
    name: "out",
    type: "tuple[]",
    components: [
      { name: "id", type: "uint256" },
      {
        name: "core",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "creator", type: "address" },
          { name: "startMcapUsd8", type: "uint64" },
          { name: "gradMcapUsd8", type: "uint64" },
          { name: "startTaxBps", type: "uint16" },
          { name: "decayPerMinuteBps", type: "uint16" },
          { name: "creatorFeeBpsSnap", type: "uint16" },
          { name: "protocolFeeBpsSnap", type: "uint16" },
          { name: "windowSecs", type: "uint32" },
          { name: "startTime", type: "uint64" },
          { name: "deadline", type: "uint64" },
          { name: "externalToken", type: "bool" },
          { name: "sellsEnabled", type: "bool" },
          { name: "armed", type: "bool" },
          { name: "graduated", type: "bool" },
          { name: "bonded", type: "bool" },
          { name: "aborted", type: "bool" },
          { name: "loadedSupply", type: "uint256" },
          { name: "vEth", type: "uint256" },
          { name: "vToken", type: "uint256" },
          { name: "realEth", type: "uint256" },
          { name: "buyCount", type: "uint256" }
        ]
      },
      { name: "taxBps", type: "uint256" },
      { name: "mcapUsd8Now", type: "uint256" },
      { name: "tokensSold", type: "uint256" },
      { name: "oracleFresh", type: "bool" },
      { name: "legs", type: "address[]" },
      { name: "pools", type: "address[]" },
      { name: "lockIds", type: "uint256[]" },
      { name: "lpEth", type: "uint256" },
      { name: "lpFeeBpsSnap", type: "uint16" },
      { name: "closedAtTs", type: "uint64" }
    ]
  }]
}] as const;

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

type Launch = Awaited<ReturnType<typeof readLaunch>>;

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

function eventId(log: VerifiedContractLog) {
  const value = log.parameters.get("id");
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function eventAmountWei(log: VerifiedContractLog, name: "ethIn" | "ethOut" | "taxPaid") {
  const value = log.parameters.get(name);
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export function stonkSafeLaunchActivity(logs: readonly VerifiedContractLog[], id: bigint, nowMs: number) {
  let buys1h = 0;
  let sells1h = 0;
  let buys24h = 0;
  let sells24h = 0;
  let volumeQuoteWei24h = 0n;
  let lastActivityAt: string | null = null;
  let launchBlock: string | null = null;
  let launchTransactionHash: string | null = null;
  for (const log of logs) {
    if (eventId(log) !== id) continue;
    const ageMs = nowMs - Date.parse(log.blockTimestamp);
    if (log.method?.startsWith("LaunchCreated(")) {
      launchBlock = log.blockNumber.toString();
      launchTransactionHash = log.transactionHash;
    }
    const buy = log.method?.startsWith("SafeBuy(") === true;
    const sell = log.method?.startsWith("SafeSell(") === true;
    if (!buy && !sell) continue;
    if (ageMs <= 60 * 60 * 1_000) buy ? buys1h += 1 : sells1h += 1;
    if (ageMs <= 24 * 60 * 60 * 1_000) {
      buy ? buys24h += 1 : sells24h += 1;
      volumeQuoteWei24h += buy
        ? eventAmountWei(log, "ethIn")
        : eventAmountWei(log, "ethOut") + eventAmountWei(log, "taxPaid");
    }
    if (!lastActivityAt || Date.parse(log.blockTimestamp) > Date.parse(lastActivityAt)) lastActivityAt = log.blockTimestamp;
  }
  return {
    buys1h,
    sells1h,
    buys24h,
    sells24h,
    volumeQuote24h: Number(formatUnits(volumeQuoteWei24h, 18)),
    lastActivityAt,
    launchBlock,
    launchTransactionHash
  };
}

async function readLaunch(client: PublicClient, id: bigint) {
  const [core, poolEvidence] = await Promise.all([
    client.readContract({ address: STONKBROKERS_SAFE_LAUNCHPAD, abi: stonkSafeLaunchpadAbi, functionName: "getLaunch", args: [id] }),
    client.readContract({ address: STONKBROKERS_SAFE_LAUNCHPAD, abi: stonkSafeLaunchpadAbi, functionName: "poolsOf", args: [id] })
  ]);
  if (!isAddress(core.token) || getAddress(core.token) === zeroAddress) return null;
  const [name, symbol] = await Promise.all([
    client.readContract({ address: core.token, abi: tokenAbi, functionName: "name" }),
    client.readContract({ address: core.token, abi: tokenAbi, functionName: "symbol" })
  ]);
  const safePools = poolEvidence[0].filter((pool): pool is Address => isAddress(pool) && getAddress(pool) !== zeroAddress).map(getAddress);
  return { id, core, pools: safePools, name: bounded(name, 80), symbol: bounded(symbol, 20) };
}

async function readTokenIdentity(client: PublicClient, token: Address) {
  const [name, symbol] = await Promise.all([
    client.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" })
  ]);
  const safeName = bounded(name, 80);
  const safeSymbol = bounded(symbol, 20);
  return safeName && safeSymbol ? { name: safeName, symbol: safeSymbol } : null;
}

function lifecycleState(launch: NonNullable<Launch>): LaunchpadLifecycleEvidence["state"] {
  if (launch.core.aborted) return "aborted";
  if (launch.core.graduated || launch.core.bonded) return "graduated";
  if (launch.core.armed) return "armed";
  return "created";
}

function launchIsBrowseRelevant(
  launch: NonNullable<Launch>,
  logs: readonly VerifiedContractLog[] | null,
  nowMs: number
) {
  const state = lifecycleState(launch);
  const activity = logs ? stonkSafeLaunchActivity(logs, launch.id, nowMs) : null;
  const startedAtMs = Number(launch.core.startTime) > 0 ? Number(launch.core.startTime) * 1_000 : null;
  return launchpadEvidenceIsBrowseRelevant({
    sourceId: "stonkbrokers-safe-launch",
    sourceName: "StonkBrokers Smart/Safe Launch",
    version: "current",
    factory: STONKBROKERS_SAFE_LAUNCHPAD,
    creator: getAddress(launch.core.creator),
    launchId: launch.id.toString(),
    launchBlock: activity?.launchBlock ?? null,
    launchTransactionHash: activity?.launchTransactionHash ?? null,
    state,
    current: state !== "aborted",
    metricsState: "unavailable",
    venue: { kind: "unavailable", address: null, poolId: null },
    activity: {
      buys1h: activity?.buys1h ?? null,
      sells1h: activity?.sells1h ?? null,
      buys24h: activity?.buys24h ?? null,
      sells24h: activity?.sells24h ?? null,
      volumeQuote24h: activity?.volumeQuote24h ?? null,
      lastActivityAt: activity?.lastActivityAt ?? null
    },
    provenance: "verified-contract-state-and-events"
  }, startedAtMs, false, nowMs);
}

async function readBrowseLaunches(client: PublicClient, logs: readonly VerifiedContractLog[] | null, nowMs: number) {
  const views = await client.readContract({
    address: STONKBROKERS_SAFE_LAUNCHPAD,
    abi: stonkSafeLaunchpadAbi,
    functionName: "viewLaunches",
    args: [0n, MAX_CANDIDATE_LAUNCHES]
  });
  const viewIds = new Set(views.map((view) => view.id.toString()));
  const activityIds = [...new Set((logs ?? []).flatMap((log) => {
    if (!log.method?.startsWith("SafeBuy(") && !log.method?.startsWith("SafeSell(")) return [];
    const id = eventId(log);
    const ageMs = nowMs - Date.parse(log.blockTimestamp);
    return id !== null && id > 0n && ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1_000 && !viewIds.has(id.toString())
      ? [id]
      : [];
  }))].slice(0, MAX_ACTIVITY_LAUNCHES);
  const activityViews = await Promise.all(activityIds.map((id) => client.readContract({
    address: STONKBROKERS_SAFE_LAUNCHPAD,
    abi: stonkSafeLaunchpadAbi,
    functionName: "viewLaunches",
    args: [id, 1n]
  }).catch(() => [])));
  const candidates = [...views, ...activityViews.flat()].flatMap((view) => {
    if (!isAddress(view.core.token) || getAddress(view.core.token) === zeroAddress) return [];
    const launch = {
      id: view.id,
      core: view.core,
      pools: view.pools
        .filter((pool): pool is Address => isAddress(pool) && getAddress(pool) !== zeroAddress)
        .map(getAddress),
      name: "",
      symbol: ""
    } satisfies NonNullable<Launch>;
    return launchIsBrowseRelevant(launch, logs, nowMs) ? [launch] : [];
  }).slice(0, MAX_BROWSE_LAUNCHES);
  return (await Promise.all(candidates.map(async (launch) => {
    const token = getAddress(launch.core.token);
    const identity = await readTokenIdentity(client, token).catch(() => null);
    return identity ? { ...launch, ...identity } : null;
  }))).filter((launch): launch is NonNullable<Launch> => launch !== null);
}

function marketFromLaunch(
  launch: NonNullable<Launch>,
  logs: readonly VerifiedContractLog[] | null,
  nowMs: number,
  requireBrowseRelevance: boolean
): ExternalMarket | null {
  const observedActivity = logs ? stonkSafeLaunchActivity(logs, launch.id, nowMs) : null;
  const activity = observedActivity ?? {
    buys1h: 0,
    sells1h: 0,
    buys24h: 0,
    sells24h: 0,
    volumeQuote24h: 0,
    lastActivityAt: null,
    launchBlock: null,
    launchTransactionHash: null
  };
  const state = lifecycleState(launch);
  const startedAtMs = Number(launch.core.startTime) > 0 ? Number(launch.core.startTime) * 1_000 : null;
  const launchpad: LaunchpadLifecycleEvidence = {
    sourceId: "stonkbrokers-safe-launch",
    sourceName: "StonkBrokers Smart/Safe Launch",
    version: "current",
    factory: STONKBROKERS_SAFE_LAUNCHPAD,
    creator: getAddress(launch.core.creator),
    launchId: launch.id.toString(),
    launchBlock: activity.launchBlock,
    launchTransactionHash: activity.launchTransactionHash,
    state,
    current: state !== "aborted",
    metricsState: "unavailable",
    venue: {
      kind: launch.pools.length > 0
        ? "source-market"
        : state === "graduated"
          ? "unavailable"
          : launch.core.armed ? "bonding-curve" : "launch-pending",
      address: launch.pools[0] ?? (state === "graduated" ? null : STONKBROKERS_SAFE_LAUNCHPAD),
      poolId: null
    },
    activity: {
      buys1h: observedActivity?.buys1h ?? null,
      sells1h: observedActivity?.sells1h ?? null,
      buys24h: observedActivity?.buys24h ?? null,
      sells24h: observedActivity?.sells24h ?? null,
      volumeQuote24h: observedActivity?.volumeQuote24h ?? null,
      lastActivityAt: activity.lastActivityAt
    },
    provenance: "verified-contract-state-and-events"
  };
  if (requireBrowseRelevance && !launchpadEvidenceIsBrowseRelevant(launchpad, startedAtMs, false, nowMs)) return null;
  const ageMinutes = startedAtMs === null ? null : Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
  const tradeCount1h = activity.buys1h + activity.sells1h;
  const project: ExternalProjectMetadata = {
    sourceId: "stonkbrokers-safe-launch",
    sourceName: "StonkBrokers Smart/Safe Launch",
    provenance: "launchpad-and-token-cross-checked",
    creator: getAddress(launch.core.creator),
    launchPool: STONKBROKERS_SAFE_LAUNCHPAD,
    name: launch.name,
    symbol: launch.symbol,
    description: "Current StonkBrokers Smart/Safe Launch lifecycle evidence.",
    imageUri: null,
    socials: { x: null, telegram: null, discord: null, website: null, farcaster: null }
  };
  return {
    address: getAddress(launch.core.token),
    name: launch.name,
    symbol: launch.symbol,
    pairAddress: launch.pools[0] ?? STONKBROKERS_SAFE_LAUNCHPAD,
    url: `https://robinhoodchain.blockscout.com/address/${launch.core.token}`,
    dexId: "stonkbrokers-safe-launch",
    project,
    launchpadEvidence: [launchpad],
    origin: { kind: "external", state: "unknown", coverage: "partial" },
    venue: { kind: "external-launchpad", sourceId: "stonkbrokers-safe-launch", market: STONKBROKERS_SAFE_LAUNCHPAD, execution: "read-only" },
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
    buys1h: activity.buys1h,
    sells1h: activity.sells1h,
    buys24h: activity.buys24h,
    sells24h: activity.sells24h,
    pairCreatedAt: startedAtMs,
    ageMinutes,
    momentumScore: Math.min(100, tradeCount1h * 12 + (state === "armed" ? 20 : 0)),
    buyPressureBps: tradeCount1h > 0 ? Math.round(activity.buys1h * 10_000 / tradeCount1h) : 0,
    signal: tradeCount1h >= 4 ? "moving" : tradeCount1h > 0 || (ageMinutes !== null && ageMinutes <= 24 * 60) ? "early" : "active",
    riskFlags: []
  };
}

export async function fetchStonkBrokersSafeLaunchMarkets(
  client: PublicClient,
  options: { token?: Address; nowMs?: number; fetch?: typeof fetch } = {}
) {
  const nowMs = options.nowMs ?? Date.now();
  const logsPromise = options.token
    ? Promise.resolve(null)
    : fetchVerifiedContractLogs(STONKBROKERS_SAFE_LAUNCHPAD, { pages: 1, fetch: options.fetch }).catch(() => null);
  let launches: Array<NonNullable<Launch>>;
  if (options.token) {
    const id = await client.readContract({
      address: STONKBROKERS_SAFE_LAUNCHPAD,
      abi: stonkSafeLaunchpadAbi,
      functionName: "launchIdOfToken",
      args: [getAddress(options.token)]
    });
    launches = id > 0n ? [await readLaunch(client, id).catch(() => null)].filter((launch): launch is NonNullable<Launch> => launch !== null) : [];
  } else {
    const logs = await logsPromise;
    launches = await readBrowseLaunches(client, logs, nowMs);
    return launches.flatMap((launch) => {
      const market = marketFromLaunch(launch, logs, nowMs, false);
      return market ? [market] : [];
    }).sort((left, right) => (
      (right.buys1h + right.sells1h) - (left.buys1h + left.sells1h)
      || (left.ageMinutes ?? Number.MAX_SAFE_INTEGER) - (right.ageMinutes ?? Number.MAX_SAFE_INTEGER)
      || left.address.toLowerCase().localeCompare(right.address.toLowerCase())
    )).slice(0, MAX_BROWSE_LAUNCHES);
  }
  const logs = await logsPromise;
  return launches.flatMap((launch) => {
    const market = launch ? marketFromLaunch(launch, logs, nowMs, !options.token) : null;
    return market ? [market] : [];
  }).sort((left, right) => (
    (right.buys1h + right.sells1h) - (left.buys1h + left.sells1h)
    || (left.ageMinutes ?? Number.MAX_SAFE_INTEGER) - (right.ageMinutes ?? Number.MAX_SAFE_INTEGER)
    || left.address.toLowerCase().localeCompare(right.address.toLowerCase())
  )).slice(0, options.token ? 1 : MAX_BROWSE_LAUNCHES);
}
