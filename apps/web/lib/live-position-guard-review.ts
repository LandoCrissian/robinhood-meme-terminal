export const LIVE_POSITION_GUARD_REVIEW_REASONS = [
  "allowance_exceeds_order_limit",
  "balance_below_order_limit",
  "cancellation_unknown_state",
  "execution_not_confirmed",
  "execution_result_unknown",
  "ineligible_route",
  "invalid_order_limit",
  "invalid_order_record",
  "missing_submitted_at",
  "missing_transaction_hash",
  "transaction_receipt_timeout",
  "transaction_reverted"
] as const;

export type LivePositionGuardReviewReason = typeof LIVE_POSITION_GUARD_REVIEW_REASONS[number];

const REVIEW_REASONS = new Set<string>(LIVE_POSITION_GUARD_REVIEW_REASONS);

export function livePositionGuardReviewReason(value: unknown): LivePositionGuardReviewReason | null {
  return typeof value === "string" && REVIEW_REASONS.has(value)
    ? value as LivePositionGuardReviewReason
    : null;
}

export function livePositionGuardReviewMessage(
  reason: LivePositionGuardReviewReason | null,
  status?: string | null
) {
  if (reason === "allowance_exceeds_order_limit") {
    return "The executor allowance is larger than the amount you reviewed. Automatic execution stopped. Revoke the allowance and all delegated signers before creating another order.";
  }
  if (reason === "balance_below_order_limit") {
    return "The wallet balance fell below the exact protected amount. RMT stopped instead of leaving a residual executor allowance. Revoke the old permission and explicitly arm a new amount.";
  }
  if (reason === "transaction_reverted") {
    return "The submitted exit reverted. The automatic order is stopped, but wallet authority may remain until allowance and delegated signers are revoked.";
  }
  if (
    reason === "execution_not_confirmed"
    || reason === "execution_result_unknown"
    || reason === "transaction_receipt_timeout"
    || reason === "missing_submitted_at"
    || reason === "missing_transaction_hash"
  ) {
    return "RMT could not prove the final execution result. Do not re-arm this position. Review the transaction evidence and remove future wallet authority first.";
  }
  if (reason === "ineligible_route") {
    return "The verified zero-RMT-fee exit route is no longer eligible. Automatic execution stopped before transaction submission.";
  }
  if (reason === "cancellation_unknown_state") {
    return "The server could not safely classify the prior order during cancellation. Complete wallet cleanup and review the order record before continuing.";
  }
  if (reason === "invalid_order_limit" || reason === "invalid_order_record") {
    return "The automatic-order record failed its integrity checks. RMT blocked execution. Remove wallet authority and review the record before continuing.";
  }
  if (status === "approval_required") {
    return "The exact executor allowance changed or ended. Automatic execution is stopped until the old permission is cleared and a new plan is explicitly authorized.";
  }
  if (status === "no_position") {
    return "The protected wallet no longer holds this token. Clear any remaining executor allowance and delegated signer authority.";
  }
  if (status === "review_required") {
    return "Automatic execution is stopped because RMT could not prove that the order remains inside its reviewed authority boundary.";
  }
  return null;
}
