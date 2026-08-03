import { keccak256, toHex, type Hex } from "viem";
import { normalizeProjectSlug } from "./creator-application";

export const CREATOR_RELEASE_DECISION_SCHEMA_VERSION = 1 as const;
export const CREATOR_RELEASE_OUTCOMES = [
  "preparation_ready",
  "changes_requested",
  "declined"
] as const;
export const CREATOR_RELEASE_REASON_CODES = [
  "preparation_complete",
  "rights_or_provenance",
  "consent_or_splits",
  "media_or_metadata",
  "economics_or_policy",
  "other"
] as const;

export type CreatorReleaseOutcome = typeof CREATOR_RELEASE_OUTCOMES[number];
export type CreatorReleaseReasonCode = typeof CREATOR_RELEASE_REASON_CODES[number];

export type CreatorReleaseDecision = {
  schemaVersion: typeof CREATOR_RELEASE_DECISION_SCHEMA_VERSION;
  reviewId: string;
  reviewHash: Hex;
  decisionHash: Hex;
  projectSlug: string;
  assetId: string;
  outcome: CreatorReleaseOutcome;
  reasonCode: CreatorReleaseReasonCode;
  reviewNote: string;
  reviewerId: string;
  economicsMode: "simulation_only";
  contractExecution: "disabled";
  decidedAt?: unknown;
};

type DecisionHashPayload = Omit<CreatorReleaseDecision, "decisionHash" | "decidedAt">;

export function createCreatorReleaseDecision(input: {
  reviewId: string;
  reviewHash: Hex;
  projectSlug: string;
  assetId: string;
  outcome: CreatorReleaseOutcome;
  reasonCode: CreatorReleaseReasonCode;
  reviewNote: string;
  reviewerId: string;
}): CreatorReleaseDecision {
  const reviewNote = input.reviewNote.trim().slice(0, 1_000);
  if (
    !/^[0-9a-f]{64}$/.test(input.reviewId)
    || input.reviewHash !== `0x${input.reviewId}`
    || normalizeProjectSlug(input.projectSlug) !== input.projectSlug
    || !/^[A-Za-z0-9]{20}$/.test(input.assetId)
    || !CREATOR_RELEASE_OUTCOMES.includes(input.outcome)
    || !CREATOR_RELEASE_REASON_CODES.includes(input.reasonCode)
    || reviewNote.length < 10
    || input.reviewerId.length < 1
    || input.reviewerId.length > 128
  ) throw new Error("The release-review decision is invalid.");
  if (
    (input.outcome === "preparation_ready") !== (input.reasonCode === "preparation_complete")
  ) throw new Error("Preparation-ready decisions require the preparation-complete reason.");
  const payload: DecisionHashPayload = {
    schemaVersion: CREATOR_RELEASE_DECISION_SCHEMA_VERSION,
    reviewId: input.reviewId,
    reviewHash: input.reviewHash,
    projectSlug: input.projectSlug,
    assetId: input.assetId,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    reviewNote,
    reviewerId: input.reviewerId,
    economicsMode: "simulation_only",
    contractExecution: "disabled"
  };
  return {
    ...payload,
    decisionHash: keccak256(toHex(JSON.stringify(payload)))
  };
}

export function parseCreatorReleaseDecision(reviewId: string, value: unknown): CreatorReleaseDecision | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CreatorReleaseDecision;
  try {
    const parsed = createCreatorReleaseDecision(candidate);
    if (
      parsed.reviewId !== reviewId
      || parsed.decisionHash !== candidate.decisionHash
      || candidate.economicsMode !== "simulation_only"
      || candidate.contractExecution !== "disabled"
    ) return null;
    return {
      ...parsed,
      ...(candidate.decidedAt === undefined ? {} : { decidedAt: candidate.decidedAt })
    };
  } catch {
    return null;
  }
}
