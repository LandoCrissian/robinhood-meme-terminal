"use client";

import { WalletButton } from "../wallet-button";

/**
 * VNext-owned entrypoint to the shared external-wallet security runtime.
 * The shared wallet implementation remains authoritative during migration.
 */
export function VNextWalletConnection({ showFunding = true, compact = false }: { showFunding?: boolean; compact?: boolean }) {
  return <WalletButton target="mainnet" returnTo="/" showFunding={showFunding} compact={compact} />;
}

export function VNextRouteWalletConnection({ returnTo, compact = false }: { returnTo: string; compact?: boolean }) {
  return <WalletButton target="mainnet" returnTo={returnTo} showFunding={false} compact={compact} />;
}
