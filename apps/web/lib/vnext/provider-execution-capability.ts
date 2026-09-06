import type { VNextQuoteProvider } from "./quote-observation";

export type VNextProviderExecutionCapability = Readonly<{
  state: "WALLET_EXECUTION" | "QUOTE_ONLY";
  strictVerificationImplemented: boolean;
  walletAuthorizationCodecImplemented: boolean;
}>;

/**
 * Execution capability is intentionally independent from RMT fee settlement.
 * A provider can support an exact, simulated DIRECT_NO_RMT_FEE wallet call while
 * its fee-settlement registry remains QUOTE_ONLY.
 */
export const VNEXT_PROVIDER_EXECUTION_CAPABILITY_REGISTRY: Readonly<Record<VNextQuoteProvider, VNextProviderExecutionCapability>> = Object.freeze({
  "uniswap-v2": Object.freeze({ state: "WALLET_EXECUTION", strictVerificationImplemented: true, walletAuthorizationCodecImplemented: true }),
  "uniswap-v3": Object.freeze({ state: "WALLET_EXECUTION", strictVerificationImplemented: true, walletAuthorizationCodecImplemented: true }),
  "uniswap-v4": Object.freeze({ state: "WALLET_EXECUTION", strictVerificationImplemented: true, walletAuthorizationCodecImplemented: true }),
  "up-v2": Object.freeze({ state: "WALLET_EXECUTION", strictVerificationImplemented: true, walletAuthorizationCodecImplemented: true }),
  "up-cl": Object.freeze({ state: "WALLET_EXECUTION", strictVerificationImplemented: true, walletAuthorizationCodecImplemented: true }),
  sushi: Object.freeze({ state: "QUOTE_ONLY", strictVerificationImplemented: false, walletAuthorizationCodecImplemented: false }),
  uniswapx: Object.freeze({ state: "QUOTE_ONLY", strictVerificationImplemented: false, walletAuthorizationCodecImplemented: false }),
  "zero-x-swap": Object.freeze({ state: "WALLET_EXECUTION", strictVerificationImplemented: true, walletAuthorizationCodecImplemented: true }),
  "zero-x-gasless": Object.freeze({ state: "QUOTE_ONLY", strictVerificationImplemented: false, walletAuthorizationCodecImplemented: false })
});

export function hasVNextWalletAuthorizationCodec(provider: VNextQuoteProvider) {
  return VNEXT_PROVIDER_EXECUTION_CAPABILITY_REGISTRY[provider].walletAuthorizationCodecImplemented;
}

export function isVNextWalletExecutionAdmitted(provider: VNextQuoteProvider) {
  const capability = VNEXT_PROVIDER_EXECUTION_CAPABILITY_REGISTRY[provider];
  return capability.state === "WALLET_EXECUTION"
    && capability.strictVerificationImplemented
    && capability.walletAuthorizationCodecImplemented;
}
