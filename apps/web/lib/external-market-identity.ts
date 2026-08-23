import { getAddress, isAddress } from "viem";
import type { AssetMarketEvidence, ExternalPoolIdentity } from "./external-market";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";

type PairToken = {
  address?: unknown;
  name?: unknown;
  symbol?: unknown;
};

export type ProviderPairEvidenceInput = {
  chainId?: unknown;
  pairAddress?: unknown;
  dexId?: unknown;
  baseToken?: PairToken;
  quoteToken?: PairToken;
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
  marketCap?: unknown;
  fdv?: unknown;
  volume?: { h24?: unknown };
  priceChange?: { h24?: unknown };
  pairCreatedAt?: unknown;
};

export function isNonzeroEvmAddress(value: string) {
  return EVM_ADDRESS_PATTERN.test(value) && value.toLowerCase() !== ZERO_EVM_ADDRESS;
}

export function canonicalExternalMarketLookupAddress(value: string | null | undefined) {
  const address = typeof value === "string" ? value.trim() : "";
  const normalizedPrefix = address.startsWith("0X") ? "0x" + address.slice(2) : address;
  return isNonzeroEvmAddress(normalizedPrefix) ? normalizedPrefix.toLowerCase() : null;
}

export function canonicalExternalPoolIdentity(value: unknown): ExternalPoolIdentity | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (isAddress(candidate, { strict: false }) && getAddress(candidate) !== ZERO_EVM_ADDRESS) {
    return { kind: "evm-address", value: getAddress(candidate) };
  }
  return BYTES32_PATTERN.test(candidate) && !/^0x0{64}$/i.test(candidate)
    ? { kind: "bytes32", value: candidate.toLowerCase() }
    : null;
}

export function canonicalExternalAssetId(chainId: number, address: string) {
  return Number.isSafeInteger(chainId) && chainId > 0 && isAddress(address, { strict: false })
    ? `eip155:${chainId}/contract:${getAddress(address)}`
    : null;
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenIdentity(token: PairToken | undefined) {
  const address = typeof token?.address === "string" ? token.address.trim() : "";
  if (!isAddress(address, { strict: false })) return null;
  return {
    address: getAddress(address),
    name: typeof token?.name === "string" ? token.name.trim().slice(0, 80) : "",
    symbol: typeof token?.symbol === "string" ? token.symbol.trim().slice(0, 20) : ""
  };
}

export function normalizeProviderPairForAsset(
  pair: ProviderPairEvidenceInput,
  assetAddress: string,
  options: {
    chainId: 4663;
    chainSlug: string;
    canonicalQuoteAddresses: ReadonlySet<string>;
    assetQuoteAddresses?: ReadonlySet<string>;
    provenance: AssetMarketEvidence["provenance"];
  }
): AssetMarketEvidence | null {
  if (pair.chainId !== options.chainSlug || !isAddress(assetAddress, { strict: false })) return null;
  const token = getAddress(assetAddress);
  const baseToken = tokenIdentity(pair.baseToken);
  const quoteToken = tokenIdentity(pair.quoteToken);
  const pool = canonicalExternalPoolIdentity(pair.pairAddress);
  if (!baseToken || !quoteToken || !pool) return null;
  const assetSide = baseToken.address === token ? "BASE" : quoteToken.address === token ? "QUOTE" : null;
  if (!assetSide) return null;
  const assetToken = assetSide === "BASE" ? baseToken : quoteToken;
  const quoteSet = new Set([
    ...options.canonicalQuoteAddresses,
    ...(options.assetQuoteAddresses ?? [])
  ].map((address) => address.toLowerCase()));
  const quoteSupported = assetSide === "BASE" && (
    quoteSet.has(quoteToken.address.toLowerCase())
    || (quoteToken.address === ZERO_EVM_ADDRESS && pool.kind === "bytes32")
  );
  const rawPrice = finite(pair.priceUsd);
  const priceUsd = assetSide === "BASE" && quoteSupported && rawPrice !== null && rawPrice > 0 ? rawPrice : null;
  const displayEligibility = assetSide === "QUOTE"
    ? "invalid-token-perspective"
    : !quoteSupported
      ? "unsupported-quote"
      : priceUsd === null
        ? "missing-price"
        : "eligible";
  const nonnegative = (value: unknown) => {
    const parsed = finite(value);
    return parsed !== null && parsed >= 0 ? parsed : null;
  };
  const protocolVersion = pool.kind === "bytes32"
    ? 4
    : /(?:^|-)v2(?:$|-)/i.test(String(pair.dexId ?? ""))
      ? 2
      : /(?:^|-)v3(?:$|-)/i.test(String(pair.dexId ?? ""))
        ? 3
        : null;
  return {
    chainId: options.chainId,
    assetId: canonicalExternalAssetId(options.chainId, token)!,
    token: assetToken,
    venue: typeof pair.dexId === "string" && pair.dexId.trim() ? pair.dexId.trim().slice(0, 30) : "DEX",
    protocolVersion,
    pool,
    baseToken,
    quoteToken,
    assetSide,
    displayEligibility,
    chartEligibility: pool.kind === "evm-address" ? "eligible" : "unavailable",
    executionEligibility: "view-only",
    provenance: options.provenance,
    priceUsd,
    liquidityUsd: nonnegative(pair.liquidity?.usd),
    marketCapUsd: assetSide === "BASE" && quoteSupported ? nonnegative(pair.marketCap) : null,
    fdvUsd: assetSide === "BASE" && quoteSupported ? nonnegative(pair.fdv) : null,
    volume24h: nonnegative(pair.volume?.h24),
    priceChange24h: assetSide === "BASE" && quoteSupported ? finite(pair.priceChange?.h24) : null,
    pairCreatedAt: nonnegative(pair.pairCreatedAt)
  };
}

export function selectExternalPairBaseToken<T extends PairToken>(
  baseToken: T | undefined,
  quoteToken: T | undefined,
  excludedAddresses: ReadonlySet<string>
) {
  const baseAddress = typeof baseToken?.address === "string" ? baseToken.address.trim() : "";
  const quoteAddress = typeof quoteToken?.address === "string" ? quoteToken.address.trim() : "";
  const baseIsExternal = isNonzeroEvmAddress(baseAddress) && !excludedAddresses.has(baseAddress.toLowerCase());
  const quoteIsCanonical = isNonzeroEvmAddress(quoteAddress) && excludedAddresses.has(quoteAddress.toLowerCase());

  return baseIsExternal && quoteIsCanonical ? baseToken : undefined;
}

export function selectExternalPairBaseTokenWithAssetQuotes<T extends PairToken>(
  baseToken: T | undefined,
  quoteToken: T | undefined,
  canonicalQuoteAddresses: ReadonlySet<string>,
  assetQuoteAddresses: ReadonlySet<string>
) {
  const baseAddress = typeof baseToken?.address === "string" ? baseToken.address.trim() : "";
  const quoteAddress = typeof quoteToken?.address === "string" ? quoteToken.address.trim().toLowerCase() : "";
  const excludedAddresses = new Set([...canonicalQuoteAddresses, ...assetQuoteAddresses].map((address) => address.toLowerCase()));
  if (
    isNonzeroEvmAddress(baseAddress)
    && !excludedAddresses.has(baseAddress.toLowerCase())
    && quoteAddress === ZERO_EVM_ADDRESS
  ) return baseToken;
  return selectExternalPairBaseToken(
    baseToken,
    quoteToken,
    excludedAddresses
  ) ?? selectExternalPairBaseToken(baseToken, quoteToken, canonicalQuoteAddresses);
}
