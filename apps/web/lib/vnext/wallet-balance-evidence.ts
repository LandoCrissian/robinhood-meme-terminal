import type { Address } from "viem";

export type VNextBalanceEvidenceState = "confirmed" | "stale" | "unavailable";

export type VNextBalanceEvidence = {
  balanceAtomic?: string;
  observedAtMs?: number;
  state: VNextBalanceEvidenceState;
};

export type VNextAssetBalanceEvidence = Record<string, VNextBalanceEvidence>;

type BalanceReadResult = {
  result?: unknown;
  status: "success" | "failure";
};

function priorOrUnavailable(previous: VNextBalanceEvidence | undefined): VNextBalanceEvidence {
  if (previous?.balanceAtomic !== undefined && /^(?:0|[1-9][0-9]*)$/.test(previous.balanceAtomic)) {
    return { ...previous, state: "stale" };
  }
  return { state: "unavailable" };
}

export function reconcileBalanceEvidence(
  result: BalanceReadResult | undefined,
  previous: VNextBalanceEvidence | undefined,
  observedAtMs: number
): VNextBalanceEvidence {
  if (result?.status === "success" && typeof result.result === "bigint" && result.result >= 0n) {
    return { balanceAtomic: result.result.toString(), observedAtMs, state: "confirmed" };
  }
  return priorOrUnavailable(previous);
}

export function reconcileAssetBalanceEvidence(
  candidates: readonly { address: Address }[],
  results: readonly BalanceReadResult[],
  previous: VNextAssetBalanceEvidence,
  observedAtMs: number
): VNextAssetBalanceEvidence {
  return Object.fromEntries(candidates.map((candidate, index) => {
    const key = candidate.address.toLowerCase();
    return [key, reconcileBalanceEvidence(results[index], previous[key], observedAtMs)];
  }));
}

export function confirmedBalanceAtomic(evidence: VNextBalanceEvidence | undefined) {
  return evidence?.state === "confirmed" ? evidence.balanceAtomic : undefined;
}

export function walletBalanceReadStatus(
  native: VNextBalanceEvidence,
  assets: VNextAssetBalanceEvidence
): "ready" | "stale" | "error" {
  const evidence = [native, ...Object.values(assets)];
  if (evidence.length > 0 && evidence.every((item) => item.state === "confirmed")) return "ready";
  if (evidence.some((item) => item.state === "confirmed" || item.state === "stale")) return "stale";
  return "error";
}
