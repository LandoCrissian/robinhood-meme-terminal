"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { walletChains, walletConnectors, walletTransports } from "./wallet-config";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.rmtlaunch.fun";
const speedWalletConfig = createConfig({
  chains: walletChains,
  connectors: walletConnectors,
  transports: walletTransports,
  ssr: true
});

export function SpeedWalletProvider({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  if (!privyAppId) return children;
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#35ef73",
          logo: `${appUrl}/brand/rmt-master-logo.png`,
          landingHeader: "RMT Speed Wallet",
          loginMessage: "Create an optional user-owned wallet for faster Robinhood Chain trading."
        },
        loginMethods: ["email", "google", "passkey", "wallet"],
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain, robinhoodChainTestnet],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          showWalletUIs: true,
          extendedCalldataDecoding: true
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={speedWalletConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
