export const LIVE_POSITION_GUARD_REVIEW_REASONS = [
  "allowance_exceeds_order_limit",
  "balance_below_order_limit",
  "cancellation_unknown_state",
  "execution_not_confirmed",
  "execution_receipt_order_mismatch",
  "execution_result_unknown",
  "ineligible_route",
  "invalid_order_limit",
  "invalid_order_record",
  "missing_onchain_order_identity",
  "missing_submitted_at",
  "missing_transaction_hash",
  "onchain_order_mismatch",
  "onchain_order_not_closed",
  "onchain_order_plan_mismatch",
  "residual_executor_allowance",
  "transaction_receipt_timeout",
  "transaction_reverted",
  "unknown_onchain_order_status",
  "wallet_authority_not_cleared"
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
  if (reason === "residual_executor_allowance" || reason === "wallet_authority_not_cleared") {
    return "The automatic order is no longer eligible to execute, but the executor allowance is not proven zero or delegated signer cleanup is incomplete. Finish wallet-authority cleanup before continuing.";
  }
  if (reason === "onchain_order_not_closed") {
    return "The revoke request did not prove that the registered onchain order was cancelled, executed, or expired. Retry onchain cancellation before treating the permission as closed.";
  }
  if (
    reason === "onchain_order_mismatch"
    || reason === "onchain_order_plan_mismatch"
    || reason === "unknown_onchain_order_status"
    || reason === "missing_onchain_order_identity"
  ) {
    return "The server record no longer matches a verifiable registered onchain order. RMT blocked execution. Review the executor record, cancel any active order, clear allowance, and remove delegated signers.";
  }
  if (reason === "transaction_reverted") {
    return "The submitted exit reverted. The automatic order is stopped, but wallet authority may remain until the onchain order, allowance, and delegated signers are cleared.";
  }
  if (
    reason === "execution_not_confirmed"
    || reason === "execution_result_unknown"
    || reason === "execution_receipt_order_mismatch"
    || reason === "transaction_receipt_timeout"
    || reason === "missing_submitted_at"
    || reason === "missing_transaction_hash"
  ) {
    return "RMT could not prove the final execution result or reconcile it to the registered order. Do not re-arm this position. Review the transaction evidence and remove future wallet authority first.";
  }
  if (reason === "ineligible_route") {
    return "The exact zero-RMT-fee V3 exit route is no longer eligible. Automatic execution stopped before transaction submission.";
  }
  if (reason === "cancellation_unknown_state") {
    return "The server could not safely classify the prior order during cancellation. Complete onchain cancellation and wallet cleanup, then review the order record before continuing.";
  }
  if (reason === "invalid_order_limit" || reason === "invalid_order_record") {
    return "The automatic-order record failed its integrity checks. RMT blocked execution. Remove wallet authority and review the record before continuing.";
  }
  if (status === "approval_required") {
    return "The exact executor allowance changed or ended. Automatic execution is stopped until the old order and permission are cleared and a new plan is explicitly authorized.";
  }
  if (status === "no_position") {
    return "The protected wallet no longer holds this token. Cancel the registered order and clear any remaining executor allowance and delegated signer authority.";
  }
  if (status === "review_required") {
    return "Automatic execution is stopped because RMT could not prove that the server record, onchain order, wallet allowance, balance, and execution result remain inside the reviewed authority boundary.";
  }
  return null;
}
