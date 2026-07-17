import type { Address } from "viem";

export const SUSHI_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
export const SUSHI_QUOTE_SLIPPAGE_BPS = 100;

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
  executable: false;
  verifiedInput: true;
};

