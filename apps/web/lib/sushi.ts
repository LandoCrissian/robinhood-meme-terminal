import { getAddress, isAddress, type Address, type Hex } from "viem";

export const SUSHI_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
export const SUSHI_RED_SNWAPPER = "0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A" as Address;
export const SUSHI_QUOTE_SLIPPAGE_BPS = 100;

export const sushiDeadlineGuardAbi = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [{
    name: "swap",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "orderId", type: "bytes32" },
      { name: "executorData", type: "bytes" }
    ]
  }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}] as const;

export function publicSushiDeadlineGuardAddress(
  environment?: Readonly<Record<string, string | undefined>>
): Address | undefined {
  const candidate = (
    environment?.NEXT_PUBLIC_RMT_SUSHI_DEADLINE_GUARD
    ?? process.env.NEXT_PUBLIC_RMT_SUSHI_DEADLINE_GUARD
  )?.trim();
  return candidate && isAddress(candidate) ? getAddress(candidate) : undefined;
}

export type SushiTokenMetadata = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
};

export type SushiIndicativeQuote = {
  chainId: number;
  venue: "sushi-aggregator";
  protocol: "SUSHI";
  token: Address;
  recipient: Address;
  side: "buy" | "sell";
  amountIn: string;
  quoteOut: string;
  minimumOut: string;
  priceImpact: number;
  inputToken?: SushiTokenMetadata;
  outputToken?: SushiTokenMetadata;
  executable: false;
  verifiedInput: true;
};

export type SushiExecutableQuote = Omit<SushiIndicativeQuote, "executable"> & {
  router: Address;
  approvalSpender: Address;
  executor: Address;
  calldata: Hex;
  value: string;
  quoteExpiresAt: string;
  executable: true;
  onchainDeadline: true;
};
