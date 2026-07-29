import {
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
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
