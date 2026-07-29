import {
  validateCreatorConsentResponse,
  verifyCreatorConsentResponse,
  type CreatorConsentInvitationRecord,
  type CreatorConsentPublicStatus,
  type CreatorConsentResponse
} from "../creator-consent";
import type { CreatorAsset } from "../creator-assets";

export type CreatorConsentReceiptFailureCode =
  | "invalid"
  | "missing"
  | "revoked"
  | "expired"
  | "stale_revision"
  | "wrong_signer"
  | "conflict";

export class CreatorConsentReceiptError extends Error {
  constructor(
    public readonly code: CreatorConsentReceiptFailureCode,
    message: string
  ) {
    super(message);
  }
}

export type CreatorConsentReceiptResult = {
  status: "accepted" | "rejected";
  action: "accept" | "reject";
  idempotent: boolean;
};

export async function evaluateCreatorConsentReceipt({
  asset,
  invitation,
  nowSeconds,
  publicStatus,
  response
}: {
  asset: CreatorAsset | null;
  invitation: CreatorConsentInvitationRecord | null;
  nowSeconds: number;
  publicStatus: CreatorConsentPublicStatus | null;
  response: CreatorConsentResponse;
}): Promise<CreatorConsentReceiptResult> {
  if (!invitation || !publicStatus || !asset) {
    throw new CreatorConsentReceiptError("missing", "The consent invitation is unavailable.");
  }
  if (
    publicStatus.invitationDigest !== invitation.invitationDigest
    || publicStatus.projectSlug !== invitation.projectSlug
    || publicStatus.assetId !== invitation.assetId
    || publicStatus.expiresAt !== invitation.expiresAt
  ) throw new CreatorConsentReceiptError("invalid", "The public invitation status does not match the private invitation.");

  if (invitation.status === "accepted" || invitation.status === "rejected") {
    if (publicStatus.status !== invitation.status) {
      throw new CreatorConsentReceiptError("invalid", "The public and private final consent states do not match.");
    }
    const sameResponse = invitation.responseAction === response.action
      && invitation.responseSignature?.toLowerCase() === response.signature.toLowerCase()
      && invitation.respondedAt === response.respondedAt
      && invitation.signerWallet === response.collaboratorWallet;
    if (!sameResponse) {
      throw new CreatorConsentReceiptError("conflict", "This invitation already has a different final response.");
    }
    return {
      status: invitation.status,
      action: response.action,
      idempotent: true
    };
  }
  if (invitation.status === "revoked" || publicStatus.status === "revoked") {
    throw new CreatorConsentReceiptError("revoked", "The creator revoked this consent invitation.");
  }
  if (invitation.status !== "pending" || publicStatus.status !== "pending") {
    throw new CreatorConsentReceiptError("invalid", "The consent invitation is not pending.");
  }
  if (invitation.expiresAt <= nowSeconds || publicStatus.expiresAt <= nowSeconds) {
    throw new CreatorConsentReceiptError("expired", "The consent invitation expired before RMT received the response.");
  }
  if (asset.draftRevisionHash !== invitation.draftRevisionHash) {
    throw new CreatorConsentReceiptError("stale_revision", "The creator asset changed after this invitation was prepared.");
  }
  const responseError = validateCreatorConsentResponse(invitation, response);
  if (responseError) throw new CreatorConsentReceiptError("invalid", responseError);
  if (response.respondedAt > nowSeconds + 5 * 60) {
    throw new CreatorConsentReceiptError("invalid", "The signed response time is too far in the future.");
  }
  if (!await verifyCreatorConsentResponse(invitation, response)) {
    throw new CreatorConsentReceiptError("wrong_signer", "The signature does not belong to the invited collaborator wallet.");
  }
  return {
    status: response.action === "accept" ? "accepted" : "rejected",
    action: response.action,
    idempotent: false
  };
}
