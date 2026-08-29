import type { Address } from "viem";
import type { VNextQuoteProvider } from "../vnext/quote-observation";
import {
  ROBINHOOD_NATIVE_ASSET_ADDRESS,
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";

const SETTLEMENT_ASSETS = new Set([
  ROBINHOOD_NATIVE_ASSET_ADDRESS.toLowerCase(),
  ROBINHOOD_USDG_ADDRESS.toLowerCase(),
  ROBINHOOD_WETH_ADDRESS.toLowerCase()
]);
const CURATED_MARKET_ASSETS = new Set(
  RMT_CURATED_MARKET_REGISTRY.map((entry) => entry.token.toLowerCase())
);
const DYNAMIC_EXECUTION_PROVIDERS = new Set<VNextQuoteProvider>([
  "uniswap-v2",
  "uniswap-v3"
]);

export type VNextExecutionEligibility = {
  marketAssets: Address[];
  curated: boolean;
  providers: readonly VNextQuoteProvider[];
};

export class VNextExecutionEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VNextExecutionEligibilityError";
  }
}

export function resolveVNextExecutionEligibility(
  inputAsset: Address,
  outputAsset: Address,
  availableProviders: readonly VNextQuoteProvider[]
): VNextExecutionEligibility {
  const marketAssets = [inputAsset, outputAsset].filter(
    (address) => !SETTLEMENT_ASSETS.has(address.toLowerCase())
  );
  if (marketAssets.length === 0) {
    throw new VNextExecutionEligibilityError("A Token Market asset is required for execution.");
  }
  const curated = marketAssets.every((address) => CURATED_MARKET_ASSETS.has(address.toLowerCase()));
  if (!curated && marketAssets.length !== 1) {
    throw new VNextExecutionEligibilityError("Non-curated execution requires one exact Token Market asset and one supported settlement asset.");
  }
  return {
    marketAssets,
    curated,
    providers: curated
      ? [...availableProviders]
      : availableProviders.filter((provider) => DYNAMIC_EXECUTION_PROVIDERS.has(provider))
  };
}

export function requireVNextExecutionProvider(
  inputAsset: Address,
  outputAsset: Address,
  provider: VNextQuoteProvider,
  availableProviders: readonly VNextQuoteProvider[]
) {
  const eligibility = resolveVNextExecutionEligibility(inputAsset, outputAsset, availableProviders);
  if (!eligibility.providers.includes(provider)) {
    throw new VNextExecutionEligibilityError(
      "Trading is unavailable because RMT has no independently verified execution route for this market."
    );
  }
  return eligibility;
}

export function vNextExecutionEligibilityErrorResponse(cause: unknown) {
  return cause instanceof VNextExecutionEligibilityError
    ? Response.json({ error: cause.message, executionEligibility: "unavailable" }, {
        status: 422,
        headers: { "Cache-Control": "no-store" }
      })
    : null;
}
