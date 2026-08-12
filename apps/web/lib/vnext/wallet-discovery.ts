import { getAddress, isAddress, type Address } from "viem";
import { safeTokenArtworkUrl } from "./token-artwork";

export const MAX_WALLET_DISCOVERY_ASSETS = 160;

export type VNextWalletDiscoveryAsset = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number | null;
  reputation: "ok" | "suspicious" | "unknown";
  imageUrl: string | null;
};

export type VNextWalletDiscoveryResponse = {
  chainId: 4_663;
  wallet: Address;
  assets: VNextWalletDiscoveryAsset[];
  complete: boolean;
  source: "robinhood-chain-blockscout";
  observedAt: string;
  error?: string;
};

type BlockscoutTokenBalance = {
  token?: {
    address_hash?: unknown;
    decimals?: unknown;
    name?: unknown;
    icon_url?: unknown;
    reputation?: unknown;
    symbol?: unknown;
    type?: unknown;
  };
  value?: unknown;
};

function cleanText(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function tokenDecimals(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null;
}

function positiveAtomic(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n;
}

function tokenReputation(value: unknown): VNextWalletDiscoveryAsset["reputation"] {
  if (value === "ok") return "ok";
  if (typeof value === "string" && value.trim() && value !== "unknown") return "suspicious";
  return "unknown";
}

export function parseBlockscoutWalletAssets(payload: unknown, maximum = MAX_WALLET_DISCOVERY_ASSETS) {
  if (!Array.isArray(payload)) throw new Error("Wallet index returned an invalid balance list.");
  const assets = new Map<string, VNextWalletDiscoveryAsset>();
  for (const entry of payload as BlockscoutTokenBalance[]) {
    if (assets.size >= Math.max(0, maximum)) break;
    const token = entry?.token;
    if (!token || token.type !== "ERC-20" || !positiveAtomic(entry.value)) continue;
    const rawAddress = token.address_hash;
    if (typeof rawAddress !== "string" || !isAddress(rawAddress, { strict: false })) continue;
    const address = getAddress(rawAddress);
    const key = address.toLowerCase();
    if (assets.has(key)) continue;
    const symbol = cleanText(token.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`;
    assets.set(key, {
      address,
      symbol,
      name: cleanText(token.name, 80) || "Detected token",
      decimals: tokenDecimals(token.decimals),
      reputation: tokenReputation(token.reputation),
      imageUrl: safeTokenArtworkUrl(token.icon_url)
    });
  }
  return [...assets.values()];
}

export function normalizeWalletDiscoveryResponse(payload: unknown, expectedWallet: string): VNextWalletDiscoveryResponse | null {
  if (!payload || typeof payload !== "object" || !isAddress(expectedWallet, { strict: false })) return null;
  const candidate = payload as Partial<VNextWalletDiscoveryResponse>;
  if (
    candidate.chainId !== 4_663
    || candidate.source !== "robinhood-chain-blockscout"
    || typeof candidate.wallet !== "string"
    || !isAddress(candidate.wallet, { strict: false })
    || getAddress(candidate.wallet) !== getAddress(expectedWallet)
    || typeof candidate.complete !== "boolean"
    || typeof candidate.observedAt !== "string"
    || !Array.isArray(candidate.assets)
    || candidate.assets.length > MAX_WALLET_DISCOVERY_ASSETS
  ) return null;
  const assets = candidate.assets.flatMap((asset): VNextWalletDiscoveryAsset[] => {
    if (!asset || typeof asset !== "object") return [];
    const raw = asset as Partial<VNextWalletDiscoveryAsset>;
    if (typeof raw.address !== "string" || !isAddress(raw.address, { strict: false })) return [];
    const decimals = raw.decimals;
    if (!Number.isSafeInteger(decimals) && decimals !== null) return [];
    if (typeof decimals === "number" && (decimals < 0 || decimals > 255)) return [];
    if (!["ok", "suspicious", "unknown"].includes(raw.reputation ?? "")) return [];
    const address = getAddress(raw.address);
    return [{
      address,
      symbol: cleanText(raw.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`,
      name: cleanText(raw.name, 80) || "Detected token",
      decimals: decimals as number | null,
      reputation: raw.reputation as VNextWalletDiscoveryAsset["reputation"],
      imageUrl: safeTokenArtworkUrl(raw.imageUrl)
    }];
  });
  return {
    chainId: 4_663,
    wallet: getAddress(candidate.wallet),
    assets,
    complete: candidate.complete,
    source: "robinhood-chain-blockscout",
    observedAt: candidate.observedAt,
    ...(typeof candidate.error === "string" ? { error: candidate.error.slice(0, 240) } : {})
  };
}
