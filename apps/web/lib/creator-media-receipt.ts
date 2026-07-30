import { keccak256, toHex, type Hex } from "viem";
import type { CreatorMediaManifest } from "./creator-media-manifest";

export const CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION = 1 as const;

export type CreatorMediaReceipt = {
  schemaVersion: typeof CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION;
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

export type CreatorMediaReceiptPayload = Omit<CreatorMediaReceipt, "receiptId" | "createdAt">;

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
    contractExecution: "disabled"
  };
  return {
    ...payload,
    receiptId: keccak256(toHex(JSON.stringify(payload))).slice(2)
  };
}

export function parseCreatorMediaReceipt(receiptId: string, value: unknown): CreatorMediaReceipt | null {
  if (!/^[0-9a-f]{64}$/.test(receiptId) || !value || typeof value !== "object") return null;
  const candidate = value as CreatorMediaReceipt;
  try {
    if (
      candidate.schemaVersion !== CREATOR_MEDIA_RECEIPT_SCHEMA_VERSION
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
    const payload: CreatorMediaReceiptPayload = {
      schemaVersion: candidate.schemaVersion,
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
      providerRecordVerified: candidate.providerRecordVerified,
      contractExecution: candidate.contractExecution
    };
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
  receipt: CreatorMediaReceipt,
  manifest: CreatorMediaManifest
) {
  return receipt.projectSlug === manifest.projectSlug
    && receipt.assetId === manifest.assetId
    && receipt.draftRevisionHash === manifest.draftRevisionHash
    && receipt.metadataHash === manifest.metadataHash
    && receipt.manifestHash === manifest.manifestHash
    && receipt.contractExecution === "disabled";
}
