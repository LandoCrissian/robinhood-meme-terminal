import { getAddress, isAddress } from "viem";
import type { ExternalMarket, ExternalMarketResponse, UniversalMarketResolution } from "../external-market";
import type { AssetMetadata } from "./execution-domain";
import { evmAsset } from "./execution-domain";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_RMT,
  ROBINHOOD_RMT_ADDRESS,
  ROBINHOOD_WETH,
  ROBINHOOD_WETH_ADDRESS
} from "./robinhood-assets";

export type VNextDirectoryMarket = Pick<ExternalMarket,
  | "address"
  | "name"
  | "symbol"
  | "priceUsd"
  | "liquidityUsd"
  | "marketCapUsd"
  | "volume24h"
  | "priceChange24h"
  | "ageMinutes"
  | "signal"
  | "resolution"
>;

export type VNextDirectoryResponse = {
  markets?: VNextDirectoryMarket[];
  updatedAt?: string;
  stale?: boolean;
  error?: string;
};

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function text(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function normalizeDirectoryMarkets(payload: Pick<ExternalMarketResponse, "markets"> | VNextDirectoryResponse) {
  if (!Array.isArray(payload.markets)) return [];
  const seen = new Set<string>();
  return payload.markets.flatMap((market): VNextDirectoryMarket[] => {
    if (!isAddress(market.address, { strict: false })) return [];
    const address = getAddress(market.address);
    const key = address.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const symbol = text(market.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`;
    const name = text(market.name, 80) || symbol;
    return [{
      address,
      name,
      symbol,
      priceUsd: Math.max(0, finite(market.priceUsd)),
      liquidityUsd: Math.max(0, finite(market.liquidityUsd)),
      marketCapUsd: Math.max(0, finite(market.marketCapUsd)),
      volume24h: Math.max(0, finite(market.volume24h)),
      priceChange24h: finite(market.priceChange24h),
      ageMinutes: market.ageMinutes === null ? null : Math.max(0, finite(market.ageMinutes)),
      signal: market.signal,
      resolution: market.resolution
    }];
  });
}

function resolutionToken(resolution: UniversalMarketResolution | undefined, expectedAddress: string) {
  if (!resolution || resolution.chainId !== ROBINHOOD_MAINNET_CHAIN_ID) return null;
  if (!isAddress(resolution.token.address, { strict: false })) return null;
  if (getAddress(resolution.token.address) !== getAddress(expectedAddress)) return null;
  if (!Number.isSafeInteger(resolution.token.decimals) || resolution.token.decimals < 0 || resolution.token.decimals > 255) return null;
  return resolution.token;
}

export function verifiedDirectoryAsset(market: VNextDirectoryMarket, resolution = market.resolution): AssetMetadata | null {
  if (getAddress(market.address) === ROBINHOOD_RMT_ADDRESS) return ROBINHOOD_RMT;
  if (getAddress(market.address) === ROBINHOOD_WETH_ADDRESS) return ROBINHOOD_WETH;
  const token = resolutionToken(resolution, market.address);
  if (!token) return null;
  return {
    id: evmAsset(ROBINHOOD_MAINNET_CHAIN_ID, token.address),
    symbol: token.symbol.trim().slice(0, 16) || market.symbol,
    name: token.name.trim().slice(0, 80) || market.name,
    decimals: token.decimals,
    metadataState: "verified"
  };
}

export function resolutionFromLookup(payload: ExternalMarketResponse, address: string) {
  if (typeof payload.resolution?.token.address === "string" && payload.resolution.token.address.toLowerCase() === address.toLowerCase()) return payload.resolution;
  return payload.markets?.find((market) => typeof market.address === "string" && market.address.toLowerCase() === address.toLowerCase())?.resolution;
}
