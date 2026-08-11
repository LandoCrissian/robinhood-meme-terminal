import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID
} from "../vnext/trusted-asset-registry";

export type AcrossRpcChainId = typeof ETHEREUM_MAINNET_CHAIN_ID
  | typeof ARBITRUM_MAINNET_CHAIN_ID
  | typeof BASE_MAINNET_CHAIN_ID
  | typeof ROBINHOOD_MAINNET_CHAIN_ID;

const rpcEnvironment = {
  [ETHEREUM_MAINNET_CHAIN_ID]: {
    url: "RMT_ETHEREUM_RPC_URL",
    token: "RMT_ETHEREUM_RPC_AUTH_TOKEN",
    fallback: "https://ethereum-rpc.publicnode.com"
  },
  [ARBITRUM_MAINNET_CHAIN_ID]: {
    url: "RMT_ARBITRUM_RPC_URL",
    token: "RMT_ARBITRUM_RPC_AUTH_TOKEN",
    fallback: "https://arb1.arbitrum.io/rpc"
  },
  [BASE_MAINNET_CHAIN_ID]: {
    url: "RMT_BASE_RPC_URL",
    token: "RMT_BASE_RPC_AUTH_TOKEN",
    fallback: "https://mainnet.base.org"
  },
  [ROBINHOOD_MAINNET_CHAIN_ID]: {
    url: "RMT_ACROSS_ROBINHOOD_RPC_URL",
    token: "RMT_ACROSS_ROBINHOOD_RPC_AUTH_TOKEN",
    fallback: "https://rpc.mainnet.chain.robinhood.com/"
  }
} as const;

export function acrossRpcEndpoint(chainId: AcrossRpcChainId, env: NodeJS.ProcessEnv = process.env) {
  const configuration = rpcEnvironment[chainId];
  if (chainId === ROBINHOOD_MAINNET_CHAIN_ID) {
    return env[configuration.url]?.trim()
      || env.RMT_RPC_URL?.trim()
      || env.NEXT_PUBLIC_RMT_RPC_URL?.trim()
      || configuration.fallback;
  }
  return env[configuration.url]?.trim() || configuration.fallback;
}

export function acrossRpcHeaders(chainId: AcrossRpcChainId, env: NodeJS.ProcessEnv = process.env) {
  const token = env[rpcEnvironment[chainId].token]?.trim();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

export function acrossDedicatedRpcConfigured(env: NodeJS.ProcessEnv = process.env) {
  return (Object.keys(rpcEnvironment).map(Number) as AcrossRpcChainId[]).every((chainId) => {
    const configuration = rpcEnvironment[chainId];
    const token = env[configuration.token]?.trim();
    try {
      return new URL(env[configuration.url]?.trim() ?? "").protocol === "https:" && Boolean(token);
    } catch {
      return false;
    }
  });
}
