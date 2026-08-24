import { getAddress, isAddress, type Address } from "viem";

export const TERMINAL_ROOT_PATH = "/" as const;

export function normalizeLegacyTerminalMarketAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) return null;
  return getAddress(value.toLowerCase()).toLowerCase() as Address;
}

export function legacyTerminalMarketRedirect(value: unknown) {
  const address = normalizeLegacyTerminalMarketAddress(value);
  return address ? `/?market=${address}` : TERMINAL_ROOT_PATH;
}
