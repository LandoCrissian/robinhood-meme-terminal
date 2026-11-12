import { encodeAbiParameters, keccak256, parseAbiItem, type Address, type Hash } from "viem";

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
};

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
};
