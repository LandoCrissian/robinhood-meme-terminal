import { getAddress, isAddress } from "viem";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID,
  TRUSTED_ASSET_ADDRESSES
} from "../vnext/trusted-asset-registry";

const admittedChains = [
  ETHEREUM_MAINNET_CHAIN_ID,
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID
] as const;

const admittedTokens = [{ chainId: ETHEREUM_MAINNET_CHAIN_ID, address: TRUSTED_ASSET_ADDRESSES.ETHEREUM_USDC },
  { chainId: ARBITRUM_MAINNET_CHAIN_ID, address: TRUSTED_ASSET_ADDRESSES.ARBITRUM_USDC },
  { chainId: BASE_MAINNET_CHAIN_ID, address: TRUSTED_ASSET_ADDRESSES.BASE_USDC },
  { chainId: ROBINHOOD_MAINNET_CHAIN_ID, address: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG }] as const;

function record(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function verifyAcrossReleaseDiscovery(input: { chains: unknown; tokens: unknown }) {
  if (!Array.isArray(input.chains) || !Array.isArray(input.tokens)) {
    throw new Error("Across release discovery returned malformed chain or token records.");
  }
  const chains = input.chains.map(record).filter((value): value is Record<string, unknown> => value !== null);
  for (const chainId of admittedChains) {
    const matches = chains.filter((chain) => chain.chainId === chainId || chain.chainId === String(chainId));
    if (matches.length !== 1) throw new Error(`Across release discovery did not uniquely admit chain ${chainId}.`);
  }
  const tokens = input.tokens.map(record).filter((value): value is Record<string, unknown> => value !== null);
  for (const admitted of admittedTokens) {
    const matches = tokens.filter((token) => {
      const chainMatches = token.chainId === admitted.chainId || token.chainId === String(admitted.chainId);
      return chainMatches && typeof token.address === "string" && isAddress(token.address, { strict: false })
        && getAddress(token.address) === admitted.address;
    });
    if (matches.length < 1 || matches.some((token) => token.decimals !== 6)) {
      throw new Error(`Across release discovery changed the exact admitted asset on chain ${admitted.chainId}.`);
    }
  }
  return {
    releaseAuthority: ["/swap/chains", "/swap/tokens", "/swap/approval"] as const,
    legacyAvailableRoutesAuthoritative: false,
    chainIds: admittedChains,
    assets: admittedTokens
  } as const;
}
