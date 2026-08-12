import type { VNextQuoteProvider } from "../vnext/quote-observation";
import type { VNextProviderAuthorizationRequest, VNextProviderVerificationRequest, VNextQuoteProviderAdapter } from "./vnext-provider-adapter";
import { prepareVNextProviderAuthorization, quoteVNextExecutionProviders, verifyVNextExecutionProvider } from "./vnext-provider-adapter";
import { vNextSushiAdapter } from "./vnext-sushi-adapter";
import { vNextUniswapV3Adapter } from "./vnext-uniswap-v3-adapter";
import { configuredVNextUniswapXAdapters, prepareVNextUniswapXIntent } from "./vnext-uniswapx-adapter";
import { configuredVNextZeroXAdapters } from "./vnext-zero-x-adapter";
import { configuredVNextUpAdapters } from "./vnext-up-adapter";

export const robinhoodVNextQuoteAdapters: readonly VNextQuoteProviderAdapter[] = [
  vNextSushiAdapter,
  vNextUniswapV3Adapter,
  ...configuredVNextUniswapXAdapters(),
  ...configuredVNextZeroXAdapters(),
  ...configuredVNextUpAdapters()
];

export function quoteRobinhoodVNextExecution(input: Parameters<typeof quoteVNextExecutionProviders>[0]) {
  return quoteVNextExecutionProviders(input, robinhoodVNextQuoteAdapters);
}

export function verifyRobinhoodVNextExecution(provider: VNextQuoteProvider, input: VNextProviderVerificationRequest) {
  return verifyVNextExecutionProvider(provider, input, robinhoodVNextQuoteAdapters);
}

export function prepareRobinhoodVNextAuthorization(provider: VNextQuoteProvider, input: VNextProviderAuthorizationRequest) {
  return prepareVNextProviderAuthorization(provider, input, robinhoodVNextQuoteAdapters);
}

export function prepareRobinhoodVNextUniswapXIntent(
  input: Parameters<typeof prepareVNextUniswapXIntent>[0],
  protectedOutputFloorAtomic: bigint
) {
  return prepareVNextUniswapXIntent(input, protectedOutputFloorAtomic);
}
