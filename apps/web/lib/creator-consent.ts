import {
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex
} from "viem";
import {
  COLLABORATOR_ROLES,
  type CollaboratorRole
} from "./creator-assets";
import { normalizeProjectSlug } from "./creator-application";

export const CREATOR_CONSENT_SCHEMA_VERSION = 1 as const;
export const CREATOR_CONSENT_DOMAIN_SALT = keccak256(toHex("rmt:creator-consent:v1"));
export const MAX_CREATOR_CONSENT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const CREATOR_CONSENT_TERMS = "I confirm the displayed credit, role, wallet, proposed revenue share, rights revision, chain, and expiration. This signature does not mint, list, transfer, license, or guarantee payment.";
export const CREATOR_CONSENT_TERMS_HASH = keccak256(toHex(CREATOR_CONSENT_TERMS));
export const CREATOR_CONSENT_WITHDRAWAL_TERMS = "I withdraw my previously recorded acceptance for this exact RMT collaborator invitation. This withdrawal does not move funds and remains subject to any future release-freeze state shown before signing.";
export const CREATOR_CONSENT_WITHDRAWAL_TERMS_HASH = keccak256(toHex(CREATOR_CONSENT_WITHDRAWAL_TERMS));

export type CreatorConsentInvitation = {
  schemaVersion: typeof CREATOR_CONSENT_SCHEMA_VERSION;
  projectSlug: string;
  assetId: string;
  draftRevisionHash: Hex;
  collaboratorName: string;
  collaboratorRole: CollaboratorRole;
  collaboratorWallet: Address;
  shareBps: number;
  chainId: number;
  expiresAt: number;
  termsHash: Hex;
  nonce: Hex;
};

export type CreatorConsentAction = "accept" | "reject";

export type CreatorConsentResponse = {
  schemaVersion: typeof CREATOR_CONSENT_SCHEMA_VERSION;
  invitationDigest: Hex;
  action: CreatorConsentAction;
  collaboratorWallet: Address;
  respondedAt: number;
  signature: Hex;
};

export type CreatorConsentWithdrawal = {
  schemaVersion: typeof CREATOR_CONSENT_SCHEMA_VERSION;
  invitationDigest: Hex;
  collaboratorWallet: Address;
  withdrawnAt: number;
  termsHash: Hex;
  signature: Hex;
};

export type CreatorConsentInvitationPacket = {
  kind: "rmt_creator_consent_invitation";
  invitation: CreatorConsentInvitation;
  invitationDigest: Hex;
};

export type CreatorConsentResponsePacket = {
  kind: "rmt_creator_consent_response";
  response: CreatorConsentResponse;
};

export type CreatorConsentWithdrawalPacket = {
  kind: "rmt_creator_consent_withdrawal";
  withdrawal: CreatorConsentWithdrawal;
};

export type CreatorConsentInvitationRecord = CreatorConsentInvitation & {
  invitationId: string;
  invitationDigest: Hex;
  status: "pending" | "revoked" | "accepted" | "rejected" | "withdrawn";
  revokedAt: unknown | null;
  responseAction: CreatorConsentAction | null;
  responseSignature: Hex | null;
  respondedAt: number | null;
  signerWallet: Address | null;
  receivedAt: unknown | null;
  withdrawalSignature: Hex | null;
  withdrawalSignedAt: number | null;
  withdrawalReceivedAt: unknown | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CreatorConsentPublicStatus = {
  schemaVersion: typeof CREATOR_CONSENT_SCHEMA_VERSION;
  invitationId: string;
  invitationDigest: Hex;
  projectSlug: string;
  assetId: string;
  status: "pending" | "revoked" | "accepted" | "rejected" | "withdrawn";
  expiresAt: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanHash(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase() as Hex
    : null;
}

export function normalizeCreatorConsentInvitation(value: unknown): CreatorConsentInvitation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CreatorConsentInvitation>;
  const projectSlug = normalizeProjectSlug(candidate.projectSlug);
  const draftRevisionHash = cleanHash(candidate.draftRevisionHash);
  const termsHash = cleanHash(candidate.termsHash);
  const nonce = cleanHash(candidate.nonce);
  const collaboratorWallet = typeof candidate.collaboratorWallet === "string"
    ? candidate.collaboratorWallet
    : "";
  if (
    !projectSlug
    || typeof candidate.assetId !== "string"
    || !/^[A-Za-z0-9]{20}$/.test(candidate.assetId)
    || !draftRevisionHash
    || !termsHash
    || !nonce
    || !isAddress(collaboratorWallet, { strict: false })
  ) return null;
  return {
    schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
    projectSlug,
    assetId: candidate.assetId,
    draftRevisionHash,
    collaboratorName: cleanText(candidate.collaboratorName, 60),
    collaboratorRole: COLLABORATOR_ROLES.includes(candidate.collaboratorRole as CollaboratorRole)
      ? candidate.collaboratorRole as CollaboratorRole
      : "other",
    collaboratorWallet: getAddress(collaboratorWallet).toLowerCase() as Address,
    shareBps: Number.isInteger(candidate.shareBps) ? Number(candidate.shareBps) : -1,
    chainId: Number.isSafeInteger(candidate.chainId) ? Number(candidate.chainId) : 0,
    expiresAt: Number.isSafeInteger(candidate.expiresAt) ? Number(candidate.expiresAt) : 0,
    termsHash,
    nonce
  };
}

export function validateCreatorConsentInvitation(
  value: CreatorConsentInvitation,
  nowSeconds = Math.floor(Date.now() / 1_000)
) {
  const invitation = normalizeCreatorConsentInvitation(value);
  if (!invitation) return "Consent invitation fields are invalid.";
  if (invitation.collaboratorName.length < 2) return "Collaborator name must be at least 2 characters.";
  if (invitation.shareBps < 0 || invitation.shareBps > 10_000) return "Collaborator share must be between 0% and 100%.";
  if (invitation.chainId < 1) return "Consent must bind to a specific chain.";
  if (invitation.expiresAt <= nowSeconds) return "Consent invitation has expired.";
  if (invitation.expiresAt > nowSeconds + MAX_CREATOR_CONSENT_LIFETIME_SECONDS) {
    return "Consent invitation cannot remain open longer than 30 days.";
  }
  return null;
}

const creatorConsentTypes = {
  CreatorConsent: [
    { name: "schemaVersion", type: "uint256" },
    { name: "projectSlug", type: "string" },
    { name: "assetId", type: "string" },
    { name: "draftRevisionHash", type: "bytes32" },
    { name: "collaboratorName", type: "string" },
    { name: "collaboratorRole", type: "string" },
    { name: "collaboratorWallet", type: "address" },
    { name: "shareBps", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" }
  ]
} as const;

const creatorConsentResponseTypes = {
  CreatorConsentResponse: [
    { name: "schemaVersion", type: "uint256" },
    { name: "invitationDigest", type: "bytes32" },
    { name: "action", type: "string" },
    { name: "collaboratorWallet", type: "address" },
    { name: "respondedAt", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
} as const;

const creatorConsentWithdrawalTypes = {
  CreatorConsentWithdrawal: [
    { name: "schemaVersion", type: "uint256" },
    { name: "invitationDigest", type: "bytes32" },
    { name: "collaboratorWallet", type: "address" },
    { name: "withdrawnAt", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" }
  ]
} as const;

export function creatorConsentTypedData(invitation: CreatorConsentInvitation) {
  return {
    domain: {
      name: "RMT Creator Consent",
      version: "1",
      chainId: invitation.chainId,
      salt: CREATOR_CONSENT_DOMAIN_SALT
    },
    types: creatorConsentTypes,
    primaryType: "CreatorConsent" as const,
    message: {
      schemaVersion: BigInt(invitation.schemaVersion),
      projectSlug: invitation.projectSlug,
      assetId: invitation.assetId,
      draftRevisionHash: invitation.draftRevisionHash,
      collaboratorName: invitation.collaboratorName,
      collaboratorRole: invitation.collaboratorRole,
      collaboratorWallet: invitation.collaboratorWallet,
      shareBps: BigInt(invitation.shareBps),
      expiresAt: BigInt(invitation.expiresAt),
      termsHash: invitation.termsHash,
      nonce: invitation.nonce
    }
  };
}

export function hashCreatorConsentInvitation(invitation: CreatorConsentInvitation): Hex {
  const validationError = validateCreatorConsentInvitation(invitation, invitation.expiresAt - 1);
  if (validationError) throw new Error(validationError);
  return hashTypedData(creatorConsentTypedData(invitation));
}

export function creatorConsentResponseTypedData(
  invitation: CreatorConsentInvitation,
  action: CreatorConsentAction,
  respondedAt: number
) {
  return {
    domain: {
      name: "RMT Creator Consent",
      version: "1",
      chainId: invitation.chainId,
      salt: CREATOR_CONSENT_DOMAIN_SALT
    },
    types: creatorConsentResponseTypes,
    primaryType: "CreatorConsentResponse" as const,
    message: {
      schemaVersion: BigInt(CREATOR_CONSENT_SCHEMA_VERSION),
      invitationDigest: hashCreatorConsentInvitation(invitation),
      action,
      collaboratorWallet: invitation.collaboratorWallet,
      respondedAt: BigInt(respondedAt),
      nonce: invitation.nonce
    }
  };
}

export function validateCreatorConsentResponse(
  invitation: CreatorConsentInvitation,
  response: CreatorConsentResponse
) {
  const invitationDigest = hashCreatorConsentInvitation(invitation);
  if (response.schemaVersion !== CREATOR_CONSENT_SCHEMA_VERSION) return "Consent response version is unsupported.";
  if (response.invitationDigest !== invitationDigest) return "Consent response belongs to a different invitation.";
  if (response.action !== "accept" && response.action !== "reject") return "Consent response action is invalid.";
  if (
    !isAddress(response.collaboratorWallet, { strict: false })
    || getAddress(response.collaboratorWallet).toLowerCase() !== invitation.collaboratorWallet
  ) return "Consent response wallet does not match the invited collaborator.";
  if (!Number.isSafeInteger(response.respondedAt) || response.respondedAt < 1) {
    return "Consent response time is invalid.";
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(response.signature)) return "Consent response signature is invalid.";
  return null;
}

export async function recoverCreatorConsentResponseSigner(
  invitation: CreatorConsentInvitation,
  response: CreatorConsentResponse
) {
  const validationError = validateCreatorConsentResponse(invitation, response);
  if (validationError) throw new Error(validationError);
  return (await recoverTypedDataAddress({
    ...creatorConsentResponseTypedData(invitation, response.action, response.respondedAt),
    signature: response.signature
  })).toLowerCase() as Address;
}

export async function verifyCreatorConsentResponse(
  invitation: CreatorConsentInvitation,
  response: CreatorConsentResponse
) {
  return (await recoverCreatorConsentResponseSigner(invitation, response)) === invitation.collaboratorWallet;
}

export function creatorConsentWithdrawalTypedData(
  invitation: CreatorConsentInvitation,
  withdrawnAt: number
) {
  return {
    domain: {
      name: "RMT Creator Consent",
      version: "1",
      chainId: invitation.chainId,
      salt: CREATOR_CONSENT_DOMAIN_SALT
    },
    types: creatorConsentWithdrawalTypes,
    primaryType: "CreatorConsentWithdrawal" as const,
    message: {
      schemaVersion: BigInt(CREATOR_CONSENT_SCHEMA_VERSION),
      invitationDigest: hashCreatorConsentInvitation(invitation),
      collaboratorWallet: invitation.collaboratorWallet,
      withdrawnAt: BigInt(withdrawnAt),
      termsHash: CREATOR_CONSENT_WITHDRAWAL_TERMS_HASH,
      nonce: invitation.nonce
    }
  };
}

export function validateCreatorConsentWithdrawal(
  invitation: CreatorConsentInvitation,
  withdrawal: CreatorConsentWithdrawal
) {
  if (withdrawal.schemaVersion !== CREATOR_CONSENT_SCHEMA_VERSION) return "Consent withdrawal version is unsupported.";
  if (withdrawal.invitationDigest !== hashCreatorConsentInvitation(invitation)) {
    return "Consent withdrawal belongs to a different invitation.";
  }
  if (
    !isAddress(withdrawal.collaboratorWallet, { strict: false })
    || getAddress(withdrawal.collaboratorWallet).toLowerCase() !== invitation.collaboratorWallet
  ) return "Consent withdrawal wallet does not match the invited collaborator.";
  if (!Number.isSafeInteger(withdrawal.withdrawnAt) || withdrawal.withdrawnAt < 1) {
    return "Consent withdrawal time is invalid.";
  }
  if (withdrawal.termsHash !== CREATOR_CONSENT_WITHDRAWAL_TERMS_HASH) {
    return "Consent withdrawal terms are not recognized.";
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(withdrawal.signature)) {
    return "Consent withdrawal signature is invalid.";
  }
  return null;
}

export async function verifyCreatorConsentWithdrawal(
  invitation: CreatorConsentInvitation,
  withdrawal: CreatorConsentWithdrawal
) {
  const validationError = validateCreatorConsentWithdrawal(invitation, withdrawal);
  if (validationError) throw new Error(validationError);
  return (await recoverTypedDataAddress({
    ...creatorConsentWithdrawalTypedData(invitation, withdrawal.withdrawnAt),
    signature: withdrawal.signature
  })).toLowerCase() === invitation.collaboratorWallet;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeCreatorConsentPacket(
  packet: CreatorConsentInvitationPacket | CreatorConsentResponsePacket | CreatorConsentWithdrawalPacket
) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(packet)));
}

export function decodeCreatorConsentWithdrawalPacket(value: string): CreatorConsentWithdrawalPacket | null {
  if (!value || value.length > 8_000) return null;
  try {
    const packet = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<CreatorConsentWithdrawalPacket>;
    const withdrawal = packet.withdrawal;
    if (
      packet.kind !== "rmt_creator_consent_withdrawal"
      || !withdrawal
      || withdrawal.schemaVersion !== CREATOR_CONSENT_SCHEMA_VERSION
      || !/^0x[0-9a-fA-F]{64}$/.test(withdrawal.invitationDigest ?? "")
      || !isAddress(withdrawal.collaboratorWallet ?? "", { strict: false })
      || !Number.isSafeInteger(withdrawal.withdrawnAt)
      || withdrawal.termsHash !== CREATOR_CONSENT_WITHDRAWAL_TERMS_HASH
      || !/^0x[0-9a-fA-F]{130}$/.test(withdrawal.signature ?? "")
    ) return null;
    return {
      kind: "rmt_creator_consent_withdrawal",
      withdrawal: {
        schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
        invitationDigest: withdrawal.invitationDigest.toLowerCase() as Hex,
        collaboratorWallet: getAddress(withdrawal.collaboratorWallet).toLowerCase() as Address,
        withdrawnAt: Number(withdrawal.withdrawnAt),
        termsHash: CREATOR_CONSENT_WITHDRAWAL_TERMS_HASH,
        signature: withdrawal.signature as Hex
      }
    };
  } catch {
    return null;
  }
}

export function decodeCreatorConsentInvitationPacket(value: string): CreatorConsentInvitationPacket | null {
  if (!value || value.length > 12_000) return null;
  try {
    const packet = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<CreatorConsentInvitationPacket>;
    const invitation = normalizeCreatorConsentInvitation(packet.invitation);
    if (
      packet.kind !== "rmt_creator_consent_invitation"
      || !invitation
      || packet.invitationDigest !== hashCreatorConsentInvitation(invitation)
    ) return null;
    return {
      kind: "rmt_creator_consent_invitation",
      invitation,
      invitationDigest: packet.invitationDigest
    };
  } catch {
    return null;
  }
}

export function decodeCreatorConsentResponsePacket(value: string): CreatorConsentResponsePacket | null {
  if (!value || value.length > 8_000) return null;
  try {
    const packet = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<CreatorConsentResponsePacket>;
    const response = packet.response;
    if (
      packet.kind !== "rmt_creator_consent_response"
      || !response
      || response.schemaVersion !== CREATOR_CONSENT_SCHEMA_VERSION
      || !/^0x[0-9a-fA-F]{64}$/.test(response.invitationDigest ?? "")
      || (response.action !== "accept" && response.action !== "reject")
      || !isAddress(response.collaboratorWallet ?? "", { strict: false })
      || !Number.isSafeInteger(response.respondedAt)
      || !/^0x[0-9a-fA-F]{130}$/.test(response.signature ?? "")
    ) return null;
    return {
      kind: "rmt_creator_consent_response",
      response: {
        schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
        invitationDigest: response.invitationDigest.toLowerCase() as Hex,
        action: response.action,
        collaboratorWallet: getAddress(response.collaboratorWallet).toLowerCase() as Address,
        respondedAt: Number(response.respondedAt),
        signature: response.signature as Hex
      }
    };
  } catch {
    return null;
  }
}

export function parseCreatorConsentInvitationRecord(
  invitationId: string,
  value: unknown
): CreatorConsentInvitationRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CreatorConsentInvitationRecord>;
  const invitation = normalizeCreatorConsentInvitation(candidate);
  const status = candidate.status;
  const pendingOrRevoked = status === "pending" || status === "revoked";
  const finalized = status === "accepted" || status === "rejected" || status === "withdrawn";
  const responseAction = candidate.responseAction === "accept" || candidate.responseAction === "reject"
    ? candidate.responseAction
    : null;
  const responseSignature = typeof candidate.responseSignature === "string"
    && /^0x[0-9a-fA-F]{130}$/.test(candidate.responseSignature)
    ? candidate.responseSignature as Hex
    : null;
  const signerWallet = typeof candidate.signerWallet === "string"
    && isAddress(candidate.signerWallet, { strict: false })
    ? getAddress(candidate.signerWallet).toLowerCase() as Address
    : null;
  const withdrawalSignature = typeof candidate.withdrawalSignature === "string"
    && /^0x[0-9a-fA-F]{130}$/.test(candidate.withdrawalSignature)
    ? candidate.withdrawalSignature as Hex
    : null;
  const withdrawn = status === "withdrawn";
  if (
    !invitation
    || !/^[0-9a-f]{64}$/.test(invitationId)
    || candidate.invitationId !== invitationId
    || candidate.invitationDigest !== `0x${invitationId}`
    || candidate.invitationDigest !== hashCreatorConsentInvitation(invitation)
    || (!pendingOrRevoked && !finalized)
    || (status === "pending" && candidate.revokedAt != null)
    || (status === "revoked" && candidate.revokedAt == null)
    || (pendingOrRevoked && (
      candidate.responseAction != null
      || candidate.responseSignature != null
      || candidate.respondedAt != null
      || candidate.signerWallet != null
      || candidate.receivedAt != null
      || candidate.withdrawalSignature != null
      || candidate.withdrawalSignedAt != null
      || candidate.withdrawalReceivedAt != null
    ))
    || ((status === "accepted" || status === "rejected") && (
      candidate.revokedAt != null
      || responseAction !== (status === "accepted" ? "accept" : "reject")
      || !responseSignature
      || !Number.isSafeInteger(candidate.respondedAt)
      || Number(candidate.respondedAt) < 1
      || signerWallet !== invitation.collaboratorWallet
      || candidate.receivedAt == null
      || candidate.withdrawalSignature != null
      || candidate.withdrawalSignedAt != null
      || candidate.withdrawalReceivedAt != null
    ))
    || (withdrawn && (
      candidate.revokedAt != null
      || responseAction !== "accept"
      || !responseSignature
      || !Number.isSafeInteger(candidate.respondedAt)
      || Number(candidate.respondedAt) < 1
      || signerWallet !== invitation.collaboratorWallet
      || candidate.receivedAt == null
      || !withdrawalSignature
      || !Number.isSafeInteger(candidate.withdrawalSignedAt)
      || Number(candidate.withdrawalSignedAt) < Number(candidate.respondedAt)
      || candidate.withdrawalReceivedAt == null
    ))
  ) return null;
  return {
    ...invitation,
    invitationId,
    invitationDigest: candidate.invitationDigest,
    status,
    revokedAt: candidate.revokedAt,
    responseAction,
    responseSignature,
    respondedAt: candidate.respondedAt == null ? null : Number(candidate.respondedAt),
    signerWallet,
    receivedAt: candidate.receivedAt,
    withdrawalSignature,
    withdrawalSignedAt: candidate.withdrawalSignedAt == null ? null : Number(candidate.withdrawalSignedAt),
    withdrawalReceivedAt: candidate.withdrawalReceivedAt,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

export function parseCreatorConsentPublicStatus(
  invitationId: string,
  value: unknown
): CreatorConsentPublicStatus | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CreatorConsentPublicStatus>;
  const projectSlug = normalizeProjectSlug(candidate.projectSlug);
  const status = candidate.status;
  if (
    candidate.schemaVersion !== CREATOR_CONSENT_SCHEMA_VERSION
    || !/^[0-9a-f]{64}$/.test(invitationId)
    || candidate.invitationId !== invitationId
    || candidate.invitationDigest !== `0x${invitationId}`
    || !projectSlug
    || typeof candidate.assetId !== "string"
    || !/^[A-Za-z0-9]{20}$/.test(candidate.assetId)
    || !status
    || !["pending", "revoked", "accepted", "rejected", "withdrawn"].includes(status)
    || !Number.isSafeInteger(candidate.expiresAt)
    || Number(candidate.expiresAt) < 1
  ) return null;
  return {
    schemaVersion: CREATOR_CONSENT_SCHEMA_VERSION,
    invitationId,
    invitationDigest: candidate.invitationDigest,
    projectSlug,
    assetId: candidate.assetId,
    status,
    expiresAt: Number(candidate.expiresAt),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}
