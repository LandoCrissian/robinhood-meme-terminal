"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { WagmiProvider, createConfig as createWagmiConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

declare global {
  interface Window {
    __RMT_PRIVY_BRIDGE_ACCEPTANCE_PROVIDERS__?: Record<string, unknown>;
  }
}

function acceptanceConnector(id: string, name: string) {
  return injected({
    target: {
      id,
      name,
      provider: () => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_PROVIDERS__?.[id] as never
    }
  });
}

export function createConfig() {
  const rpc = process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0];
  return createWagmiConfig({
    chains: [robinhoodChainTestnet, robinhoodChain],
    connectors: [
      acceptanceConnector("rmt-privy-embedded", "RMT embedded acceptance wallet"),
      acceptanceConnector("rmt-privy-external", "RMT external acceptance wallet")
    ],
    transports: {
      [robinhoodChainTestnet.id]: http(rpc, { retryCount: 0 }),
      [robinhoodChain.id]: http(rpc, { retryCount: 0 })
    },
    ssr: true
  });
}

export { WagmiProvider };
