import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import {
  hashCreatorAssetDraft,
  normalizeCreatorAsset,
  validateCreatorAsset,
  type AssetRevenueSplit,
  type CreatorAsset,
  type CreatorAssetDraft
} from "./creator-assets";
import type { CreatorConsentInvitationRecord } from "./creator-consent";
import { normalizeProjectSlug } from "./creator-application";
import {
  createMarketplaceEconomicsPolicy,
  type MarketplaceEconomicsPolicy
} from "./creator-economics";

export const CREATOR_RELEASE_REVIEW_SCHEMA_VERSION = 1 as const;

export type AcceptedConsentManifestItem = {
  invitationDigest: Hex;
  collaboratorName: string;
  collaboratorRole: CreatorConsentInvitationRecord["collaboratorRole"];
  collaboratorWallet: Address;
  shareBps: number;
  respondedAt: number;
  responseSignature: Hex;
};

export type CreatorReleaseReview = {
  schemaVersion: typeof CREATOR_RELEASE_REVIEW_SCHEMA_VERSION;
  reviewId: string;
  reviewHash: Hex;
  projectSlug: string;
  assetId: string;
  draftRevisionHash: Hex;
  preparedBy: string;
  assetSnapshot: CreatorAssetDraft;
  acceptedConsentManifest: AcceptedConsentManifestItem[];
  payoutManifest: AssetRevenueSplit[];
  economicsPolicy: MarketplaceEconomicsPolicy;
  economicsMode: "simulation_only";
  contractExecution: "disabled";
  status: "prepared";
  createdAt?: unknown;
};

type ReviewHashPayload = Omit<CreatorReleaseReview, "reviewId" | "reviewHash" | "createdAt">;

function consentForCollaborator(
  asset: CreatorAsset,
  records: CreatorConsentInvitationRecord[],
  collaborator: CreatorAssetDraft["collaborators"][number]
) {
  const wallet = collaborator.walletAddress.toLowerCase();
  const shareBps = asset.revenueSplits.find(
    (split) => split.walletAddress.toLowerCase() === wallet
  )?.shareBps ?? 0;
  return records.find((record) => (
    record.status === "accepted"
    && record.draftRevisionHash === asset.draftRevisionHash
    && record.collaboratorName === collaborator.name
    && record.collaboratorRole === collaborator.role
    && record.collaboratorWallet === wallet
    && record.shareBps === shareBps
    && record.responseAction === "accept"
    && record.signerWallet === wallet
    && record.responseSignature
    && record.respondedAt
  ));
}

export function buildCreatorReleaseReviewPayload({
  asset,
  consentRecords,
  economicsPolicy,
  preparedBy
}: {
  asset: CreatorAsset;
  consentRecords: CreatorConsentInvitationRecord[];
  economicsPolicy: MarketplaceEconomicsPolicy;
  preparedBy: string;
}): ReviewHashPayload {
  if (validateCreatorAsset(asset)) throw new Error("The creator asset is invalid.");
  if (
    normalizeProjectSlug(asset.projectSlug) !== asset.projectSlug
    || !/^[A-Za-z0-9]{20}$/.test(asset.assetId)
  ) throw new Error("The creator asset identity is invalid.");
  if (hashCreatorAssetDraft(asset) !== asset.draftRevisionHash) {
    throw new Error("The creator asset revision fingerprint is invalid.");
  }
  if (preparedBy.length < 1 || preparedBy.length > 128) throw new Error("The release-review owner is invalid.");
  const policy = createMarketplaceEconomicsPolicy(economicsPolicy);
  if (policy.policyHash !== economicsPolicy.policyHash) throw new Error("The economics policy fingerprint is invalid.");

  const acceptedConsentManifest = asset.collaborators.map((collaborator) => {
    const receipt = consentForCollaborator(asset, consentRecords, collaborator);
    if (!receipt || !receipt.responseSignature || !receipt.respondedAt) {
      throw new Error(`Accepted consent is missing for ${collaborator.name}.`);
    }
    if (
      !/^0x[0-9a-f]{64}$/.test(receipt.invitationDigest)
      || !/^0x[0-9a-fA-F]{130}$/.test(receipt.responseSignature)
      || !isAddress(receipt.collaboratorWallet, { strict: false })
      || !Number.isSafeInteger(receipt.respondedAt)
      || receipt.respondedAt < 1
    ) throw new Error(`Accepted consent is invalid for ${collaborator.name}.`);
    return {
      invitationDigest: receipt.invitationDigest,
      collaboratorName: receipt.collaboratorName,
      collaboratorRole: receipt.collaboratorRole,
      collaboratorWallet: receipt.collaboratorWallet,
      shareBps: receipt.shareBps,
      respondedAt: receipt.respondedAt,
      responseSignature: receipt.responseSignature
    };
  }).sort((left, right) => left.invitationDigest.localeCompare(right.invitationDigest));
  if (new Set(acceptedConsentManifest.map((receipt) => receipt.invitationDigest)).size !== acceptedConsentManifest.length) {
    throw new Error("Each collaborator requires a distinct accepted consent receipt.");
  }

  return {
    schemaVersion: CREATOR_RELEASE_REVIEW_SCHEMA_VERSION,
    projectSlug: asset.projectSlug,
    assetId: asset.assetId,
    draftRevisionHash: asset.draftRevisionHash,
    preparedBy,
    assetSnapshot: normalizeCreatorAsset(asset),
    acceptedConsentManifest,
    payoutManifest: normalizeCreatorAsset(asset).revenueSplits,
    economicsPolicy: policy,
    economicsMode: "simulation_only",
    contractExecution: "disabled",
    status: "prepared"
  };
}

export function hashCreatorReleaseReviewPayload(payload: ReviewHashPayload): Hex {
  return keccak256(toHex(JSON.stringify(payload)));
}

export function createCreatorReleaseReview(
  input: Parameters<typeof buildCreatorReleaseReviewPayload>[0]
): CreatorReleaseReview {
  const payload = buildCreatorReleaseReviewPayload(input);
  const reviewHash = hashCreatorReleaseReviewPayload(payload);
  return {
    ...payload,
    reviewId: reviewHash.slice(2),
    reviewHash
  };
}

export function parseCreatorReleaseReview(reviewId: string, value: unknown): CreatorReleaseReview | null {
  if (!value || typeof value !== "object" || !/^[0-9a-f]{64}$/.test(reviewId)) return null;
  const candidate = value as CreatorReleaseReview;
  try {
    const asset = {
      ...normalizeCreatorAsset(candidate.assetSnapshot),
      schemaVersion: 1 as const,
      assetId: candidate.assetId,
      projectSlug: candidate.projectSlug,
      collaboratorConsentStatus: "unverified" as const,
      revenueSplitTotalBps: candidate.assetSnapshot.revenueSplits.reduce((total, split) => total + split.shareBps, 0),
      draftRevisionHash: candidate.draftRevisionHash,
      status: "draft" as const
    };
    const consentRecords = candidate.acceptedConsentManifest.map((item) => ({
      ...item,
      schemaVersion: 1 as const,
      invitationId: item.invitationDigest.slice(2),
      projectSlug: candidate.projectSlug,
      assetId: candidate.assetId,
      draftRevisionHash: candidate.draftRevisionHash,
      chainId: 1,
      expiresAt: 1,
      termsHash: `0x${"0".repeat(64)}` as Hex,
      nonce: `0x${"0".repeat(64)}` as Hex,
      status: "accepted" as const,
      revokedAt: null,
      responseAction: "accept" as const,
      signerWallet: item.collaboratorWallet,
      receivedAt: {},
      createdAt: null,
      updatedAt: null
    }));
    const payload = buildCreatorReleaseReviewPayload({
      asset,
      consentRecords,
      economicsPolicy: candidate.economicsPolicy,
      preparedBy: candidate.preparedBy
    });
    const reviewHash = hashCreatorReleaseReviewPayload(payload);
    const candidatePayload: ReviewHashPayload = {
      schemaVersion: candidate.schemaVersion,
      projectSlug: candidate.projectSlug,
      assetId: candidate.assetId,
      draftRevisionHash: candidate.draftRevisionHash,
      preparedBy: candidate.preparedBy,
      assetSnapshot: candidate.assetSnapshot,
      acceptedConsentManifest: candidate.acceptedConsentManifest,
      payoutManifest: candidate.payoutManifest,
      economicsPolicy: candidate.economicsPolicy,
      economicsMode: candidate.economicsMode,
      contractExecution: candidate.contractExecution,
      status: candidate.status
    };
    if (
      candidate.schemaVersion !== CREATOR_RELEASE_REVIEW_SCHEMA_VERSION
      || candidate.reviewId !== reviewId
      || candidate.reviewHash !== `0x${reviewId}`
      || reviewHash !== candidate.reviewHash
      || hashCreatorReleaseReviewPayload(candidatePayload) !== candidate.reviewHash
      || candidate.economicsMode !== "simulation_only"
      || candidate.contractExecution !== "disabled"
      || candidate.status !== "prepared"
    ) return null;
    return {
      ...payload,
      reviewId,
      reviewHash,
      ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt })
    };
  } catch {
    return null;
  }
}
