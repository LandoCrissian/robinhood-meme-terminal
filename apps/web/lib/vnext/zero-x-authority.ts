/** Current Robinhood Chain public approval authority. Configuration cannot redirect it. */
export const RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734" as const;

export function isCanonicalZeroXAllowanceHolder(value: unknown): boolean {
  return typeof value === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(value)
    && value.toLowerCase() === RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER.toLowerCase();
}
