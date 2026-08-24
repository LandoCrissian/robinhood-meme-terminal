import { getAddress, isAddress, type Address } from "viem";
import { evmAsset, type AssetMetadata, type AssetRouteState } from "./execution-domain";
import type { ExternalMarketResponse } from "../external-market";
import type { VNextDirectoryMarket } from "./market-directory";
import type { VNextWalletDiscoveryAsset } from "./wallet-discovery";
import { safeTokenArtworkUrl } from "./token-artwork";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_USDG,
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH,
  ROBINHOOD_WETH_ADDRESS
} from "./robinhood-assets";
import { trustedPaymentAsset } from "./trusted-asset-registry";

export type VNextWalletAssetCandidate = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number | null;
  identityState: "verified" | "reported";
  source: "canonical" | "live_directory" | "manual_import" | "wallet_index";
  reputation: "ok" | "suspicious" | "unknown";
  imageUrl: string | null;
};

export type VNextDetectedWalletAsset = VNextWalletAssetCandidate & {
  balanceAtomic: string;
  routeState: AssetRouteState;
};

export function trustedPaymentMetadataFromDetectedWalletAsset(asset: VNextDetectedWalletAsset): AssetMetadata | null {
  const trusted = trustedPaymentAsset(ROBINHOOD_MAINNET_CHAIN_ID, asset.address);
  if (
    !trusted
    || !trusted.userVisible
    || asset.source !== "canonical"
    || asset.identityState !== "verified"
    || asset.reputation !== "ok"
    || asset.decimals !== trusted.decimals
    || !/^(?:0|[1-9][0-9]*)$/.test(asset.balanceAtomic)
    || BigInt(asset.balanceAtomic) <= 0n
  ) return null;
  return {
    id: evmAsset(ROBINHOOD_MAINNET_CHAIN_ID, trusted.address),
    symbol: trusted.symbol,
    name: trusted.name,
    decimals: trusted.decimals,
    metadataState: "verified"
  };
}

const CANONICAL_CANDIDATES: VNextWalletAssetCandidate[] = [
  {
    address: ROBINHOOD_USDG_ADDRESS,
    symbol: ROBINHOOD_USDG.symbol ?? "USDG",
    name: ROBINHOOD_USDG.name ?? "Global Dollar",
    decimals: ROBINHOOD_USDG.decimals,
    identityState: "verified",
    source: "canonical",
    reputation: "ok",
    imageUrl: null
  },
  {
    address: ROBINHOOD_WETH_ADDRESS,
    symbol: ROBINHOOD_WETH.symbol ?? "WETH",
    name: ROBINHOOD_WETH.name ?? "Wrapped Ether",
    decimals: ROBINHOOD_WETH.decimals,
    identityState: "verified",
    source: "canonical",
    reputation: "ok",
    imageUrl: null
  }
];

function cleanText(value: string, maximumLength: number) {
  return value.trim().slice(0, maximumLength);
}

export function importedWalletCandidate(payload: ExternalMarketResponse, requestedAddress: string): VNextWalletAssetCandidate | null {
  if (!isAddress(requestedAddress, { strict: false })) return null;
  const address = getAddress(requestedAddress);
  const token = payload.resolution?.token;
  if (!token || !isAddress(token.address, { strict: false }) || getAddress(token.address) !== address) return null;
  if (!Number.isSafeInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) return null;
  return {
    address,
    symbol: cleanText(token.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`,
    name: cleanText(token.name, 80) || "Verified token",
    decimals: token.decimals,
    identityState: "verified",
    source: "manual_import",
    reputation: "unknown",
    imageUrl: safeTokenArtworkUrl(payload.markets?.find((market) => market.address.toLowerCase() === address.toLowerCase())?.imageUri)
  };
}

export function walletDiscoveryCandidate(asset: VNextWalletDiscoveryAsset): VNextWalletAssetCandidate {
  return {
    address: asset.address,
    symbol: cleanText(asset.symbol, 16) || `${asset.address.slice(0, 6)}…${asset.address.slice(-4)}`,
    name: cleanText(asset.name, 80) || "Detected token",
    decimals: asset.decimals,
    identityState: "reported",
    source: "wallet_index",
    reputation: asset.reputation,
    imageUrl: safeTokenArtworkUrl(asset.imageUrl)
  };
}

export function walletAssetCandidates(
  markets: VNextDirectoryMarket[],
  maximum = 48,
  imported: VNextWalletAssetCandidate[] = []
) {
  const candidates = new Map<string, VNextWalletAssetCandidate>();
  for (const candidate of CANONICAL_CANDIDATES) candidates.set(candidate.address.toLowerCase(), candidate);
  for (const candidate of imported) {
    if (!isAddress(candidate.address, { strict: false })) continue;
    const address = getAddress(candidate.address);
    const existing = candidates.get(address.toLowerCase());
    if (!existing) candidates.set(address.toLowerCase(), { ...candidate, address });
    else if (!existing.imageUrl && candidate.imageUrl) candidates.set(address.toLowerCase(), { ...existing, imageUrl: candidate.imageUrl });
  }
  for (const market of markets.slice(0, Math.max(0, maximum))) {
    if (!isAddress(market.address, { strict: false })) continue;
    const address = getAddress(market.address);
    const key = address.toLowerCase();
    if (candidates.has(key)) continue;
    const symbol = cleanText(market.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`;
    candidates.set(key, {
      address,
      symbol,
      name: cleanText(market.name, 80) || symbol,
      decimals: null,
      identityState: "reported",
      source: "live_directory",
      reputation: "unknown",
      imageUrl: safeTokenArtworkUrl(market.imageUri)
    });
  }
  return [...candidates.values()];
}

export function detectedWalletAssets(input: Array<{
  candidate: VNextWalletAssetCandidate;
  balance: bigint | null;
  decimals?: number | null;
  symbol?: string | null;
  name?: string | null;
}>) {
  return input.flatMap(({ candidate, balance, decimals, symbol, name }): VNextDetectedWalletAsset[] => {
    if (balance === null || balance <= 0n) return [];
    const resolvedDecimals = candidate.decimals ?? (Number.isSafeInteger(decimals) && Number(decimals) >= 0 && Number(decimals) <= 255 ? Number(decimals) : null);
    const resolvedSymbol = cleanText(symbol ?? "", 16) || candidate.symbol;
    const resolvedName = cleanText(name ?? "", 80) || candidate.name;
    return [{
      ...candidate,
      symbol: resolvedSymbol,
      name: resolvedName,
      decimals: resolvedDecimals,
      identityState: candidate.identityState === "verified" || resolvedDecimals !== null ? "verified" : "reported",
      balanceAtomic: balance.toString(),
      routeState: "detected"
    }];
  });
}
