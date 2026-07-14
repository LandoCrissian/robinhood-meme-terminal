"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { coinbaseWallet, injected, metaMask, walletConnect } from "wagmi/connectors";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const connectors = [
  metaMask({
    dappMetadata: {
      name: "Robinhood Meme Terminal",
      url: appUrl,
      iconUrl: `${appUrl}/brand/rmt-master-logo.png`
    },
    preferDesktop: false,
    enableAnalytics: false
  }),
  coinbaseWallet({
    appName: "Robinhood Meme Terminal",
    appLogoUrl: `${appUrl}/brand/rmt-master-logo.png`,
    preference: "all",
    version: "4"
  }),
  injected({ shimDisconnect: true }),
  ...(walletConnectProjectId
    ? [walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
        metadata: {
          name: "Robinhood Meme Terminal",
          description: "Robinhood Chain meme launchpad and discovery terminal",
          url: appUrl,
          icons: [`${appUrl}/brand/rmt-master-logo.png`]
        }
      })]
    : [])
];

const config = createConfig({
  chains: [robinhoodChainTestnet, robinhoodChain],
  connectors,
  transports: {
    [robinhoodChainTestnet.id]: http(robinhoodChainTestnet.rpcUrls.default.http[0]),
    [robinhoodChain.id]: http(robinhoodChain.rpcUrls.default.http[0])
  },
  ssr: true
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
