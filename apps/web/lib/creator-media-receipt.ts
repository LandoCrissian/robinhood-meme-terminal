import { keccak256, toHex, type Hex } from "viem";
import type { CreatorMediaManifest } from "./creator-media-manifest";

export const CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION = 2 as const;
export const LEGACY_CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION = 1 as const;

type CreatorMediaReceiptBase = {
  receiptId: string;
  projectSlug: string;
  assetId: string;
  draftRevisionHash: Hex;
  metadataHash: Hex;
  manifestHash: Hex;
  metadataCid: string;
  metadataUri: string;
  storageProvider: "pinata";
  storageNetwork: "public";
  providerFileId: string;
  storedSize: number;
  providerRecordVerified: true;
  contractExecution: "disabled";
  createdAt?: unknown;
};

export type CreatorMediaRetrievalCheck = {
  role: "metadata" | "primary" | "preview";
  uri: string;
  contentType: string;
  bytesRead: number;
  exactBytesVerified: boolean;
  status: "retrieved";
};

export type LegacyCreatorMediaReceipt = CreatorMediaReceiptBase & {
  schemaVersion: typeof LEGACY_CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION;
};

export type CreatorMediaReceipt = CreatorMediaReceiptBase & {
  schemaVersion: typeof CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION;
  retrievalVerified: true;
  retrievalGatewayOrigin: string;
  retrievalChecks: CreatorMediaRetrievalCheck[];
};

export type AnyCreatorMediaReceipt = LegacyCreatorMediaReceipt | CreatorMediaReceipt;
export type CreatorMediaReceiptPayload = Omit<CreatorMediaReceipt, "receiptId" | "createdAt">;
type LegacyCreatorMediaReceiptPayload = Omit<LegacyCreatorMediaReceipt, "receiptId" | "createdAt">;

export function isPublicIpfsCid(value: unknown): value is string {
  return typeof value === "string" && (
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)
    || /^b[a-z2-7]{20,}$/.test(value)
  );
}

export function creatorMetadataBytes(manifest: CreatorMediaManifest) {
  return JSON.stringify(manifest.metadata);
}

export function createCreatorMediaReceipt(input: {
  manifest: CreatorMediaManifest;
  metadataCid: string;
  providerFileId: string;
  storedSize: number;
  retrievalGatewayOrigin: string;
  retrievalChecks: CreatorMediaRetrievalCheck[];
}): CreatorMediaReceipt {
  if (input.manifest.mediaIntegrity !== "content_addressed") {
    throw new Error("Every media reference must be content-addressed before metadata can be pinned.");
  }
  if (!isPublicIpfsCid(input.metadataCid)) throw new Error("The metadata CID is invalid.");
  if (
    !/^[A-Za-z0-9-]{8,128}$/.test(input.providerFileId)
    || !Number.isSafeInteger(input.storedSize)
    || input.storedSize < 2
    || input.storedSize > 64_000
  ) throw new Error("The verified storage record is invalid.");
  const expectedSize = new TextEncoder().encode(creatorMetadataBytes(input.manifest)).byteLength;
  if (input.storedSize !== expectedSize) {
    throw new Error("The stored metadata byte length does not match the generated metadata.");
  }
  let retrievalOrigin = "";
  try {
    const gateway = new URL(input.retrievalGatewayOrigin);
    if (
      gateway.protocol !== "https:"
      || gateway.username
      || gateway.password
      || (gateway.pathname !== "" && gateway.pathname !== "/")
      || gateway.search
      || gateway.hash
    ) throw new Error("invalid");
    retrievalOrigin = gateway.origin;
  } catch {
    throw new Error("The retrieval gateway record is invalid.");
  }
  const expectedRoles = [
    "metadata",
    ...input.manifest.media.map((reference) => reference.role)
  ];
  if (
    input.retrievalChecks.length !== expectedRoles.length
    || input.retrievalChecks.some((check, index) => (
      check.role !== expectedRoles[index]
      || check.status !== "retrieved"
      || typeof check.uri !== "string"
      || check.uri.length < 10
      || check.uri.length > 600
      || typeof check.contentType !== "string"
      || check.contentType.length < 3
      || check.contentType.length > 120
      || !Number.isSafeInteger(check.bytesRead)
      || check.bytesRead < 1
      || check.bytesRead > 64_000
      || check.exactBytesVerified !== (check.role === "metadata")
    ))
    || input.retrievalChecks[0]?.uri !== `ipfs://${input.metadataCid}`
    || input.retrievalChecks[0]?.bytesRead !== expectedSize
    || input.manifest.media.some((reference, index) => (
      input.retrievalChecks[index + 1]?.uri !== reference.uri
    ))
  ) throw new Error("The bounded retrieval evidence is invalid.");
  const payload: CreatorMediaReceiptPayload = {
    schemaVersion: CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION,
    projectSlug: input.manifest.projectSlug,
    assetId: input.manifest.assetId,
    draftRevisionHash: input.manifest.draftRevisionHash,
    metadataHash: input.manifest.metadataHash,
    manifestHash: input.manifest.manifestHash,
    metadataCid: input.metadataCid,
    metadataUri: `ipfs://${input.metadataCid}`,
    storageProvider: "pinata",
    storageNetwork: "public",
    providerFileId: input.providerFileId,
    storedSize: input.storedSize,
    providerRecordVerified: true,
    retrievalVerified: true,
    retrievalGatewayOrigin: retrievalOrigin,
    retrievalChecks: input.retrievalChecks,
    contractExecution: "disabled"
  };
  return {
    ...payload,
    receiptId: keccak256(toHex(JSON.stringify(payload))).slice(2)
  };
}

export function parseCreatorMediaReceipt(receiptId: string, value: unknown): AnyCreatorMediaReceipt | null {
  if (!/^[0-9a-f]{64}$/.test(receiptId) || !value || typeof value !== "object") return null;
  const candidate = value as AnyCreatorMediaReceipt;
  try {
    if (
      ![
        LEGACY_CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION,
        CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION
      ].includes(candidate.schemaVersion)
      || candidate.receiptId !== receiptId
      || !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(candidate.projectSlug)
      || !/^[A-Za-z0-9]{20}$/.test(candidate.assetId)
      || !/^0x[0-9a-f]{64}$/.test(candidate.draftRevisionHash)
      || !/^0x[0-9a-f]{64}$/.test(candidate.metadataHash)
      || !/^0x[0-9a-f]{64}$/.test(candidate.manifestHash)
      || !isPublicIpfsCid(candidate.metadataCid)
      || candidate.metadataUri !== `ipfs://${candidate.metadataCid}`
      || candidate.storageProvider !== "pinata"
      || candidate.storageNetwork !== "public"
      || !/^[A-Za-z0-9-]{8,128}$/.test(candidate.providerFileId)
      || !Number.isSafeInteger(candidate.storedSize)
      || candidate.storedSize < 2
      || candidate.storedSize > 64_000
      || candidate.providerRecordVerified !== true
      || candidate.contractExecution !== "disabled"
    ) return null;
    const basePayload = {
      projectSlug: candidate.projectSlug,
      assetId: candidate.assetId,
      draftRevisionHash: candidate.draftRevisionHash,
      metadataHash: candidate.metadataHash,
      manifestHash: candidate.manifestHash,
      metadataCid: candidate.metadataCid,
      metadataUri: candidate.metadataUri,
      storageProvider: candidate.storageProvider,
      storageNetwork: candidate.storageNetwork,
      providerFileId: candidate.providerFileId,
      storedSize: candidate.storedSize,
      providerRecordVerified: candidate.providerRecordVerified
    };
    const legacy = candidate.schemaVersion === LEGACY_CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION;
    let payload: LegacyCreatorMediaReceiptPayload | CreatorMediaReceiptPayload;
    if (legacy) {
      payload = {
        schemaVersion: LEGACY_CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION,
        ...basePayload,
        contractExecution: candidate.contractExecution
      };
    } else {
      if (
        candidate.retrievalVerified !== true
        || typeof candidate.retrievalGatewayOrigin !== "string"
        || new URL(candidate.retrievalGatewayOrigin).protocol !== "https:"
        || new URL(candidate.retrievalGatewayOrigin).origin !== candidate.retrievalGatewayOrigin
        || !Array.isArray(candidate.retrievalChecks)
        || candidate.retrievalChecks.length < 2
        || candidate.retrievalChecks.length > 3
        || candidate.retrievalChecks.some((check, index) => (
          !["metadata", "primary", "preview"].includes(check.role)
          || check.status !== "retrieved"
          || typeof check.uri !== "string"
          || check.uri.length < 10
          || check.uri.length > 600
          || typeof check.contentType !== "string"
          || check.contentType.length < 3
          || check.contentType.length > 120
          || !Number.isSafeInteger(check.bytesRead)
          || check.bytesRead < 1
          || check.bytesRead > 64_000
          || check.exactBytesVerified !== (index === 0)
        ))
        || candidate.retrievalChecks[0]?.role !== "metadata"
        || candidate.retrievalChecks[0]?.uri !== candidate.metadataUri
      ) return null;
      payload = {
        schemaVersion: CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION,
        ...basePayload,
        retrievalVerified: true,
        retrievalGatewayOrigin: candidate.retrievalGatewayOrigin,
        retrievalChecks: candidate.retrievalChecks,
        contractExecution: candidate.contractExecution
      };
    }
    if (keccak256(toHex(JSON.stringify(payload))).slice(2) !== receiptId) return null;
    return {
      ...payload,
      receiptId,
      ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt })
    };
  } catch {
    return null;
  }
}

export function receiptMatchesManifest(
  receipt: AnyCreatorMediaReceipt,
  manifest: CreatorMediaManifest
) {
  return receipt.projectSlug === manifest.projectSlug
    && receipt.assetId === manifest.assetId
    && receipt.draftRevisionHash === manifest.draftRevisionHash
    && receipt.metadataHash === manifest.metadataHash
    && receipt.manifestHash === manifest.manifestHash
    && receipt.contractExecution === "disabled";
}

export function receiptHasVerifiedRetrieval(
  receipt: AnyCreatorMediaReceipt
): receipt is CreatorMediaReceipt {
  return receipt.schemaVersion === CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION
    && receipt.retrievalVerified === true
    && receipt.retrievalChecks[0]?.exactBytesVerified === true;
}
