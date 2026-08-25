import type { VNextQuoteProvider } from "../vnext/quote-observation";
import { requireVNextStockTokenExecutionEligible, type VNextStockTokenExecutionAssets } from "./robinhood-stock-token-registry";
import type { VNextProviderAuthorizationRequest, VNextProviderVerificationRequest, VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { prepareVNextProviderAuthorization, quoteVNextExecutionProviders, verifyVNextExecutionProvider } from "./vnext-provider-adapter";
import { vNextSushiAdapter } from "./vnext-sushi-adapter";
import { vNextUniswapV3Adapter } from "./vnext-uniswap-v3-adapter";
import { vNextUniswapV4Adapter } from "./vnext-uniswap-v4-adapter";
import { configuredVNextUniswapXAdapters, prepareVNextUniswapXIntent } from "./vnext-uniswapx-adapter";
import { configuredVNextZeroXAdapters } from "./vnext-zero-x-adapter";
import { configuredVNextUpAdapters } from "./vnext-up-adapter";

export const robinhoodVNextQuoteAdapters: readonly VNextQuoteProviderAdapter[] = [
  vNextSushiAdapter,
  vNextUniswapV3Adapter,
  vNextUniswapV4Adapter,
  ...configuredVNextUniswapXAdapters(),
  ...configuredVNextZeroXAdapters(),
  ...configuredVNextUpAdapters()
];

export function quoteRobinhoodVNextExecution(input: Parameters<typeof quoteVNextExecutionProviders>[0]) {
  return quoteVNextExecutionProviders(input, robinhoodVNextQuoteAdapters);
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
  return withVNextStockTokenExecutionAdmission(input, () => (
    verifyVNextExecutionProvider(provider, input, robinhoodVNextQuoteAdapters)
  ));
}

export function prepareRobinhoodVNextAuthorization(provider: VNextQuoteProvider, input: VNextProviderAuthorizationRequest) {
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
