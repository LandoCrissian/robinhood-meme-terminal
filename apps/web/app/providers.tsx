"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig } from "wagmi";
import { ProfileProvider } from "./profile-provider";
import { ReferralCapture } from "./referral-capture";
import { CommunityLive } from "./community-live";
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

const SpeedWalletProvider = dynamic(
  () => import("./speed-wallet-provider").then((module) => module.SpeedWalletProvider),
  { ssr: false }
);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  const application = (
    <ProfileProvider><ReferralCapture /><ExperienceTelemetry />{children}<CommunityLive /></ProfileProvider>
  );

  const legacyApplication = (
    <WagmiProvider config={getLegacyWalletConfig()}>
      <QueryClientProvider client={queryClient}>{application}</QueryClientProvider>
    </WagmiProvider>
  );

  if (speedWalletEnabled) {
    return (
      <RecoveryBoundary name="wallet-provider" fallback={legacyApplication}>
        <SpeedWalletProvider queryClient={queryClient}>{application}</SpeedWalletProvider>
      </RecoveryBoundary>
    );
  }
  return legacyApplication;
}
