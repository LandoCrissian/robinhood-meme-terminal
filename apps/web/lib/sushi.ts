import type { Address, Hex } from "viem";

export const SUSHI_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
export const SUSHI_RED_SNWAPPER = "0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A" as Address;
export const SUSHI_QUOTE_SLIPPAGE_BPS = 100;

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
  executor: Address;
  calldata: Hex;
  value: string;
  quoteExpiresAt: string;
  executable: true;
  onchainDeadline: false;
};
