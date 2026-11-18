/** Development policy only: not a deployed contract or market observation. */
export const treasuryPurchaseV2Capability = Object.freeze({
  profile: "rmt-project-treasury-purchase-v2-prototype",
  status: "NOT_EXECUTABLE",
  reason: "INDEPENDENT_REFERENCE_NOT_ADMITTED",
  scope: "development-policy",
  deployed: false,
  spendingAuthority: false,
  executionAvailable: false,
} as const);

export function treasuryPurchaseIntentLabel(enabled: boolean): string {
  return enabled ? "Recorded · cannot execute buys" : "OFF";
}

export function treasuryPurchaseIntentAction(enabled: boolean): string {
  return enabled ? "Review revoking purchase intent" : "Review recording intent only";
}
