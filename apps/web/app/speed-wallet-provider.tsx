"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { walletChains, walletTransports } from "./wallet-config";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.rmtlaunch.fun";
const speedWalletConfig = createConfig({
  chains: walletChains,
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
          landingHeader: "Your RMT trading wallet",
          loginMessage: "Use your wallet or create a user-owned Robinhood Chain wallet in seconds.",
          walletChainType: "ethereum-only",
          walletList: ["detected_wallets", "wallet_connect", "metamask", "coinbase_wallet"]
        },
        loginMethods: ["email", "google", "passkey", "wallet"],
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain, robinhoodChainTestnet],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
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
        <WagmiProvider config={speedWalletConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
