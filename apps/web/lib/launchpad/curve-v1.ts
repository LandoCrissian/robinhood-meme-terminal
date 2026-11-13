import { parseAbi, parseAbiItem, type Address, type Hash } from "viem";
import type { NewLaunchRecord } from "./launch-record";

export const curveFactoryAbi = parseAbi([
  "function create(string name,string symbol,string projectURI,uint8 supplyPreset,address treasury,uint16 treasuryShareBps,bytes32 intentId,uint256 deadline) returns (address token,address curve)",
  "function curveForToken(address token) view returns (address)",
  "function graduationEngine() view returns (address)",
  "function engineVersion() view returns (uint32)",
  "function projectRegistry() view returns (address)",
]);
export const curveAbi = parseAbi([
  "function factory() view returns (address)",
  "function token() view returns (address)",
  "function creator() view returns (address)",
  "function treasury() view returns (address)",
  "function treasuryShareBps() view returns (uint16)",
  "function operatingRecipient() view returns (address)",
  "function futureReserveRecipient() view returns (address)",
  "function sold() view returns (uint256)",
  "function backingReserve() view returns (uint256)",
  "function graduationSold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function executionEngine() view returns (address)",
  "function executionVersion() view returns (uint32)",
  "function executionEngineRuntimeHash() view returns (bytes32)",
  "function economicRules() view returns (bytes32)",
  "function projectRegistry() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function positionTokenId() view returns (uint256)",
  "function revenueLedger() view returns (address)",
  "function quoteBuy(uint256 grossBudget) view returns (uint256 tokensOut,uint256 grossUsed,uint256 fee,uint256 refund)",
  "function quoteSell(uint256 tokenIn) view returns (uint256 ethOut,uint256 grossReleased,uint256 fee)",
  "function buy(uint256 minimumTokenOut,uint256 deadline) payable",
  "function buyAndGraduate(uint256 minimumTokenOut,uint256 deadline) payable returns (uint256 tokenOut)",
  "function sell(uint256 amountIn,uint256 minimumEthOut,uint256 deadline)",
  "function graduate(uint256 deadline)",
]);
export const curveLedgerAbi = parseAbi([
  "function curve() view returns (address)",
  "function totalAccrued() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function bucketAccrued(uint256 bucket) view returns (uint256)",
  "function claimable(address recipient) view returns (uint256)",
  "function claim()",
]);
export const curveGraduationAbi = parseAbi([
  "function factory() view returns (address)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function permit2() view returns (address)",
  "function initializationGuard() view returns (address)",
]);
export const curveRegistryAbi = parseAbi([
  "function project(address token) view returns (address factory,address curve,uint32 version,address engine,uint64 migrations)",
  "function migration(address token,uint64 index) view returns (uint32 fromVersion,uint32 toVersion,address previousEngine,address nextEngine,bytes32 runtimeHash,uint64 effectiveBlock,uint48 effectiveAt)",
  "function proposal(address token) view returns (address nextEngine,bytes32 runtimeHash,uint48 deadline,uint48 executableAt,uint48 expiresAt)",
]);
export const curveCreatedEvent = parseAbiItem("event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)");
export const curveTradeEvent = parseAbiItem("event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)");
export const curveGraduatedEvent = parseAbiItem("event CurveGraduated(bytes32 indexed poolId,uint256 indexed positionTokenId,uint256 nativeUsed,uint256 tokenUsed,uint256 nativeDust,uint256 tokenDust)");
export const curveFeeClaimedEvent = parseAbiItem("event CurveFeeClaimed(address indexed recipient,uint256 amount)");
export const graduationEngineEvent = parseAbiItem("event CurveGraduated(address indexed token,address indexed curve,bytes32 indexed poolId,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint160 sqrtPriceX96,uint256 positionTokenId,uint128 liquidity,uint128 nativeUsed,uint128 tokenUsed,uint128 nativeDust,uint128 tokenDust)");

export const curveSupplyPresets = [1_000_000, 10_000_000, 100_000_000] as const;
export const curveTradeFeeBps = 100;
export const curveOperatingShareBps = 500;
export const curveReserveShareBps = 500;
export const curveGraduationBps = 6_000;

export type CurveDeployment = { graduationEngine: Address; projectRegistry?: Address };
export type CurveLaunch = {
  chainId: 31337;
  factory: Address;
  token: Address;
  curve: Address;
  creator: Address;
  intentId: Hash;
  name: string;
  symbol: string;
  projectURI: string;
  totalSupply: string;
  treasury: Address;
  treasuryShareBps: number;
  ledger: Address;
  transactionHash: Hash;
  blockHash: Hash;
  blockNumber: string;
  logIndex: number;
};
export type CurveState = {
  sold: string;
  backingReserve: string;
  graduationSold: string;
  graduated: boolean;
  operatingRecipient: Address;
  futureReserveRecipient: Address;
  claimable: string | null;
  totalAccrued: string;
  totalClaimed: string;
  bucketAccrued: [string, string, string, string];
  blockHash: Hash;
  blockNumber: string;
  positionOwner?: Address;
  position?: NewLaunchRecord;
  project?: {
    registry: Address;
    currentVersion: number;
    currentEngine: Address;
    economicRules: Hash;
    count: string;
    migrations: {
      index: string; fromVersion: number; toVersion: number; previousEngine: Address; nextEngine: Address;
      runtimeHash: Hash; blockNumber: string; timestamp: number;
    }[];
    pending?: { nextEngine: Address; runtimeHash: Hash; deadline: number; executableAt: number; expiresAt: number };
  };
};

export function curveProjectURI(value: string) {
  if (!value || value.length > 512) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch { /* Metadata can be displayed without an external link. */ }
}

export function sameCurveAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}
