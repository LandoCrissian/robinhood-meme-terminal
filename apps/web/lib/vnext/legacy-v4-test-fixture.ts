import { zeroAddress } from "viem";
import { rmtUniswapV4PoolIdV2 } from "./uniswap-v4-fee-executor-v2";

// Synthetic native pool used only by deterministic legacy quote and wallet tests.
export const legacyV4TestPoolKey = {
  currency0: zeroAddress,
  currency1: "0x0000000000000000000000000000000000005101",
  fee: 0,
  tickSpacing: 200,
  hooks: "0x0000000000000000000000000000000000006044"
} as const;

export const legacyV4TestPoolId = rmtUniswapV4PoolIdV2(legacyV4TestPoolKey);
