"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig } from "wagmi";
import { ProfileProvider } from "./profile-provider";
import { ExperienceTelemetry } from "./experience-telemetry";
import { createLegacyWalletConnectors, walletChains, walletTransports } from "./wallet-config";
import { speedWalletEnabled } from "../lib/privy-config";
import { RecoveryBoundary } from "./recovery-boundary";

let legacyWalletConfig: ReturnType<typeof createConfig> | undefined;

function getLegacyWalletConfig() {
  legacyWalletConfig ??= createConfig({
    chains: walletChains,
    connectors: createLegacyWalletConnectors(),
    transports: walletTransports,
    ssr: true
  });
  return legacyWalletConfig;
}

function LegacyWalletProvider({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  return (
    <WagmiProvider config={getLegacyWalletConfig()}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

const SpeedWalletProvider = dynamic(
  () => import("./speed-wallet-provider").then((module) => module.SpeedWalletProvider),
  { ssr: false }
);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const pathname = usePathname();
  const profileCompatibilityEnabled = [
    "/admin",
    "/deploy-consent-testnet",
    "/deploy-mainnet",
    "/deploy-testnet"
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  const terminal = <><ExperienceTelemetry />{children}</>;
  const application = profileCompatibilityEnabled
    ? <ProfileProvider>{terminal}</ProfileProvider>
    : terminal;

  const legacyApplication = <LegacyWalletProvider queryClient={queryClient}>{application}</LegacyWalletProvider>;

  if (speedWalletEnabled) {
    return (
      <RecoveryBoundary name="wallet-provider" fallback={legacyApplication}>
        <SpeedWalletProvider queryClient={queryClient}>{application}</SpeedWalletProvider>
      </RecoveryBoundary>
    );
  }
  return legacyApplication;
}
