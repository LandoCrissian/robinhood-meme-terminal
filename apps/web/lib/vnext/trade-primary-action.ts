export type RmtTradeFundingReason = "input-balance" | "native-gas" | null;

export function rmtTradeFundingReason(input: {
  amountExceedsBalance: boolean;
  authenticated: boolean;
  authorizationEnabled: boolean;
  exactWalletSelected: boolean;
  inputBalanceKnown: boolean;
  inputIsNative: boolean;
  nativeGasBalanceKnown: boolean;
  nativeGasMissing: boolean;
  stockTokenViewOnly: boolean;
  transactionPending: boolean;
  walletBusy: boolean;
  walletReadReady: boolean;
}): RmtTradeFundingReason {
  if (!input.authorizationEnabled || input.stockTokenViewOnly || !input.authenticated
    || !input.exactWalletSelected || !input.walletReadReady || input.transactionPending || input.walletBusy) return null;
  if (input.inputBalanceKnown && input.amountExceedsBalance) return "input-balance";
  if (!input.inputIsNative && input.nativeGasBalanceKnown && input.nativeGasMissing) return "native-gas";
  return null;
}

export function rmtTradePrimaryActionDisabled(input: {
  amountExceedsBalance: boolean;
  authorizationEnabled: boolean;
  connectedIntentMissing: boolean;
  embeddedWalletRetryRequired: boolean;
  identityEnabled: boolean;
  identityReady: boolean;
  quoteRequiresVerification: boolean;
  stockTokenViewOnly: boolean;
  transactionPending: boolean;
  walletBusy: boolean;
}) {
  if (input.embeddedWalletRetryRequired) return !input.identityEnabled || !input.identityReady;
  return !input.authorizationEnabled
    || input.stockTokenViewOnly
    || input.walletBusy
    || input.transactionPending
    || input.amountExceedsBalance
    || !input.identityEnabled
    || !input.identityReady
    || input.quoteRequiresVerification
    || input.connectedIntentMissing;
}
