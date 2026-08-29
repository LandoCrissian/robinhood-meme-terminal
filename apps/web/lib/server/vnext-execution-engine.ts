import type { VNextQuoteProvider } from "../vnext/quote-observation";
import { requireVNextStockTokenExecutionEligible, type VNextStockTokenExecutionAssets } from "./robinhood-stock-token-registry";
import type { VNextProviderAuthorizationRequest, VNextProviderVerificationRequest, VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { prepareVNextProviderAuthorization, quoteVNextExecutionProviders, verifyVNextExecutionProvider } from "./vnext-provider-adapter";
import { vNextSushiAdapter } from "./vnext-sushi-adapter";
import { vNextUniswapV2Adapter } from "./vnext-uniswap-v2-adapter";
import { vNextUniswapV3Adapter } from "./vnext-uniswap-v3-adapter";
import { vNextUniswapV4Adapter } from "./vnext-uniswap-v4-adapter";
import { configuredVNextUniswapXAdapters, prepareVNextUniswapXIntent } from "./vnext-uniswapx-adapter";
import { configuredVNextZeroXAdapters } from "./vnext-zero-x-adapter";
import { configuredVNextUpAdapters } from "./vnext-up-adapter";
import {
  requireVNextExecutionProvider,
  resolveVNextExecutionEligibility
} from "./vnext-execution-eligibility";

export const robinhoodVNextQuoteAdapters: readonly VNextQuoteProviderAdapter[] = [
  vNextSushiAdapter,
  vNextUniswapV2Adapter,
  vNextUniswapV3Adapter,
  vNextUniswapV4Adapter,
  ...configuredVNextUniswapXAdapters(),
  ...configuredVNextZeroXAdapters(),
  ...configuredVNextUpAdapters()
];

export function quoteRobinhoodVNextExecution(input: Parameters<typeof quoteVNextExecutionProviders>[0]) {
  const eligibility = resolveVNextExecutionEligibility(
    input.inputAsset,
    input.outputAsset,
    robinhoodVNextQuoteAdapters.map((adapter) => adapter.provider)
  );
  return quoteVNextExecutionProviders(
    input,
    robinhoodVNextQuoteAdapters.filter((adapter) => eligibility.providers.includes(adapter.provider))
  );
}

export async function withVNextStockTokenExecutionAdmission<T>(
  assets: VNextStockTokenExecutionAssets,
  operation: () => Promise<T>,
  requireAdmission: typeof requireVNextStockTokenExecutionEligible = requireVNextStockTokenExecutionEligible
) {
  await requireAdmission(assets);
  return operation();
}

export function verifyRobinhoodVNextExecution(provider: VNextQuoteProvider, input: VNextProviderVerificationRequest) {
  requireVNextExecutionProvider(
    input.inputAsset,
    input.outputAsset,
    provider,
    robinhoodVNextQuoteAdapters.map((adapter) => adapter.provider)
  );
  return withVNextStockTokenExecutionAdmission(input, () => (
    verifyVNextExecutionProvider(provider, input, robinhoodVNextQuoteAdapters)
  ));
}

export function prepareRobinhoodVNextAuthorization(provider: VNextQuoteProvider, input: VNextProviderAuthorizationRequest) {
  requireVNextExecutionProvider(
    input.inputAsset,
    input.outputAsset,
    provider,
    robinhoodVNextQuoteAdapters.map((adapter) => adapter.provider)
  );
  return withVNextStockTokenExecutionAdmission(input, () => (
    prepareVNextProviderAuthorization(provider, input, robinhoodVNextQuoteAdapters)
  ));
}

export function prepareRobinhoodVNextUniswapXIntent(
  input: Parameters<typeof prepareVNextUniswapXIntent>[0],
  protectedOutputFloorAtomic: bigint,
  requireAdmission: typeof requireVNextStockTokenExecutionEligible = requireVNextStockTokenExecutionEligible
) {
  return prepareVNextUniswapXIntent(input, protectedOutputFloorAtomic, requireAdmission);
}
