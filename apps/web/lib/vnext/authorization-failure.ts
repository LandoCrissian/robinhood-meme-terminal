export const VNEXT_VERIFY_AGAIN_REASONS = [
  "AUTHORITY_CHANGED",
  "COMMITMENT_INVALID_OR_EXPIRED",
  "MARKET_BELOW_VERIFIED_FLOOR",
  "ROUTE_CHANGED",
  "IMMUTABLE_CONTINUITY_CHANGED",
  "DEADLINE_CHANGED_OR_EXPIRED",
  "APPROVAL_CHANGED",
  "PREPARE_FAILED"
] as const;

export type VNextVerifyAgainReason = typeof VNEXT_VERIFY_AGAIN_REASONS[number];

export function vNextVerifyAgainReason(value: unknown): VNextVerifyAgainReason | undefined {
  return typeof value === "string" && VNEXT_VERIFY_AGAIN_REASONS.includes(value as VNextVerifyAgainReason)
    ? value as VNextVerifyAgainReason
    : undefined;
}
