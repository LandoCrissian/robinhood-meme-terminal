import assert from "node:assert/strict";
import { rmtTradeFundingReason, rmtTradePrimaryActionDisabled } from "./trade-primary-action";

const blockedTradeState = {
  amountExceedsBalance: true,
  authorizationEnabled: true,
  connectedIntentMissing: true,
  identityEnabled: true,
  identityReady: true,
  quoteRequiresVerification: true,
  stockTokenViewOnly: false,
  transactionPending: true,
  walletBusy: true
};

assert.equal(rmtTradePrimaryActionDisabled({
  ...blockedTradeState,
  embeddedWalletRetryRequired: true
}), false, "Wallet recovery remains reachable even when the unverified trade draft exceeds balance or quote state is busy.");
assert.equal(rmtTradePrimaryActionDisabled({
  ...blockedTradeState,
  embeddedWalletRetryRequired: true,
  identityReady: false
}), true, "Wallet recovery waits for the identity owner itself to become ready.");
assert.equal(rmtTradePrimaryActionDisabled({
  ...blockedTradeState,
  embeddedWalletRetryRequired: false
}), true, "Normal trade blockers remain fail-closed outside the wallet-recovery action.");

const fundedAccount = {
  amountExceedsBalance: false,
  authenticated: true,
  authorizationEnabled: true,
  exactWalletSelected: true,
  inputBalanceKnown: true,
  inputIsNative: false,
  nativeGasBalanceKnown: true,
  nativeGasMissing: false,
  stockTokenViewOnly: false,
  transactionPending: false,
  walletBusy: false,
  walletReadReady: true
};
assert.equal(rmtTradeFundingReason({ ...fundedAccount, amountExceedsBalance: true }), "input-balance",
  "An exact active account with insufficient input gets a Deposit action instead of a disabled trade action.");
assert.equal(rmtTradeFundingReason({ ...fundedAccount, nativeGasMissing: true }), "native-gas",
  "An ERC20-funded account with no native ETH gets a gas Deposit action.");
assert.equal(rmtTradeFundingReason({ ...fundedAccount, inputIsNative: true, nativeGasMissing: true }), null,
  "A native-input trade does not misclassify its reserved input as a separate gas-deposit action.");
assert.equal(rmtTradeFundingReason({ ...fundedAccount, amountExceedsBalance: true, stockTokenViewOnly: true }), null,
  "View-only Stock Tokens cannot turn funding into implied execution authority.");
assert.equal(rmtTradeFundingReason({ ...fundedAccount, amountExceedsBalance: true, walletReadReady: false }), null,
  "Unknown balances do not manufacture a funding requirement.");
assert.equal(rmtTradeFundingReason({ ...fundedAccount, amountExceedsBalance: true, transactionPending: true }), null,
  "Pending transaction recovery remains the primary state instead of being replaced by Deposit.");

console.log("The in-ticket wallet recovery action remains reachable, and authenticated funding gaps become explicit Deposit actions.");
