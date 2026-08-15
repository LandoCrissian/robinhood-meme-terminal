"use client";

import { WalletButton } from "../wallet-button";

/**
 * VNext-owned entrypoint to the shared external-wallet security runtime.
 * The shared wallet implementation remains authoritative during migration.
 */
export function VNextWalletConnection({ showFunding = true }: { showFunding?: boolean }) {
  return <WalletButton target="mainnet" returnTo="/" showFunding={showFunding} />;
}
