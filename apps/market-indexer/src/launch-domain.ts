import { decodeEventLog, parseAbi, zeroAddress, type Hex } from "viem";
import type { LaunchEvidence } from "@rmt/shared/launch-intelligence";
import { stonkPadAbi } from "./launch-abi.js";
import type { LaunchSourceManifest } from "./launch-sources.js";

// Read-only ABIs transcribed from pinned official Pons source, recorded in the authority document.
export const ponsV1Abi = parseAbi([
  "event TokenLaunched(address indexed token,address indexed deployer,address indexed dexFactory,address pairToken,address pool,uint256 dexId,uint256 launchConfigId,uint256 positionId,uint256 restrictionsEndBlock,uint256 initialBuyAmount)",
  "function getLaunchedToken(address token) view returns ((address token,address deployer,address pairedToken,address positionManager,uint256 positionId,uint256 dexId,uint256 launchConfigId,uint256 restrictionsEndBlock,uint256 supply,bool isToken0,uint24 poolFee,bool exists,uint256 initialBuyAmount))",
  "function graduationStatus(address token) view returns (uint256 pairedPrincipal,uint256 threshold,bool graduated)",
  "function locker() view returns (address)",
]);
export const ponsV2Abi = parseAbi([
  "event TokenLaunched(address indexed token,address indexed curve,address indexed deployer,address pairToken,uint256 launchConfigId,uint256 graduationThreshold)",
  "event LaunchSwept(address indexed token,uint256 quoteOut,uint256 tokenOut)",
  "event PoolGraduated(address indexed token,uint256 positionId,uint256 tokenAmount,uint256 pairTokenAmount)",
  "function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
  "function memeHook() view returns (address)",
  "function locker() view returns (address)",
]);
export const ponsCurveAbi = parseAbi([
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function readyToGraduate() view returns (bool)",
]);
export const launchTokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function logo() view returns (string)",
]);
export type LaunchLog = {
  address: Hex;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  removed?: boolean;
};
export type DecodedLaunchEvent = {
  key: string;
  sourceId: string;
  launchId: string;
  name: string;
  block: string;
  blockHash: Hex;
  transaction: Hex;
  logIndex: number;
  timestamp: string;
  creation: LaunchEvidence | null;
  market: Hex | null;
};
export function launchAbi(source: LaunchSourceManifest) {
  return source.source === "STONKBROKERS"
    ? stonkPadAbi
    : source.version === "V1"
      ? ponsV1Abi
      : ponsV2Abi;
}
function exactAddress(value: unknown, native = false): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[\da-f]{40}$/i.test(value) ||
    (!native && value.toLowerCase() === zeroAddress)
  )
    throw new Error("launch address invalid");
  return value.toLowerCase() as Hex;
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[\da-f]{64}$/i.test(value))
    throw new Error("launch provenance hash invalid");
  return value.toLowerCase() as Hex;
}
export function decodeLaunchEvent(
  source: LaunchSourceManifest,
  log: LaunchLog,
  timestamp: string,
): DecodedLaunchEvent {
  if (
    log.removed ||
    exactAddress(log.address) !== source.contract ||
    log.blockNumber < BigInt(source.startBlock) ||
    !Number.isSafeInteger(log.logIndex) ||
    log.logIndex < 0 ||
    !Number.isFinite(Date.parse(timestamp))
  )
    throw new Error("launch event envelope invalid");
  const decoded = decodeEventLog({
    abi: launchAbi(source),
    data: log.data,
    topics: log.topics as [Hex, ...Hex[]],
    strict: true,
  });
  const args = decoded.args as Record<string, unknown>;
  const token = args.token === undefined ? null : exactAddress(args.token);
  const localId = source.source === "STONKBROKERS" ? String(args.id) : token;
  if (
    localId === null ||
    (source.source === "STONKBROKERS" && !/^[1-9]\d*$/.test(localId))
  )
    throw new Error("launch ID invalid");
  const launchId = `${source.contract}:${localId}`;
  const event: DecodedLaunchEvent = {
    key: `${hash(log.transactionHash)}:${log.logIndex}`,
    sourceId: source.id,
    launchId,
    name: decoded.eventName,
    block: log.blockNumber.toString(),
    blockHash: hash(log.blockHash),
    transaction: hash(log.transactionHash),
    logIndex: log.logIndex,
    timestamp,
    creation: null,
    market: args.pool === undefined ? null : exactAddress(args.pool),
  };
  if (
    decoded.eventName !== "LaunchCreated" &&
    decoded.eventName !== "TokenLaunched"
  )
    return event;
  if (!token) throw new Error("creation token absent");
  event.creation = {
    chainId: 4663,
    launchId,
    sourceId: source.id,
    source: source.source,
    sourceVersion: source.version,
    sourceContract: source.contract,
    token,
    quoteAsset:
      source.source === "STONKBROKERS"
        ? source.quoteAsset
        : exactAddress(args.pairToken, true),
    creator: exactAddress(args.creator ?? args.deployer),
    curve: args.curve === undefined ? null : exactAddress(args.curve),
    initialMarket: event.market,
    liquidityDestination: null,
    relationship:
      args.externalToken === true ? "TOKEN_ENROLLED" : "TOKEN_CREATED",
    launchTransaction: event.transaction,
    launchBlock: event.block,
    launchBlockHash: event.blockHash,
    logIndex: event.logIndex,
    launchTime: timestamp,
    state:
      source.source === "PONS" && source.version === "V2"
        ? "BONDING"
        : "LAUNCHED",
    sourcePhase: decoded.eventName,
    progressBps: null,
    creatorTaxBps: null,
    graduatedMarkets: [],
    graduationTransaction: null,
    graduationBlock: null,
    observedBlock: event.block,
    observedBlockHash: event.blockHash,
    observedAt: timestamp,
    identity: { name: null, symbol: null, decimals: null, artwork: null },
    evidenceClass: "ONCHAIN_VERIFIED",
  };
  return event;
}
/** Integer ratio only; not a curve/pricing implementation. */
export function boundedProgress(value: bigint, threshold: bigint) {
  return threshold > 0n && value >= 0n
    ? Number(
        (value * 10_000n) / threshold > 10_000n
          ? 10_000n
          : (value * 10_000n) / threshold,
      )
    : null;
}
export function applyLaunchEvent(
  current: LaunchEvidence,
  event: DecodedLaunchEvent,
): LaunchEvidence {
  if (
    current.launchId !== event.launchId ||
    current.sourceId !== event.sourceId
  )
    throw new Error("launch event relationship mismatch");
  const next = {
    ...current,
    observedBlock: event.block,
    observedBlockHash: event.blockHash,
    observedAt: event.timestamp,
  };
  const states = {
    LaunchArmed: "BONDING",
    LaunchSwept: "GRADUATING",
    CurveClosed: "GRADUATING",
    LaunchBonded: "GRADUATED",
    PoolGraduated: "GRADUATED",
    LaunchAborted: "ABORTED",
  } as const;
  const state = states[event.name as keyof typeof states];
  if (state) {
    next.state = state;
    next.sourcePhase = event.name;
  }
  if (state === "GRADUATED") {
    next.graduationTransaction = event.transaction;
    next.graduationBlock = event.block;
  }
  if (event.market && !next.graduatedMarkets.includes(event.market))
    next.graduatedMarkets = [...next.graduatedMarkets, event.market];
  return next;
}
