"use client";

import type { ReactNode } from "react";
import { LaunchShell, LaunchWalletShell } from "./(launchpad)/_components/launch-shell";
import { LaunchWalletProvider } from "./(launchpad)/_components/launch-wallet";

export function AppRuntime({ children, showcase }: { children: ReactNode; showcase: boolean }) {
  if (showcase) return <LaunchShell network="Read-only preview" walletLabel="Wallet">{children}</LaunchShell>;
  return <LaunchWalletProvider><LaunchWalletShell>{children}</LaunchWalletShell></LaunchWalletProvider>;
}
