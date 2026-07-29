import { getAddress, isAddress, keccak256, toHex, type Hex } from "viem";
import { cleanProjectMediaUri, normalizeProjectSlug } from "./creator-application";

export const CREATOR_ASSET_SCHEMA_VERSION = 1 as const;
export const CREATOR_ASSET_TYPES = ["artwork", "music_release", "nft_collection"] as const;
export const CREATION_METHODS = ["human", "ai_assisted", "ai_generated"] as const;
export const RIGHTS_BASES = ["original", "commissioned", "licensed", "public_domain"] as const;
export const ASSET_LICENSES = [
  "all_rights_reserved",
  "personal_use",
  "commercial_use",
  "cc0",
  "cc_by",
  "custom"
] as const;
export const EDITION_MODES = ["one_of_one", "limited", "open"] as const;
export const MUSIC_RELEASE_TYPES = ["single", "ep", "album"] as const;
export const COLLABORATOR_ROLES = [
  "artist",
  "producer",
  "songwriter",
  "performer",
  "developer",
  "label",
  "publisher",
  "other"
] as const;

export type CreatorAssetType = typeof CREATOR_ASSET_TYPES[number];
export type CreationMethod = typeof CREATION_METHODS[number];
export type RightsBasis = typeof RIGHTS_BASES[number];
export type AssetLicense = typeof ASSET_LICENSES[number];
export type EditionMode = typeof EDITION_MODES[number];
export type MusicReleaseType = typeof MUSIC_RELEASE_TYPES[number];
export type CollaboratorRole = typeof COLLABORATOR_ROLES[number];

export type AssetCollaborator = {
  name: string;
  role: CollaboratorRole;
  walletAddress: string;
  consentStatus: "unverified";
};

export type AssetRevenueSplit = {
  label: string;
  walletAddress: string;
  shareBps: number;
};

export type CreatorAssetDraft = {
  assetType: CreatorAssetType;
  title: string;
  description: string;
  primaryMediaUri: string;
  previewMediaUri: string;
  creationMethod: CreationMethod;
  aiTools: string[];
  aiDisclosure: string;
  rightsBasis: RightsBasis;
  rightsStatement: string;
  rightsConfirmed: boolean;
  containsThirdPartyMaterial: boolean;
  thirdPartyRightsConfirmed: boolean;
  license: AssetLicense;
  licenseUri: string;
  editionMode: EditionMode;
  editionSupply: number;
  musicReleaseType: MusicReleaseType;
  explicitContent: boolean;
  masterRightsConfirmed: boolean;
  compositionRightsConfirmed: boolean;
  collaborators: AssetCollaborator[];
  revenueSplits: AssetRevenueSplit[];
};

export type CreatorAsset = CreatorAssetDraft & {
  schemaVersion: typeof CREATOR_ASSET_SCHEMA_VERSION;
  assetId: string;
  projectSlug: string;
  collaboratorConsentStatus: "unverified";
  revenueSplitTotalBps: number;
  draftRevisionHash: Hex;
  status: "draft";
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function hashCreatorAssetDraft(value: CreatorAssetDraft): Hex {
  const draft = normalizeCreatorAsset(value);
  return keccak256(toHex(JSON.stringify({
    schemaVersion: CREATOR_ASSET_SCHEMA_VERSION,
    assetType: draft.assetType,
    title: draft.title,
    description: draft.description,
    primaryMediaUri: draft.primaryMediaUri,
    previewMediaUri: draft.previewMediaUri,
    creationMethod: draft.creationMethod,
    aiTools: draft.aiTools,
    aiDisclosure: draft.aiDisclosure,
    rightsBasis: draft.rightsBasis,
    rightsStatement: draft.rightsStatement,
    rightsConfirmed: draft.rightsConfirmed,
    containsThirdPartyMaterial: draft.containsThirdPartyMaterial,
    thirdPartyRightsConfirmed: draft.thirdPartyRightsConfirmed,
    license: draft.license,
    licenseUri: draft.licenseUri,
    editionMode: draft.editionMode,
    editionSupply: draft.editionSupply,
    musicReleaseType: draft.musicReleaseType,
    explicitContent: draft.explicitContent,
    masterRightsConfirmed: draft.masterRightsConfirmed,
    compositionRightsConfirmed: draft.compositionRightsConfirmed,
    collaborators: draft.collaborators,
    collaboratorConsentStatus: "unverified",
    revenueSplits: draft.revenueSplits,
    revenueSplitTotalBps: draft.revenueSplits.reduce((total, split) => total + split.shareBps, 0),
    status: "draft"
  })));
}

export const EMPTY_CREATOR_ASSET: CreatorAssetDraft = {
  assetType: "artwork",
  title: "",
  description: "",
  primaryMediaUri: "",
  previewMediaUri: "",
  creationMethod: "human",
  aiTools: [],
  aiDisclosure: "",
  rightsBasis: "original",
  rightsStatement: "",
  rightsConfirmed: false,
  containsThirdPartyMaterial: false,
  thirdPartyRightsConfirmed: false,
  license: "all_rights_reserved",
  licenseUri: "",
  editionMode: "one_of_one",
  editionSupply: 1,
  musicReleaseType: "single",
  explicitContent: false,
  masterRightsConfirmed: false,
  compositionRightsConfirmed: false,
  collaborators: [],
  revenueSplits: []
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanHttpsUrl(value: unknown, maximum: number) {
  const candidate = cleanText(value, maximum);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString().slice(0, maximum)
      : "";
  } catch {
    return "";
  }
}

function cleanAssetMediaUri(value: unknown) {
  const candidate = cleanText(value, 512);
  if (!candidate) return "";
  if (candidate.startsWith("ipfs://")) return cleanProjectMediaUri(candidate);
  return cleanHttpsUrl(candidate, 512);
}

function cleanWallet(value: unknown) {
  const candidate = cleanText(value, 42);
  return isAddress(candidate, { strict: false }) ? getAddress(candidate).toLowerCase() : "";
}

function cleanEnum<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]) {
  return values.includes(value as T[number]) ? value as T[number] : fallback;
}

export function normalizeCreatorAsset(value: unknown): CreatorAssetDraft {
  const draft = value && typeof value === "object" ? value as Partial<CreatorAssetDraft> : {};
  const assetType = cleanEnum(draft.assetType, CREATOR_ASSET_TYPES, "artwork");
  const creationMethod = cleanEnum(draft.creationMethod, CREATION_METHODS, "human");
  const rightsBasis = cleanEnum(draft.rightsBasis, RIGHTS_BASES, "original");
  const license = cleanEnum(draft.license, ASSET_LICENSES, "all_rights_reserved");
  const editionMode = cleanEnum(draft.editionMode, EDITION_MODES, "one_of_one");
  const musicReleaseType = cleanEnum(draft.musicReleaseType, MUSIC_RELEASE_TYPES, "single");
  const editionSupplyValue = Number.isInteger(draft.editionSupply) ? Number(draft.editionSupply) : 0;
  const editionSupply = editionMode === "one_of_one"
    ? 1
    : editionMode === "open"
      ? 0
      : Math.max(1, Math.min(1_000_000, editionSupplyValue));
  const aiTools = Array.from(new Set(
    Array.isArray(draft.aiTools)
      ? draft.aiTools.map((tool) => cleanText(tool, 40)).filter(Boolean)
      : []
  )).slice(0, 8);
  const collaborators = (Array.isArray(draft.collaborators) ? draft.collaborators : [])
    .slice(0, 6)
    .map((candidate): AssetCollaborator => ({
      name: cleanText(candidate?.name, 60),
      role: cleanEnum(candidate?.role, COLLABORATOR_ROLES, "other"),
      walletAddress: cleanWallet(candidate?.walletAddress),
      consentStatus: "unverified"
    }));
  const revenueSplits = (Array.isArray(draft.revenueSplits) ? draft.revenueSplits : [])
    .slice(0, 5)
    .map((candidate): AssetRevenueSplit => ({
      label: cleanText(candidate?.label, 60),
      walletAddress: cleanWallet(candidate?.walletAddress),
      shareBps: Number.isInteger(candidate?.shareBps)
        ? Math.max(1, Math.min(10_000, Number(candidate.shareBps)))
        : 0
    }));

  return {
    assetType,
    title: cleanText(draft.title, 100),
    description: cleanText(draft.description, 1_200),
    primaryMediaUri: cleanAssetMediaUri(draft.primaryMediaUri),
    previewMediaUri: cleanAssetMediaUri(draft.previewMediaUri),
    creationMethod,
    aiTools: creationMethod === "human" ? [] : aiTools,
    aiDisclosure: creationMethod === "human" ? "" : cleanText(draft.aiDisclosure, 600),
    rightsBasis,
    rightsStatement: cleanText(draft.rightsStatement, 1_000),
    rightsConfirmed: draft.rightsConfirmed === true,
    containsThirdPartyMaterial: draft.containsThirdPartyMaterial === true,
    thirdPartyRightsConfirmed: draft.thirdPartyRightsConfirmed === true,
    license,
    licenseUri: license === "custom" ? cleanHttpsUrl(draft.licenseUri, 512) : "",
    editionMode,
    editionSupply,
    musicReleaseType,
    explicitContent: assetType === "music_release" && draft.explicitContent === true,
    masterRightsConfirmed: assetType === "music_release" && draft.masterRightsConfirmed === true,
    compositionRightsConfirmed: assetType === "music_release" && draft.compositionRightsConfirmed === true,
    collaborators,
    revenueSplits
  };
}

export function validateCreatorAsset(value: CreatorAssetDraft) {
  const draft = normalizeCreatorAsset(value);
  if (draft.title.length < 2) return "Asset title must be at least 2 characters.";
  if (draft.description.length < 20) return "Describe the asset in at least 20 characters.";
  if (!draft.primaryMediaUri) return "Primary media must use a valid HTTPS or IPFS URL.";
  if (value.previewMediaUri.trim() && !draft.previewMediaUri) {
    return "Preview media must use a valid HTTPS or IPFS URL.";
  }
  if (draft.creationMethod !== "human" && draft.aiTools.length === 0) {
    return "Name at least one AI tool used for AI-assisted or AI-generated work.";
  }
  if (draft.creationMethod !== "human" && draft.aiDisclosure.length < 20) {
    return "Explain the AI contribution in at least 20 characters.";
  }
  if (draft.rightsStatement.length < 20) return "Explain the rights basis in at least 20 characters.";
  if (!draft.rightsConfirmed) return "Confirm that you control the rights needed for this asset.";
  if (draft.containsThirdPartyMaterial && !draft.thirdPartyRightsConfirmed) {
    return "Confirm permission for every third-party element before saving.";
  }
  if (draft.license === "custom" && !draft.licenseUri) {
    return "A custom license requires a valid HTTPS license URL.";
  }
  if (draft.assetType === "music_release" && (!draft.masterRightsConfirmed || !draft.compositionRightsConfirmed)) {
    return "Music drafts require both master-recording and composition-rights confirmation.";
  }
  if (draft.collaborators.some((collaborator) => collaborator.name.length < 2)) {
    return "Every collaborator needs a display name.";
  }
  if (draft.revenueSplits.some((split) => split.label.length < 2 || !split.walletAddress || split.shareBps < 1)) {
    return "Every revenue recipient needs a label, valid wallet, and positive share.";
  }
  const splitAddresses = draft.revenueSplits.map((split) => split.walletAddress);
  if (new Set(splitAddresses).size !== splitAddresses.length) {
    return "Revenue split wallets must be unique.";
  }
  if (draft.revenueSplits.length > 0 && draft.revenueSplits.reduce((total, split) => total + split.shareBps, 0) !== 10_000) {
    return "Revenue shares must total exactly 100%.";
  }
  return null;
}

export function parseCreatorAsset(assetId: string, value: unknown): CreatorAsset | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<CreatorAsset>;
  const projectSlug = normalizeProjectSlug(data.projectSlug);
  const draft = normalizeCreatorAsset(data);
  if (
    data.schemaVersion !== CREATOR_ASSET_SCHEMA_VERSION
    || data.assetId !== assetId
    || !/^[A-Za-z0-9]{20}$/.test(assetId)
    || !projectSlug
    || data.collaboratorConsentStatus !== "unverified"
    || data.revenueSplitTotalBps !== draft.revenueSplits.reduce((total, split) => total + split.shareBps, 0)
    || data.draftRevisionHash !== hashCreatorAssetDraft(draft)
    || data.status !== "draft"
    || validateCreatorAsset(draft)
  ) return null;
  return {
    ...draft,
    schemaVersion: CREATOR_ASSET_SCHEMA_VERSION,
    assetId,
    projectSlug,
    collaboratorConsentStatus: "unverified",
    revenueSplitTotalBps: data.revenueSplitTotalBps,
    draftRevisionHash: data.draftRevisionHash,
    status: "draft",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}
