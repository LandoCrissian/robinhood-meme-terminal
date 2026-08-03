const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";

type PairToken = {
  address?: unknown;
};

export function isNonzeroEvmAddress(value: string) {
  return EVM_ADDRESS_PATTERN.test(value) && value.toLowerCase() !== ZERO_EVM_ADDRESS;
}

export function canonicalExternalMarketLookupAddress(value: string | null | undefined) {
  const address = typeof value === "string" ? value.trim() : "";
  const normalizedPrefix = address.startsWith("0X") ? "0x" + address.slice(2) : address;
  return isNonzeroEvmAddress(normalizedPrefix) ? normalizedPrefix.toLowerCase() : null;
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
  return selectExternalPairBaseToken(
    baseToken,
    quoteToken,
    new Set([...canonicalQuoteAddresses, ...assetQuoteAddresses])
  ) ?? selectExternalPairBaseToken(baseToken, quoteToken, canonicalQuoteAddresses);
}
