import type { VNextExecutionRecord } from "./execution-recovery";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";

export type VNextResolvedExecutionOutcome = {
  state: "approval_confirmed" | "swap_confirmed" | "reverted";
  message: string;
};

export function resolvedVNextExecutionOutcome(input: {
  record: VNextExecutionRecord | null | undefined;
  handledTxHash?: string;
  wallet?: string;
  inputAsset?: string | null;
  outputAsset?: string | null;
  inputAmountAtomic?: string;
}): VNextResolvedExecutionOutcome | null {
  const { record } = input;
  if (
    !record || record.state === "submitted" || input.handledTxHash?.toLowerCase() === record.txHash.toLowerCase()
    || !input.wallet || record.wallet.toLowerCase() !== input.wallet.toLowerCase()
    || !input.inputAsset || record.inputAsset.toLowerCase() !== input.inputAsset.toLowerCase()
    || !input.outputAsset || record.outputAsset.toLowerCase() !== input.outputAsset.toLowerCase()
    || !input.inputAmountAtomic || record.inputAmountAtomic !== input.inputAmountAtomic
  ) return null;
  if (record.state === "reverted") return {
    state: "reverted",
    message: record.failureClassification === "EXPIRED_ONCHAIN_DEADLINE"
      ? "The swap expired before it reached the chain. No swap value moved. Network gas was spent. Get a fresh verified request before trying again."
      : "The transaction reverted. Fresh route and wallet state are required before retrying."
  };
  return record.kind === "erc20_approval" ? {
    state: "approval_confirmed",
    message: "Exact approval confirmed. The previous quote and payload were discarded."
  } : {
    state: "swap_confirmed",
    message: "Swap settlement confirmed onchain."
  };
}

export function postApprovalVerificationOutcome(evidence: VNextPreSignEvidence) {
  if (evidence.status === "verified") return {
    state: "swap_ready" as const,
    message: "Fresh allowance, balance, gas, route, and exact simulation passed. Prepare a separate swap review when ready."
  };
  if (evidence.status === "approval_required") return {
    state: "next_approval_ready" as const,
    message: "Fresh chain state requires one more exact approval. Review it separately in your wallet."
  };
  return {
    state: "blocked" as const,
    message: `Fresh verification returned ${evidence.status.replaceAll("_", " ")}. No wallet payload was prepared.`
  };
}

export type VNextApprovalAuthority = {
  approvalKind: NonNullable<VNextPreSignEvidence["approvalKind"]>;
  target: string;
  spender: string;
  amountAtomic: string;
};

export function repeatsConfirmedVNextApproval(
  confirmed: VNextApprovalAuthority | undefined,
  evidence: VNextPreSignEvidence
) {
  return Boolean(
    confirmed
    && evidence.status === "approval_required"
    && evidence.approvalKind
    && evidence.nextActionTarget
    && evidence.approvalSpender
    && confirmed.approvalKind === evidence.approvalKind
    && confirmed.target.toLowerCase() === evidence.nextActionTarget.toLowerCase()
    && confirmed.spender.toLowerCase() === evidence.approvalSpender.toLowerCase()
    && confirmed.amountAtomic === evidence.inputAmountAtomic
  );
}
