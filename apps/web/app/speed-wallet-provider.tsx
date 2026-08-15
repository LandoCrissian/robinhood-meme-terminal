"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { walletChains, walletTransports } from "./wallet-config";
import { configuredPrivyAppId } from "../lib/privy-config";
import { rmtExternalWalletOptions } from "../lib/wallet-gateway";
import { PrivyIdentityBridge } from "./rmt-identity";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.rmtlaunch.fun";
const speedWalletConfig = createConfig({
  chains: walletChains,
  transports: walletTransports,
  ssr: true
});

export function SpeedWalletProvider({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  if (!configuredPrivyAppId) return children;
  return (
    <PrivyProvider
      appId={configuredPrivyAppId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#35ef73",
          logo: `${appUrl}/brand/rmt-master-logo.png`,
          landingHeader: "Connect your RMT trading wallet",
          loginMessage: "Use an external Ethereum wallet you control. RMT never receives its private key.",
          showWalletLoginFirst: true,
          walletChainType: "ethereum-only",
          walletList: rmtExternalWalletOptions()
        },
        loginMethods: ["email", "google", "passkey", "wallet"],
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain, robinhoodChainTestnet],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
          extendedCalldataDecoding: true,
          priceDisplay: { primary: "fiat-currency", secondary: "native-token" }
        },
        mfa: { noPromptOnMfaRequired: false },
        passkeys: {
          shouldUnlinkOnUnenrollMfa: false,
          shouldUnenrollMfaOnUnlink: false
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={speedWalletConfig}>
          <PrivyIdentityBridge>{children}</PrivyIdentityBridge>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
