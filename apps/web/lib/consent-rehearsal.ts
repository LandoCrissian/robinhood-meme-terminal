import releaseJson from "./generated/consent-testnet-release.json";
import type { Address, Hex } from "viem";

export const consentRehearsalContractNames = [
  "venue",
  "governance",
  "pairedToken",
  "weth",
  "factory",
  "pool",
  "positionManager",
  "consentStack",
  "session",
  "migrator"
] as const;

export type ConsentRehearsalContractName = (typeof consentRehearsalContractNames)[number];
export type ConsentRehearsalRelease = typeof releaseJson;

/**
 * Public, generated evidence only. The canonical source is the immutable
 * deployment record under packages/contracts/deployments; CI regenerates this
 * file and rejects drift.
 */
export const consentRehearsalRelease: ConsentRehearsalRelease = releaseJson;

export type ConsentRehearsalIntegrity = "verified" | "mismatch" | "unavailable";
export type ConsentRehearsalProofMode = "verified" | "active" | "unavailable" | "attention";
export const CONSENT_REHEARSAL_PROOF_MAX_AGE_MS = 60_000;
export const CONSENT_REHEARSAL_PROOF_MAX_FUTURE_SKEW_MS = 30_000;
export type ConsentRehearsalActivationState =
  | "paused"
  | "proposal-pending"
  | "ready-to-execute"
  | "proposal-expired"
  | "active"
  | "paused-after-activation"
  | "mismatch"
  | "unavailable";
export type ConsentRehearsalProposalStatus =
  | "scheduled"
  | "awaiting-confirmations"
  | "ready"
  | "expired"
  | "cancelled"
  | "executed"
  | "stale-epoch";

export type ConsentRehearsalActivationProposal = {
  id: string;
  status: ConsentRehearsalProposalStatus;
  executeAfter: string;
  executeBefore: string;
  confirmations: string;
  transaction: {
    target: Address;
    value: "0";
    data: Hex;
  };
};

export type ConsentRehearsalStatus = {
  ok: boolean;
  integrity: ConsentRehearsalIntegrity;
  activationState: ConsentRehearsalActivationState;
  checkedAt: string;
  error: string | null;
  release: ConsentRehearsalRelease;
  network: {
    expectedChainId: number;
    observedChainId: number | null;
    latestBlock: string | null;
    blockTimestamp: string | null;
    blockAgeSeconds: number | null;
  };
  live: {
    paused: boolean | null;
    governanceTransactionCount: string | null;
    governanceConfigurationEpoch: string | null;
    positionsMinted: string | null;
    matchingActivationProposalCount: number | null;
    sessionIdle: boolean | null;
    sessionTokenBalances: { pairedToken: string; weth: string } | null;
    migratorTokenBalances: { pairedToken: string; weth: string } | null;
  };
  activationProposal: ConsentRehearsalActivationProposal | null;
  mismatches: string[];
};

export function isConsentRehearsalProofFresh(
  status: ConsentRehearsalStatus,
  nowMs = Date.now()
) {
  const checkedAtMs = Date.parse(status.checkedAt);
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(nowMs)) return false;
  const ageMs = nowMs - checkedAtMs;
  return (
    ageMs >= -CONSENT_REHEARSAL_PROOF_MAX_FUTURE_SKEW_MS
    && ageMs <= CONSENT_REHEARSAL_PROOF_MAX_AGE_MS
  );
}

export function getConsentRehearsalProofMode(
  status: ConsentRehearsalStatus | null,
  nowMs = Date.now()
): ConsentRehearsalProofMode {
  if (!status || !isConsentRehearsalProofFresh(status, nowMs) || status.integrity === "unavailable") {
    return "unavailable";
  }
  if (!status.ok || status.integrity === "mismatch") return "attention";
  if (status.activationState === "active" && status.live.paused === false) return "active";
  return status.live.paused === true ? "verified" : "attention";
}
