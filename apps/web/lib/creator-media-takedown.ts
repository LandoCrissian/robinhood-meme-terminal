import { keccak256, toHex, type Hex } from "viem";

export const CREATOR_MEDIA_TAKEDOWN_REQUEST_SCHEMA_VERSION = 1 as const;
export const CREATOR_MEDIA_TAKEDOWN_DECISION_SCHEMA_VERSION = 1 as const;

export const CREATOR_MEDIA_TAKEDOWN_REASONS = [
  "creator_withdrawal",
  "rights_concern",
  "privacy_or_safety",
  "superseded_cleanup",
  "other"
] as const;

export type CreatorMediaTakedownReason = typeof CREATOR_MEDIA_TAKEDOWN_REASONS[number];

export type CreatorMediaTakedownRequest = {
  schemaVersion: typeof CREATOR_MEDIA_TAKEDOWN_REQUEST_SCHEMA_VERSION;
  requestId: string;
  requestHash: Hex;
  projectSlug: string;
  assetId: string;
  receiptId: string;
  metadataCid: string;
  providerFileId: string;
  reasonCode: CreatorMediaTakedownReason;
  requestNote: string;
  requestedBy: string;
  requestedAction: "unpin_rmt_provider_copy";
  contentErasureGuarantee: "none";
  providerExecution: "disabled";
  createdAt?: unknown;
};

export const CREATOR_MEDIA_TAKEDOWN_OUTCOMES = [
  "approved_for_future_execution",
  "rejected"
] as const;

export type CreatorMediaTakedownOutcome = typeof CREATOR_MEDIA_TAKEDOWN_OUTCOMES[number];

export type CreatorMediaTakedownDecision = {
  schemaVersion: typeof CREATOR_MEDIA_TAKEDOWN_DECISION_SCHEMA_VERSION;
  decisionId: string;
  decisionHash: Hex;
  requestId: string;
  requestHash: Hex;
  projectSlug: string;
  assetId: string;
  receiptId: string;
  outcome: CreatorMediaTakedownOutcome;
  reviewNote: string;
  reviewedBy: string;
  providerExecution: "disabled";
  contentErasureGuarantee: "none";
  decidedAt?: unknown;
};

type RequestPayload = Omit<
  CreatorMediaTakedownRequest,
  "requestId" | "requestHash" | "createdAt"
>;

type DecisionPayload = Omit<
  CreatorMediaTakedownDecision,
  "decisionId" | "decisionHash" | "decidedAt"
>;

function validSlug(value: string) {
  return /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(value);
}

function validUid(value: string) {
  return value.length >= 1 && value.length <= 128;
}

function cleanNote(value: string, minimum: number) {
  const note = value.trim().replace(/\s+/g, " ");
  if (note.length < minimum || note.length > 1_000) {
    throw new Error(`The takedown note must be ${minimum}–1000 characters.`);
  }
  return note;
}

export function createCreatorMediaTakedownRequest(input: {
  projectSlug: string;
  assetId: string;
  receiptId: string;
  metadataCid: string;
  providerFileId: string;
  reasonCode: CreatorMediaTakedownReason;
  requestNote: string;
  requestedBy: string;
}): CreatorMediaTakedownRequest {
  if (
    !validSlug(input.projectSlug)
    || !/^[A-Za-z0-9]{20}$/.test(input.assetId)
    || !/^[0-9a-f]{64}$/.test(input.receiptId)
    || !/^Qm[1-9A-HJ-NP-Za-km-z]{44}$|^b[a-z2-7]{20,}$/.test(input.metadataCid)
    || !/^[A-Za-z0-9-]{8,128}$/.test(input.providerFileId)
    || !CREATOR_MEDIA_TAKEDOWN_REASONS.includes(input.reasonCode)
    || !validUid(input.requestedBy)
  ) throw new Error("The takedown request is invalid.");
  const payload: RequestPayload = {
    schemaVersion: CREATOR_MEDIA_TAKEDOWN_REQUEST_SCHEMA_VERSION,
    projectSlug: input.projectSlug,
    assetId: input.assetId,
    receiptId: input.receiptId,
    metadataCid: input.metadataCid,
    providerFileId: input.providerFileId,
    reasonCode: input.reasonCode,
    requestNote: cleanNote(input.requestNote, 20),
    requestedBy: input.requestedBy,
    requestedAction: "unpin_rmt_provider_copy",
    contentErasureGuarantee: "none",
    providerExecution: "disabled"
  };
  const requestHash = keccak256(toHex(JSON.stringify(payload)));
  return {
    ...payload,
    requestId: input.receiptId,
    requestHash
  };
}

export function parseCreatorMediaTakedownRequest(
  requestId: string,
  value: unknown
): CreatorMediaTakedownRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CreatorMediaTakedownRequest;
  try {
    const parsed = createCreatorMediaTakedownRequest(candidate);
    if (
      candidate.schemaVersion !== CREATOR_MEDIA_TAKEDOWN_REQUEST_SCHEMA_VERSION
      || requestId !== parsed.requestId
      || candidate.requestId !== parsed.requestId
      || candidate.requestHash !== parsed.requestHash
      || candidate.requestedAction !== "unpin_rmt_provider_copy"
      || candidate.contentErasureGuarantee !== "none"
      || candidate.providerExecution !== "disabled"
    ) return null;
    return {
      ...parsed,
      ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt })
    };
  } catch {
    return null;
  }
}

export function createCreatorMediaTakedownDecision(input: {
  request: CreatorMediaTakedownRequest;
  outcome: CreatorMediaTakedownOutcome;
  reviewNote: string;
  reviewedBy: string;
}): CreatorMediaTakedownDecision {
  if (
    !CREATOR_MEDIA_TAKEDOWN_OUTCOMES.includes(input.outcome)
    || !validUid(input.reviewedBy)
  ) throw new Error("The takedown decision is invalid.");
  const payload: DecisionPayload = {
    schemaVersion: CREATOR_MEDIA_TAKEDOWN_DECISION_SCHEMA_VERSION,
    requestId: input.request.requestId,
    requestHash: input.request.requestHash,
    projectSlug: input.request.projectSlug,
    assetId: input.request.assetId,
    receiptId: input.request.receiptId,
    outcome: input.outcome,
    reviewNote: cleanNote(input.reviewNote, 10),
    reviewedBy: input.reviewedBy,
    providerExecution: "disabled",
    contentErasureGuarantee: "none"
  };
  return {
    ...payload,
    decisionId: input.request.requestId,
    decisionHash: keccak256(toHex(JSON.stringify(payload)))
  };
}

export function parseCreatorMediaTakedownDecision(
  decisionId: string,
  value: unknown
): CreatorMediaTakedownDecision | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as CreatorMediaTakedownDecision;
  try {
    if (
      candidate.schemaVersion !== CREATOR_MEDIA_TAKEDOWN_DECISION_SCHEMA_VERSION
      || decisionId !== candidate.decisionId
      || candidate.decisionId !== candidate.requestId
      || !/^[0-9a-f]{64}$/.test(candidate.requestId)
      || !/^0x[0-9a-f]{64}$/.test(candidate.requestHash)
      || !validSlug(candidate.projectSlug)
      || !/^[A-Za-z0-9]{20}$/.test(candidate.assetId)
      || candidate.receiptId !== candidate.requestId
      || !CREATOR_MEDIA_TAKEDOWN_OUTCOMES.includes(candidate.outcome)
      || !validUid(candidate.reviewedBy)
      || candidate.providerExecution !== "disabled"
      || candidate.contentErasureGuarantee !== "none"
      || parsedDecisionHash(candidate) !== candidate.decisionHash
    ) return null;
    return {
      ...candidate,
      reviewNote: cleanNote(candidate.reviewNote, 10)
    };
  } catch {
    return null;
  }
}

function parsedDecisionHash(candidate: CreatorMediaTakedownDecision) {
  const payload: DecisionPayload = {
    schemaVersion: CREATOR_MEDIA_TAKEDOWN_DECISION_SCHEMA_VERSION,
    requestId: candidate.requestId,
    requestHash: candidate.requestHash,
    projectSlug: candidate.projectSlug,
    assetId: candidate.assetId,
    receiptId: candidate.receiptId,
    outcome: candidate.outcome,
    reviewNote: candidate.reviewNote.trim().replace(/\s+/g, " "),
    reviewedBy: candidate.reviewedBy,
    providerExecution: "disabled",
    contentErasureGuarantee: "none"
  };
  return keccak256(toHex(JSON.stringify(payload)));
}
