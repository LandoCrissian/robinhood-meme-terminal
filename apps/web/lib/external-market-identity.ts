const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";

type PairToken = {
  address?: unknown;
};

export function isNonzeroEvmAddress(value: string) {
  return EVM_ADDRESS_PATTERN.test(value) && value.toLowerCase() !== ZERO_EVM_ADDRESS;
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
