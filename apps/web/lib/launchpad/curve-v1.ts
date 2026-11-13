import { parseAbi, parseAbiItem, type Address, type Hash } from "viem";
import type { NewLaunchRecord } from "./launch-record";

export const curveFactoryAbi = parseAbi([
  "function create(string name,string symbol,string projectURI,uint8 supplyPreset,address treasury,uint16 treasuryShareBps,bytes32 intentId,uint256 deadline) payable returns (address token,address curve)",
  "function curveForToken(address token) view returns (address)",
  "function originCurveForToken(address token) view returns (address)",
  "function migrationCandidate(address token,uint32 nextVersion) view returns (address)",
  "function graduationEngine() view returns (address)",
  "function engineVersion() view returns (uint32)",
  "function projectRegistry() view returns (address)",
  "function creationFeeWei() view returns (uint256)",
  "function operatingRecipient() view returns (address)",
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
  "function active() view returns (bool)",
  "function migrationCommitment() view returns (bytes32)",
  "function migratedTo() view returns (address)",
  "function migrationSource() view returns (address)",
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
  "function activeCurve() view returns (address)",
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
  "function lpFeeLedger(address token) view returns (address)",
  "function previewLpFees(address token) view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function positions(address token) view returns (uint256 tokenId,uint128 liquidity)",
  "function collectLpFees(address token,uint256 deadline) returns (uint256 nativeAmount,uint256 tokenAmount)",
]);
export const curveLpLedgerAbi = parseAbi([
  "function engine() view returns (address)",
  "function poolManager() view returns (address)",
  "function token() view returns (address)",
  "function creator() view returns (address)",
  "function treasury() view returns (address)",
  "function treasuryShareBps() view returns (uint16)",
  "function operatingRecipient() view returns (address)",
  "function futureReserveRecipient() view returns (address)",
  "function claimable(address recipient) view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function claim() returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function totalAccrued() view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function totalClaimed() view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function bucketAccrued(uint256 bucket) view returns (uint256 nativeAmount,uint256 tokenAmount)",
]);
export const curveRegistryAbi = parseAbi([
  "function project(address token) view returns (address factory,address curve,uint32 version,address engine,uint64 migrations)",
  "function originCurve(address token) view returns (address)",
  "function migration(address token,uint64 index) view returns (uint32 fromVersion,uint32 toVersion,address previousEngine,address nextEngine,bytes32 runtimeHash,uint64 effectiveBlock,uint48 effectiveAt)",
  "function proposal(address token) view returns (address nextEngine,bytes32 runtimeHash,uint48 deadline,uint48 executableAt,uint48 expiresAt)",
  "function migrationNonce(address token) view returns (uint64)",
  "function nextMigrationVersion(address token) view returns (uint32)",
  "function directory() view returns (address)",
]);
export const curveDirectoryAbi = parseAbi(["function suspended() view returns (bool)"]);
export const curveCreatedEvent = parseAbiItem("event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)");
export const curveCreationFeePaidEvent = parseAbiItem("event CreationFeePaid(address indexed token,address indexed creator,address indexed recipient,uint256 fee,uint256 refund)");
export const curveAssetsMigratedEvent = parseAbiItem("event CurveAssetsMigrated(address indexed token,address indexed fromCurve,address indexed toCurve,uint32 version,uint256 sold,uint256 backing,uint256 inventory,address ledger)");
export const projectMigratedEvent = parseAbiItem("event ProjectMigrated(address indexed token,uint64 indexed index,address indexed nextEngine,uint32 toVersion)");
export const curveTradeEvent = parseAbiItem("event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)");
export const curveGraduatedEvent = parseAbiItem("event CurveGraduated(bytes32 indexed poolId,uint256 indexed positionTokenId,uint256 nativeUsed,uint256 tokenUsed,uint256 nativeDust,uint256 tokenDust)");
export const curveFeeClaimedEvent = parseAbiItem("event CurveFeeClaimed(address indexed recipient,uint256 amount)");
export const curveLpCollectedEvent = parseAbiItem("event LpFeesCollected(address indexed token,uint256 indexed positionTokenId,address indexed ledger,uint256 nativeAmount,uint256 tokenAmount)");
export const curveLpClaimedEvent = parseAbiItem("event LpFeesClaimed(address indexed recipient,uint256 nativeAmount,uint256 tokenAmount)");
export const graduationEngineEvent = parseAbiItem("event CurveGraduated(address indexed token,address indexed curve,bytes32 indexed poolId,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint160 sqrtPriceX96,uint256 positionTokenId,uint128 liquidity,uint128 nativeUsed,uint128 tokenUsed,uint128 nativeDust,uint128 tokenDust)");

export const curveSupplyPresets = [1_000_000, 10_000_000, 100_000_000] as const;
export const curveTradeFeeBps = 100;
export const curveOperatingShareBps = 500;
export const curveReserveShareBps = 500;
export const curveGraduationBps = 6_000;
export const curveDraftCreationFeeWei = 400_000_000_000_000n;
export const curveMaxVersion = 32;

export type CurveCreationFeePolicy = { amountWei: string; recipient: Address };
export type CurveDeployment = { graduationEngine: Address; projectRegistry: Address; creationFee: CurveCreationFeePolicy };
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
  creationFee: CurveCreationFeePolicy & { refundWei: string; logIndex: number };
  transactionHash: Hash;
  blockHash: Hash;
  blockNumber: string;
  logIndex: number;
};
export type CurveState = {
  activeCurve: Address;
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
  lpFees?: {
    ledger: Address;
    claimable: CurveFeeAmounts | null;
    uncollected: CurveFeeAmounts | null;
    collected: CurveFeeAmounts;
    claimed: CurveFeeAmounts;
    bucketAccrued: CurveFeeAmounts[];
    latestCollection?: { transactionHash: Hash; blockHash: Hash; blockNumber: string; logIndex: number; amounts: CurveFeeAmounts };
  };
  project?: {
    registry: Address;
    currentVersion: number;
    currentEngine: Address;
    economicRules: Hash;
    count: string;
    eligibility: "eligible" | "graduated" | "suspended" | "proposal_pending" | "version_unsupported" | "inactive";
    migrationNonce: string;
    nextVersion?: number;
    candidate?: Address;
    migrations: {
      index: string; fromVersion: number; toVersion: number; previousEngine: Address; nextEngine: Address;
      runtimeHash: Hash; blockNumber: string; timestamp: number;
      transactionHash: Hash; blockHash: Hash; logIndex: number;
      transactionIndex: number;
      backing: string; inventory: string; sold: string;
    }[];
    pending?: { nextEngine: Address; runtimeHash: Hash; deadline: number; executableAt: number; expiresAt: number;
      status: "awaiting_approvals" | "timelocked" | "executable" | "expired" | "blocked" };
  };
};

export type CurveFeeAmounts = { native: string; token: string };

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
