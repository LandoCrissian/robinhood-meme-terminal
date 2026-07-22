import {
  formatEther,
  getAddress,
  isAddress,
  type Address,
  type PublicClient
} from "viem";
import type { ExternalMarket, ExternalProjectMetadata } from "../external-market";
import { safePonsImageUri, safePonsSocialUrl } from "./pons-project-metadata";

export const CIRCUS_LAUNCHPAD = getAddress("0xb7fa26c6fcb8801cabc538b82a6e80ae1c43cb00");
export const CIRCUS_WETH = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
const CIRCUS_FEED = "https://circus.trade/api/launches?mode=real";
const CIRCUS_PAGE = "https://circus.trade/coin/";
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_CANDIDATES = 10;
const MAX_RESULTS = 8;

export type CircusCurveRankingInput = {
  progressBps: number;
  ethRaised: number;
  uniqueTraders: number;
  tradeDiversity: number;
  liquidityUsd: number;
  lastTradeAt: number;
};

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function logSignal(value: number, floor: number, ceiling: number) {
  const safeValue = Math.max(0, finite(value));
  return clamp(Math.log1p(safeValue / floor) / Math.log1p(ceiling / floor));
}

export function rankCircusCurveMarket(
  input: CircusCurveRankingInput,
  nowSeconds = Math.floor(Date.now() / 1_000)
): Pick<ExternalMarket, "momentumScore" | "signal"> {
  const progress = clamp(input.progressBps / 10_000);
  const raised = logSignal(input.ethRaised, 0.05, 6.5);
  const traders = logSignal(input.uniqueTraders, 2, 250);
  const diversity = clamp(input.tradeDiversity);
  const liquidity = logSignal(input.liquidityUsd, 100, 5_000);
  const tradeAgeHours = input.lastTradeAt > 0
    ? Math.max(0, nowSeconds - input.lastTradeAt) / 3_600
    : Number.POSITIVE_INFINITY;
  const recency = Number.isFinite(tradeAgeHours) ? clamp(1 - tradeAgeHours / 24) : 0;
  const momentumScore = Math.round(100 * clamp(
    0.3 * Math.sqrt(progress)
      + 0.2 * raised
      + 0.2 * traders
      + 0.1 * diversity
      + 0.1 * liquidity
      + 0.1 * recency
  ));
  const signal = momentumScore >= 60 && recency >= 0.5 && input.uniqueTraders >= 10 && input.progressBps > 0
    ? "moving"
    : momentumScore >= 35 && input.progressBps > 0
      ? "early"
      : "active";
  return { momentumScore, signal };
}

const circusLaunchpadAbi = [
  {
    type: "function",
    name: "tokenState",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "graduated", type: "bool" },
      { name: "migrated", type: "bool" },
      { name: "ethIn", type: "uint256" },
      { name: "tokensSold", type: "uint256" },
      { name: "creatorFeesEth", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "curveInfo",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "ethReserve", type: "uint256" },
      { name: "tokenReserve", type: "uint256" },
      { name: "tokensSold", type: "uint256" },
      { name: "curveSupply", type: "uint256" },
      { name: "graduated", type: "bool" },
      { name: "migrated", type: "bool" }
    ]
  }
] as const;

const circusTokenAbi = [
  { type: "function", name: "launchpad", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

type Candidate = {
  token: Address;
  creator: Address;
  quote: Address;
  name: string;
  symbol: string;
  metadataUri: string;
  imageUri: string | null;
  description: string;
  socials: ExternalProjectMetadata["socials"];
  createdAt: number;
  lastTradeAt: number;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volumeQuoteEth: number;
  uniqueTraders: number;
  tradeDiversity: number;
  sourceScore: number;
  sourceProgressBps: number;
};

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function address(value: unknown) {
  const candidate = text(value, 42);
  return isAddress(candidate) ? getAddress(candidate) : null;
}

function parseCandidate(value: unknown): Candidate | null {
  const coin = object(value);
  const state = object(object(coin.mech).state);
  const stats = object(coin.stats);
  const signals = object(coin.signals);
  const meta = object(coin.meta);
  const token = address(coin.token);
  const creator = address(coin.creator);
  const quote = address(coin.quote);
  const name = text(coin.name, 80);
  const symbol = text(coin.symbol, 20);
  const metadataUri = text(coin.metadataURI, 1_000);
  if (
    coin.mechanism !== "curve"
    || !token
    || !creator
    || quote !== CIRCUS_WETH
    || !name
    || !symbol
    || state.graduated !== false
    || state.migrated !== false
  ) return null;

  return {
    token,
    creator,
    quote,
    name,
    symbol,
    metadataUri,
    imageUri: safePonsImageUri(text(meta.image, 500)),
    description: text(meta.description, 1_000),
    socials: {
      x: safePonsSocialUrl(text(meta.twitter, 500)),
      telegram: safePonsSocialUrl(text(meta.telegram, 500)),
      discord: safePonsSocialUrl(text(meta.discord, 500)),
      website: safePonsSocialUrl(text(meta.website, 500)),
      farcaster: safePonsSocialUrl(text(meta.farcaster, 500))
    },
    createdAt: Math.max(0, Math.trunc(number(coin.createdAt))),
    lastTradeAt: Math.max(0, Math.trunc(number(coin.lastTradeAt))),
    priceUsd: Math.max(0, number(stats.price)),
    marketCapUsd: Math.max(0, number(stats.mcapUsd)),
    liquidityUsd: Math.max(0, number(signals.liquidityUsd)),
    volumeQuoteEth: Math.max(0, number(stats.volumeQuote)),
    uniqueTraders: Math.max(0, Math.trunc(number(signals.uniqueTraders))),
    tradeDiversity: Math.max(0, Math.min(1, number(signals.tradeDiversity))),
    sourceScore: Math.max(0, number(signals.score)),
    sourceProgressBps: Math.max(0, Math.min(10_000, Math.trunc(number(state.progressBps))))
  };
}

export function parseCircusCurveFeed(payload: unknown) {
  const coins = object(payload).coins;
  if (!Array.isArray(coins)) throw new Error("Circus launch feed was malformed");
  return coins.map(parseCandidate).filter((coin): coin is Candidate => Boolean(coin))
    .sort((left, right) =>
      right.sourceScore - left.sourceScore
      || right.sourceProgressBps - left.sourceProgressBps
      || right.lastTradeAt - left.lastTradeAt
      || left.token.toLowerCase().localeCompare(right.token.toLowerCase())
    )
    .slice(0, MAX_CANDIDATES);
}

async function fetchPayload(fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(CIRCUS_FEED, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Circus launch feed failed with " + response.status);
    const announced = Number(response.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) {
      throw new Error("Circus launch feed exceeded its size limit");
    }
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new Error("Circus launch feed exceeded its size limit");
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function crossCheckCandidate(client: PublicClient, candidate: Candidate): Promise<ExternalMarket | null> {
  const token = candidate.token;
  const [tokenState, curveInfo, launchpad, creator, name, symbol, tokenUri] = await Promise.all([
    client.readContract({ address: CIRCUS_LAUNCHPAD, abi: circusLaunchpadAbi, functionName: "tokenState", args: [token] }),
    client.readContract({ address: CIRCUS_LAUNCHPAD, abi: circusLaunchpadAbi, functionName: "curveInfo", args: [token] }),
    client.readContract({ address: token, abi: circusTokenAbi, functionName: "launchpad" }),
    client.readContract({ address: token, abi: circusTokenAbi, functionName: "creator" }),
    client.readContract({ address: token, abi: circusTokenAbi, functionName: "name" }),
    client.readContract({ address: token, abi: circusTokenAbi, functionName: "symbol" }),
    client.readContract({ address: token, abi: circusTokenAbi, functionName: "tokenURI" })
  ]);
  const [recordedCreator, graduated, migrated, ethIn, tokensSold] = tokenState;
  const [, , curveTokensSold, curveSupply, curveGraduated, curveMigrated] = curveInfo;
  if (
    getAddress(launchpad) !== CIRCUS_LAUNCHPAD
    || getAddress(creator) !== candidate.creator
    || getAddress(recordedCreator) !== candidate.creator
    || text(name, 80) !== candidate.name
    || text(symbol, 20) !== candidate.symbol
    || text(tokenUri, 1_000) !== candidate.metadataUri
    || graduated
    || migrated
    || curveGraduated
    || curveMigrated
    || tokensSold !== curveTokensSold
    || curveSupply <= 0n
  ) return null;

  const progressBps = Number(tokensSold * 10_000n / curveSupply);
  const ethRaised = Number(formatEther(ethIn));
  const ageMinutes = candidate.createdAt > 0
    ? Math.max(0, Math.floor((Date.now() - candidate.createdAt * 1_000) / 60_000))
    : null;
  const riskFlags: ExternalMarket["riskFlags"] = [];
  if (candidate.liquidityUsd < 1_000) riskFlags.push("thin-liquidity");
  if (ageMinutes !== null && ageMinutes < 15) riskFlags.push("very-new-low-activity");
  const ranking = rankCircusCurveMarket({
    progressBps,
    ethRaised,
    uniqueTraders: candidate.uniqueTraders,
    tradeDiversity: candidate.tradeDiversity,
    liquidityUsd: candidate.liquidityUsd,
    lastTradeAt: candidate.lastTradeAt
  });
  const project: ExternalProjectMetadata = {
    sourceId: "circus",
    sourceName: "Circus",
    provenance: "launchpad-and-token-cross-checked",
    creator: candidate.creator,
    launchPool: CIRCUS_LAUNCHPAD,
    name: candidate.name,
    symbol: candidate.symbol,
    description: candidate.description,
    imageUri: candidate.imageUri,
    socials: candidate.socials
  };
  return {
    address: token,
    name: candidate.name,
    symbol: candidate.symbol,
    pairAddress: CIRCUS_LAUNCHPAD,
    url: CIRCUS_PAGE + token.toLowerCase(),
    dexId: "circus-curve",
    project,
    origin: { kind: "external", state: "unknown", coverage: "unavailable" },
    venue: { kind: "external-launchpad", sourceId: "circus", market: token, execution: "read-only" },
    curve: {
      sourceId: "circus",
      state: "curve-live",
      progressBps,
      ethRaised,
      tokensSold: tokensSold.toString(),
      curveSupply: curveSupply.toString(),
      volumeQuoteEth: candidate.volumeQuoteEth,
      uniqueTraders: candidate.uniqueTraders,
      tradeDiversity: candidate.tradeDiversity,
      graduated: false,
      migrated: false,
      dataSource: "circus-public-feed-cross-checked-onchain"
    },
    priceUsd: candidate.priceUsd,
    liquidityUsd: candidate.liquidityUsd,
    marketCapUsd: candidate.marketCapUsd,
    fdvUsd: candidate.marketCapUsd,
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
    pairCreatedAt: candidate.createdAt > 0 ? candidate.createdAt * 1_000 : null,
    ageMinutes,
    momentumScore: ranking.momentumScore,
    buyPressureBps: 0,
    signal: ranking.signal,
    riskFlags
  };
}

export async function fetchCircusCurveMarkets(
  client: PublicClient,
  fetchImpl: typeof fetch = fetch
) {
  const candidates = parseCircusCurveFeed(await fetchPayload(fetchImpl));
  const markets: ExternalMarket[] = [];
  const concurrency = 3;
  for (let index = 0; index < candidates.length && markets.length < MAX_RESULTS; index += concurrency) {
    const chunk = candidates.slice(index, index + concurrency);
    const checked = await Promise.all(chunk.map((candidate) =>
      crossCheckCandidate(client, candidate).catch(() => null)
    ));
    for (const market of checked) if (market && markets.length < MAX_RESULTS) markets.push(market);
  }
  return markets;
}
