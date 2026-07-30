import { keccak256, toHex, type Hex } from "viem";
import {
  hashCreatorAssetDraft,
  normalizeCreatorAsset,
  validateCreatorAsset,
  type CreatorAssetDraft
} from "./creator-assets";
import { normalizeProjectSlug } from "./creator-application";

export const CREATOR_MEDIA_MANIFEST_SCHEMA_VERSION = 1 as const;

export type CreatorMetadataAttribute = {
  trait_type: string;
  value: string | number;
};

export type CreatorMarketplaceMetadata = {
  name: string;
  description: string;
  image?: string;
  animation_url?: string;
  attributes: CreatorMetadataAttribute[];
};

export type CreatorMediaReference = {
  role: "primary" | "preview";
  uri: string;
  scheme: "ipfs" | "https";
  contentAddressed: boolean;
  cid: string | null;
  path: string | null;
};

export type CreatorMediaManifest = {
  schemaVersion: typeof CREATOR_MEDIA_MANIFEST_SCHEMA_VERSION;
  projectSlug: string;
  assetId: string;
  draftRevisionHash: Hex;
  metadataStandard: "rmt_creator_metadata_v1";
  metadata: CreatorMarketplaceMetadata;
  metadataHash: Hex;
  media: CreatorMediaReference[];
  mediaIntegrity: "content_addressed" | "contains_mutable_reference";
  metadataStorage: "not_pinned";
  contractExecution: "disabled";
  manifestHash: Hex;
};

type ManifestHashPayload = Omit<CreatorMediaManifest, "manifestHash">;

function parseIpfsUri(uri: string) {
  if (!uri.startsWith("ipfs://")) return null;
  const [cid, ...segments] = uri.slice(7).split("/");
  const validV0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid);
  const validV1 = /^b[a-z2-7]{20,}$/.test(cid);
  if (!validV0 && !validV1) return null;
  const path = segments.join("/");
  if (segments.some((segment) => (
    !segment
    || segment === "."
    || segment === ".."
    || segment.length > 180
    || /[?#\\]/.test(segment)
  ))) return null;
  return { cid, path: path || null };
}

export function creatorMediaReference(
  role: CreatorMediaReference["role"],
  uri: string
): CreatorMediaReference | null {
  const ipfs = parseIpfsUri(uri);
  if (ipfs) {
    return {
      role,
      uri,
      scheme: "ipfs",
      contentAddressed: true,
      cid: ipfs.cid,
      path: ipfs.path
    };
  }
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return {
      role,
      uri: url.toString(),
      scheme: "https",
      contentAddressed: false,
      cid: null,
      path: null
    };
  } catch {
    return null;
  }
}

export function buildCreatorMarketplaceMetadata(
  draftValue: CreatorAssetDraft
): CreatorMarketplaceMetadata {
  const draft = normalizeCreatorAsset(draftValue);
  const primary = creatorMediaReference("primary", draft.primaryMediaUri);
  if (!primary) throw new Error("Primary media is not a valid HTTPS or IPFS reference.");
  const preview = draft.previewMediaUri
    ? creatorMediaReference("preview", draft.previewMediaUri)
    : null;
  if (draft.previewMediaUri && !preview) {
    throw new Error("Preview media is not a valid HTTPS or IPFS reference.");
  }
  const music = draft.assetType === "music_release";
  const attributes: CreatorMetadataAttribute[] = [
    { trait_type: "Asset type", value: draft.assetType.replaceAll("_", " ") },
    { trait_type: "Creation method", value: draft.creationMethod.replaceAll("_", " ") },
    { trait_type: "Rights basis", value: draft.rightsBasis.replaceAll("_", " ") },
    { trait_type: "License", value: draft.license.replaceAll("_", " ") },
    { trait_type: "Edition", value: draft.editionMode.replaceAll("_", " ") }
  ];
  if (draft.editionMode !== "open") {
    attributes.push({ trait_type: "Maximum supply", value: draft.editionSupply });
  }
  if (music) {
    attributes.push(
      { trait_type: "Music release type", value: draft.musicReleaseType },
      { trait_type: "Explicit content", value: draft.explicitContent ? "yes" : "no" }
    );
  }
  if (draft.creationMethod !== "human") {
    attributes.push({ trait_type: "AI disclosure", value: "included" });
  }
  return {
    name: draft.title,
    description: draft.description,
    ...(music
      ? {
        ...(preview ? { image: preview.uri } : {}),
        animation_url: primary.uri
      }
      : { image: primary.uri }),
    attributes
  };
}

export function createCreatorMediaManifest(input: {
  projectSlug: string;
  assetId: string;
  draft: CreatorAssetDraft;
}): CreatorMediaManifest {
  const projectSlug = normalizeProjectSlug(input.projectSlug);
  if (
    !projectSlug
    || projectSlug !== input.projectSlug
    || !/^[A-Za-z0-9]{20}$/.test(input.assetId)
  ) throw new Error("The creator media identity is invalid.");
  const draft = normalizeCreatorAsset(input.draft);
  const validationError = validateCreatorAsset(draft);
  if (validationError) throw new Error(validationError);
  const media = [
    creatorMediaReference("primary", draft.primaryMediaUri),
    ...(draft.previewMediaUri ? [creatorMediaReference("preview", draft.previewMediaUri)] : [])
  ];
  if (media.some((reference) => !reference)) {
    throw new Error("Every media reference must use valid HTTPS or IPFS.");
  }
  const normalizedMedia = media as CreatorMediaReference[];
  const metadata = buildCreatorMarketplaceMetadata(draft);
  const payload: ManifestHashPayload = {
    schemaVersion: CREATOR_MEDIA_MANIFEST_SCHEMA_VERSION,
    projectSlug,
    assetId: input.assetId,
    draftRevisionHash: hashCreatorAssetDraft(draft),
    metadataStandard: "rmt_creator_metadata_v1",
    metadata,
    metadataHash: keccak256(toHex(JSON.stringify(metadata))),
    media: normalizedMedia,
    mediaIntegrity: normalizedMedia.every((reference) => reference.contentAddressed)
      ? "content_addressed"
      : "contains_mutable_reference",
    metadataStorage: "not_pinned",
    contractExecution: "disabled"
  };
  return {
    ...payload,
    manifestHash: keccak256(toHex(JSON.stringify(payload)))
  };
}
