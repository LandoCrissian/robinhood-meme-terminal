"use client";

import { WalletButton } from "../wallet-button";

/**
 * VNext-owned entrypoint to the shared external-wallet security runtime.
 * The shared wallet implementation remains authoritative during migration.
 */
export function VNextWalletConnection() {
  return <WalletButton target="mainnet" returnTo="/vnext" />;
}
