import type { Address } from "viem";

// Official Uniswap deployments for Robinhood Chain (chain ID 4663).
// Sources: Uniswap/contracts deployments/json/4663.json and canonical Permit2.
export const ROBINHOOD_UNIVERSAL_ROUTER = "0x06afBA43fd06227fA663b0dAeCF536F6eaA6BF99" as Address;
export const ROBINHOOD_V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as Address;
export const ROBINHOOD_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address;
export const ROBINHOOD_V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as Address;
export const ROBINHOOD_V3_QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" as Address;
export const ROBINHOOD_SWAP_ROUTER_02 = "0xcaf681a66d020601342297493863e78c959e5cb2" as Address;
export const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3" as Address;
export const ROUTER_AS_RECIPIENT = "0x0000000000000000000000000000000000000002" as Address;
export const RMT_V6_GRADUATION_ADAPTER = "0x680a227794b1204a57aab6bac56a84d3280e40a6" as Address;
export const RMT_V6_GRADUATION_HOOK = "0x6cf7048C901b513D0E8B1B13C66F3d37705a28a0" as Address;
export const RMT_V6_POOL_FEE = 5_000;
export const RMT_V6_TICK_SPACING = 200;
export const MAX_UINT160 = (1n << 160n) - 1n;

export const permit2Abi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "token", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "spender", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }], outputs: [] }
] as const;

export type RmtV4Quote = {
  chainId: number;
  token: Address;
  recipient: Address;
  side: "buy" | "sell";
  router: Address;
  calldata: `0x${string}`;
  value: string;
  amountIn: string;
  quoteOut: string;
  minimumOut: string;
  deadline: string;
  verified: true;
};
