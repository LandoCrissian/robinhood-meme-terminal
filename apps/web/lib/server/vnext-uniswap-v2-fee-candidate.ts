import { getAddress, type Address } from "viem";
import {
  configuredRmtExecutionFeeV2Policy,
  normalizeRmtExecutionFeeV2Input,
  type RmtExecutionFeeV2Policy
} from "../vnext/execution-fee-policy-v2";
import { isRobinhoodNativeAsset } from "../vnext/robinhood-assets";

export { RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID } from "../vnext/uniswap-v2-fee-executor-v2";
export const RMT_UNISWAP_V2_V2_PROVIDER_ID = "uniswap-v2" as const;
export const RMT_UNISWAP_V2_V2_CANDIDATE_GATE = "RMT_VNEXT_UNISWAP_V2_FEE_CANDIDATE_ENABLED" as const;

function assetId(address: Address) {
  return isRobinhoodNativeAsset(address)
    ? "eip155:4663/native"
    : `eip155:4663/contract:${getAddress(address).toLowerCase()}`;
}
export function configuredVNextUniswapV2FeeCandidate(
  env: Partial<Record<string, string | undefined>> = process.env
): { policy: RmtExecutionFeeV2Policy } | null {
  const enabled = env[RMT_UNISWAP_V2_V2_CANDIDATE_GATE];
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw new Error("The Uniswap V2 fee-candidate gate must be exact lowercase true or false.");
  if (env.VERCEL_ENV === "production") {
    throw new Error("The Uniswap V2 fee candidate is not admitted in Production.");
  }
  const policy = configuredRmtExecutionFeeV2Policy(env as NodeJS.ProcessEnv);
  if (!policy) throw new Error("The Uniswap V2 fee candidate requires the exact RMT_EXECUTION_V2 policy.");
  return { policy };
}

export async function quoteVNextUniswapV2FeeCandidate(input: {
  inputAsset: Address;
  outputAsset: Address;
  userGrossInput: bigint;
  config?: { policy: RmtExecutionFeeV2Policy } | null;
  quoteProvider: (input: { amountIn: bigint }) => Promise<{
    expectedOutputAtomic: string;
    protectedOutputAtomic: string;
    route: "direct" | "weth_hop";
    pools: readonly Address[];
    quoteBlock: string;
    quoteBlockHash: `0x${string}`;
  }>;
}) {
  const config = input.config === undefined ? configuredVNextUniswapV2FeeCandidate() : input.config;
  if (!config) return null;
  if (input.userGrossInput <= 0n) throw new Error("The Uniswap V2 gross input must be positive.");
  const fee = input.userGrossInput * 25n / 10_000n;
  const providerInput = input.userGrossInput - fee;
  if (providerInput <= 0n) throw new Error("The RMT fee leaves no Uniswap V2 provider input.");
  const quote = await input.quoteProvider({ amountIn: providerInput });
  const economics = normalizeRmtExecutionFeeV2Input({
    policy: config.policy,
    inputAssetId: assetId(getAddress(input.inputAsset)),
    outputAssetId: assetId(getAddress(input.outputAsset)),
    userGrossInputAtomic: input.userGrossInput.toString(),
    providerGrossExpectedOutputAtomic: quote.expectedOutputAtomic,
    providerProtectedOutputAtomic: quote.protectedOutputAtomic,
    settlementMode: "v2-atomic-input-fee"
  });
  return { quote, economics, providerInput };
}
