import {
  validateCreatorConsentWithdrawal,
  verifyCreatorConsentWithdrawal,
  type CreatorConsentInvitationRecord,
  type CreatorConsentPublicStatus,
  type CreatorConsentWithdrawal
} from "../creator-consent";

export type CreatorConsentWithdrawalFailureCode =
  | "invalid"
  | "missing"
  | "not_accepted"
  | "wrong_signer"
  | "conflict";

export class CreatorConsentWithdrawalError extends Error {
  constructor(
    public readonly code: CreatorConsentWithdrawalFailureCode,
    message: string
  ) {
    super(message);
  }
}

export type CreatorConsentWithdrawalResult = {
  status: "withdrawn";
  idempotent: boolean;
};

export async function evaluateCreatorConsentWithdrawal({
  invitation,
  nowSeconds,
  publicStatus,
  withdrawal
}: {
  invitation: CreatorConsentInvitationRecord | null;
  nowSeconds: number;
  publicStatus: CreatorConsentPublicStatus | null;
  withdrawal: CreatorConsentWithdrawal;
}): Promise<CreatorConsentWithdrawalResult> {
  if (!invitation || !publicStatus) {
    throw new CreatorConsentWithdrawalError("missing", "The consent invitation is unavailable.");
  }
  if (
    publicStatus.invitationDigest !== invitation.invitationDigest
    || publicStatus.projectSlug !== invitation.projectSlug
    || publicStatus.assetId !== invitation.assetId
    || publicStatus.expiresAt !== invitation.expiresAt
  ) {
    throw new CreatorConsentWithdrawalError(
      "invalid",
      "The public invitation status does not match the private invitation."
    );
  }
  if (invitation.status === "withdrawn") {
    if (publicStatus.status !== "withdrawn") {
      throw new CreatorConsentWithdrawalError(
        "invalid",
        "The public and private withdrawal states do not match."
      );
    }
    const sameWithdrawal = invitation.withdrawalSignature?.toLowerCase() === withdrawal.signature.toLowerCase()
      && invitation.withdrawalSignedAt === withdrawal.withdrawnAt
      && withdrawal.collaboratorWallet === invitation.collaboratorWallet;
    if (!sameWithdrawal) {
      throw new CreatorConsentWithdrawalError(
        "conflict",
        "This invitation already has a different final withdrawal."
      );
    }
    return { status: "withdrawn", idempotent: true };
  }
  if (invitation.status !== "accepted" || publicStatus.status !== "accepted") {
    throw new CreatorConsentWithdrawalError(
      "not_accepted",
      "Only a recorded acceptance can be withdrawn."
    );
  }
  if (
    invitation.responseAction !== "accept"
    || !invitation.responseSignature
    || !invitation.respondedAt
    || invitation.signerWallet !== invitation.collaboratorWallet
    || invitation.receivedAt == null
  ) {
    throw new CreatorConsentWithdrawalError(
      "invalid",
      "The accepted consent receipt is incomplete."
    );
  }
  const validationError = validateCreatorConsentWithdrawal(invitation, withdrawal);
  if (validationError) {
    throw new CreatorConsentWithdrawalError("invalid", validationError);
  }
  if (withdrawal.withdrawnAt < invitation.respondedAt) {
    throw new CreatorConsentWithdrawalError(
      "invalid",
      "The withdrawal predates the recorded acceptance."
    );
  }
  if (withdrawal.withdrawnAt > nowSeconds + 5 * 60) {
    throw new CreatorConsentWithdrawalError(
      "invalid",
      "The signed withdrawal time is too far in the future."
    );
  }
  if (!await verifyCreatorConsentWithdrawal(invitation, withdrawal)) {
    throw new CreatorConsentWithdrawalError(
      "wrong_signer",
      "The withdrawal signature does not belong to the invited collaborator wallet."
    );
  }
  return { status: "withdrawn", idempotent: false };
}
