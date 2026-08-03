import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
  type Address,
  type Hex
} from "viem";
import {
  parseCreatorMediaAvailabilityStatus,
  type CreatorMediaAvailabilityStatus
} from "./creator-media-availability";
import {
  parseCreatorMediaReceipt,
  receiptHasVerifiedRetrieval
} from "./creator-media-receipt";
import {
  parseCreatorReleaseReview,
  type CreatorReleaseReview
} from "./creator-release-review";
import {
  parseCreatorReleaseDecision,
  type CreatorReleaseDecision
} from "./creator-release-decision";

export const CREATOR_RELEASE_FREEZE_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const MAXIMUM_FREEZE_OBSERVATION_AGE_SECONDS = 24 * 60 * 60;
export const MAXIMUM_FREEZE_EVIDENCE_LIFETIME_SECONDS = 2 * 24 * 60 * 60;

export type CreatorReleaseFreezeEvidence = {
  receiptHash: Hex;
  availabilityObservationHash: Hex;
  observedAt: number;
  validUntil: number;
  signerEpoch: number;
};

export type CreatorReleaseFreezeEvidenceMessage = CreatorReleaseFreezeEvidence & {
  releaseRegistry: Address;
  releaseId: Hex;
  creator: Address;
  metadataHash: Hex;
  mediaManifestHash: Hex;
};

const mediaEvidenceTypes = {
  RMTV7MediaEvidence: [
    { name: "releaseRegistry", type: "address" },
    { name: "releaseId", type: "bytes32" },
    { name: "creator", type: "address" },
    { name: "metadataHash", type: "bytes32" },
    { name: "mediaManifestHash", type: "bytes32" },
    { name: "receiptHash", type: "bytes32" },
    { name: "availabilityObservationHash", type: "bytes32" },
    { name: "observedAt", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "signerEpoch", type: "uint64" }
  ]
} as const;

function cleanBytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be a 32-byte hash.`);
  }
  return value.toLowerCase() as Hex;
}

function cleanAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be an EVM address.`);
  }
  return getAddress(value);
}

export function creatorReleaseFreezeEvidenceTypedData(input: {
  chainId: number;
  verifier: Address;
  message: CreatorReleaseFreezeEvidenceMessage;
}) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) {
    throw new Error("The evidence chain is invalid.");
  }
  return {
    domain: {
      name: "RMT V7 Media Evidence",
      version: "1",
      chainId: input.chainId,
      verifyingContract: cleanAddress(input.verifier, "Evidence verifier")
    },
    types: mediaEvidenceTypes,
    primaryType: "RMTV7MediaEvidence" as const,
    message: {
      releaseRegistry: cleanAddress(input.message.releaseRegistry, "Release registry"),
      releaseId: cleanBytes32(input.message.releaseId, "Release ID"),
      creator: cleanAddress(input.message.creator, "Release creator"),
      metadataHash: cleanBytes32(input.message.metadataHash, "Metadata hash"),
      mediaManifestHash: cleanBytes32(input.message.mediaManifestHash, "Media manifest hash"),
      receiptHash: cleanBytes32(input.message.receiptHash, "Media receipt hash"),
      availabilityObservationHash: cleanBytes32(
        input.message.availabilityObservationHash,
        "Availability observation hash"
      ),
      observedAt: BigInt(input.message.observedAt),
      validUntil: BigInt(input.message.validUntil),
      signerEpoch: BigInt(input.message.signerEpoch)
    }
  };
}

export function hashCreatorReleaseFreezeEvidence(
  evidence: CreatorReleaseFreezeEvidence
): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint64" }
    ],
    [
      cleanBytes32(evidence.receiptHash, "Media receipt hash"),
      cleanBytes32(evidence.availabilityObservationHash, "Availability observation hash"),
      BigInt(evidence.observedAt),
      BigInt(evidence.validUntil),
      BigInt(evidence.signerEpoch)
    ]
  ));
}

export function createCreatorReleaseFreezeEvidence(input: {
  review: CreatorReleaseReview;
  decision: CreatorReleaseDecision;
  availability: CreatorMediaAvailabilityStatus;
  chainId: number;
  verifier: Address;
  releaseRegistry: Address;
  releaseId: Hex;
  creator: Address;
  signerEpoch: number;
  validUntil: number;
  nowSeconds?: number;
}) {
  const review = parseCreatorReleaseReview(input.review.reviewId, input.review);
  if (!review || review.schemaVersion !== 3 || !review.mediaReceipt) {
    throw new Error("A current, verified release review is required.");
  }
  const decision = parseCreatorReleaseDecision(review.reviewId, input.decision);
  if (
    !decision
    || decision.reviewHash !== review.reviewHash
    || decision.projectSlug !== review.projectSlug
    || decision.assetId !== review.assetId
    || decision.outcome !== "preparation_ready"
    || decision.reasonCode !== "preparation_complete"
  ) throw new Error("A preparation-ready decision for the exact release review is required.");
  const receipt = parseCreatorMediaReceipt(review.mediaReceipt.receiptId, review.mediaReceipt);
  if (!receipt || !receiptHasVerifiedRetrieval(receipt)) {
    throw new Error("The release review does not contain verified retrieval evidence.");
  }
  const availability = parseCreatorMediaAvailabilityStatus(receipt.receiptId, input.availability);
  if (
    !availability
    || availability.projectSlug !== review.projectSlug
    || availability.assetId !== review.assetId
    || availability.metadataCid !== receipt.metadataCid
  ) throw new Error("Availability evidence does not match the reviewed media receipt.");
  if (
    availability.overallState !== "healthy"
    || availability.providerState !== "verified"
    || availability.gatewayState !== "available"
    || availability.checksPassed !== availability.checksAttempted
    || availability.failureCode !== ""
    || availability.consecutiveFailures !== 0
    || availability.lastHealthyAtMs !== availability.observedAtMs
  ) throw new Error("Media evidence must be healthy before a release freeze.");

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const observedAt = Math.floor(availability.observedAtMs / 1_000);
  if (
    !Number.isSafeInteger(nowSeconds)
    || observedAt > nowSeconds
    || nowSeconds - observedAt > MAXIMUM_FREEZE_OBSERVATION_AGE_SECONDS
  ) throw new Error("The media-availability observation is not current.");
  if (
    !Number.isSafeInteger(input.validUntil)
    || input.validUntil <= nowSeconds
    || input.validUntil <= observedAt
    || input.validUntil - observedAt > MAXIMUM_FREEZE_EVIDENCE_LIFETIME_SECONDS
  ) throw new Error("The media-evidence validity window is invalid.");
  if (
    !Number.isSafeInteger(input.signerEpoch)
    || input.signerEpoch < 1
    || input.signerEpoch > Number.MAX_SAFE_INTEGER
  ) throw new Error("The evidence signer epoch is invalid.");

  const evidence: CreatorReleaseFreezeEvidence = {
    receiptHash: `0x${receipt.receiptId}`,
    availabilityObservationHash: availability.observationHash,
    observedAt,
    validUntil: input.validUntil,
    signerEpoch: input.signerEpoch
  };
  const message: CreatorReleaseFreezeEvidenceMessage = {
    releaseRegistry: cleanAddress(input.releaseRegistry, "Release registry"),
    releaseId: cleanBytes32(input.releaseId, "Release ID"),
    creator: cleanAddress(input.creator, "Release creator"),
    metadataHash: receipt.metadataHash,
    mediaManifestHash: receipt.manifestHash,
    ...evidence
  };
  const typedData = creatorReleaseFreezeEvidenceTypedData({
    chainId: input.chainId,
    verifier: input.verifier,
    message
  });
  const evidenceHash = hashCreatorReleaseFreezeEvidence(evidence);
  return {
    schemaVersion: CREATOR_RELEASE_FREEZE_EVIDENCE_SCHEMA_VERSION,
    evidence,
    message,
    evidenceHash,
    digest: hashTypedData(typedData),
    typedData,
    contractExecution: "disabled" as const
  };
}
