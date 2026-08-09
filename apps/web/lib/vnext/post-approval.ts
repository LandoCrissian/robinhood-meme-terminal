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
    message: "The transaction reverted. Fresh route and wallet state are required before retrying."
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
  return evidence.status === "verified" ? {
    state: "swap_ready" as const,
    message: "Fresh allowance, balance, gas, route, and exact simulation passed. Prepare a separate swap review when ready."
  } : {
    state: "blocked" as const,
    message: `Fresh verification returned ${evidence.status.replaceAll("_", " ")}. No swap payload was prepared.`
  };
}
