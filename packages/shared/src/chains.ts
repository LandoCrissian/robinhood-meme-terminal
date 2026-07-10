import { defineChain } from "viem";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com/"] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Blockscout", url: "https://robinhoodchain.blockscout.com" }
  }
});

export const robinhoodChainTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com/"] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Testnet Explorer", url: "https://explorer.testnet.chain.robinhood.com" }
  },
  testnet: true
});
