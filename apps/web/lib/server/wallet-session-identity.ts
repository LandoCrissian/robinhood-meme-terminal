// Explicit build-time replacement for the pilot's legacy identity boundary.
// Does not impersonate a third-party user or synthesize a Privy token.
import { requireWalletSession, walletSessionBinding, WalletSessionError, walletSessionErrorResponse } from './wallet-session';
export const requireAuthenticatedTradeWallet = requireWalletSession;
export const tradeSessionBinding = walletSessionBinding;
export function tradeIdentityErrorResponse(error: unknown) {
  return error instanceof WalletSessionError ? walletSessionErrorResponse(error) : null;
}
