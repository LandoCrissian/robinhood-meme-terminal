import { encodeAbiParameters, keccak256, parseAbi, parseAbiItem, type Address, type Hash } from "viem";
import type { GrowthEvidence } from "./growth-vault";

export const launchPoolKeyParameter = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

export type LaunchPoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export function launchPoolId(poolKey: LaunchPoolKey): Hash {
  return keccak256(encodeAbiParameters([launchPoolKeyParameter], [poolKey]));
}

export const launchCreatedEvent = parseAbiItem(
  "event LaunchCreated(address indexed creator, address indexed token, bytes32 indexed poolId, bytes32 intentId, uint256 positionTokenId, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128 amount0, uint128 amount1, uint256 totalSupply, string name, string symbol, string projectURI)"
);

export const longevityPolicyCommittedEvent = parseAbiItem(
  "event LongevityPolicyCommitted(address indexed token, address indexed creator, address treasury, address reserve, uint16 creatorBps, uint16 treasuryBps, uint16 reserveBps)"
);

export const launchFeeLedgerAbi = parseAbi([
  "function feePolicy(address token) view returns (address creator, address treasury, address reserve, uint16 creatorBps, uint16 treasuryBps, uint16 reserveBps)",
  "function feeBucket(address token, uint8 bucket) view returns (address recipient, uint256 nativeClaimable, uint256 tokenClaimable, uint256 nativeDistributed, uint256 tokenDistributed)",
  "function feeTotals(address token) view returns (uint256 nativeAccrued, uint256 tokenAccrued, uint256 nativeRoundingDust, uint256 tokenRoundingDust)",
]);

export type LaunchFeePolicy = {
  creator: Address;
  treasury: Address;
  reserve: Address;
  creatorBps: number;
  treasuryBps: number;
  reserveBps: number;
};

export type LaunchFeeBucket = {
  bucket: 0 | 1 | 2;
  recipient: Address;
  nativeClaimable: string;
  tokenClaimable: string;
  nativeDistributed: string;
  tokenDistributed: string;
};

type ActiveLiquiditySample = { blockNumber: string; blockHash: Hash; timestampUnixSeconds: string; activeLiquidity: string };
type UnknownTrend = { status: "unknown"; reason: string };
type HolderSample = { blockNumber: string; blockHash: Hash; timestampUnixSeconds: string; holders: number };
export type LaunchHolderTrend = { status: "observed"; from: HolderSample; to: HolderSample } | UnknownTrend;

export type LaunchHealth = {
  growth?: GrowthEvidence;
  liquidity: {
    initialNativeWei: string;
    initialTokenBaseUnits: string;
    positionTokenId: string;
    initialPositionLiquidity: string;
    currentPositionLiquidity: string | null;
    activePoolLiquidity: string | null;
    custody: { owner: Address | null; status: "verified" | "failed" | "unknown" };
  };
  creator: { initialTokenAllocation: string; vesting: "none" | "unknown" };
  permissions: {
    status: "verified" | "unknown";
    initializationGuard: Address | null;
    factoryAdmin: false | null;
    tokenMintAuthority: false | null;
    principalWithdrawal: false | null;
    feePolicyMutable: false | null;
  };
  fees: {
    status: "verified" | "legacy" | "unknown";
    policy: LaunchFeePolicy | null;
    buckets: LaunchFeeBucket[] | null;
    totals: { nativeAccrued: string; tokenAccrued: string; nativeRoundingDust: string; tokenRoundingDust: string } | null;
  };
  trends: {
    liquidity: { status: "observed"; from: ActiveLiquiditySample; to: ActiveLiquiditySample } | UnknownTrend;
    holders: LaunchHolderTrend;
  };
};

export type NewLaunchDeployment = {
  chainId: 31337;
  name: string;
  rpcUrl: string;
  factory: Address;
  poolManager: Address;
  positionManager: Address;
  universalRouter: Address;
  quoter: Address;
  stateView: Address;
  permit2: Address;
  tradingEnabled: boolean;
} & (
  | { engineVersion?: undefined; initializationGuard?: undefined; growthVaultDeployer?: undefined }
  | { engineVersion: 2; initializationGuard: Address; growthVaultDeployer?: Address }
);

export type NewLaunchRecord = {
  chainId: NewLaunchDeployment["chainId"];
  factory: Address;
  creator: Address;
  token: Address;
  poolManager: Address;
  poolId: Hash;
  poolKey: LaunchPoolKey;
  intentId: Hash;
  positionTokenId: string;
  sqrtPriceX96: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  totalSupply: string;
  name: string;
  symbol: string;
  projectURI: string;
  transactionHash: Hash;
  blockNumber: string;
  blockHash: Hash;
  blockTimestamp?: string;
  logIndex: number;
  indexing: "pending" | "indexed";
  engineVersion?: 2;
  feePolicy?: LaunchFeePolicy;
};
