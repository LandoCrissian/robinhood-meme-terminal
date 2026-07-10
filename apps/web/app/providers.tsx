"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

const config = createConfig({
  chains: [robinhoodChainTestnet, robinhoodChain],
  connectors: [injected({ shimDisconnect: true })],
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
