import { createHash } from "node:crypto";
import {
  EXTERNAL_ORIGIN_CHAIN_ID,
  EXTERNAL_ORIGIN_SCHEMA_VERSION
} from "./config.js";

export type ExternalOriginAdapterManifest = Readonly<{
  adapterId: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  evidenceUrl: string;
  chainId: typeof EXTERNAL_ORIGIN_CHAIN_ID;
  evidenceContract: `0x${string}`;
  evidenceRole:
    | "creation-factory"
    | "listing-registry"
    | "curation-registry"
    | "other-explicit-role";
  startBlock: bigint;
  runtimeCodeHash: `0x${string}`;
  evidenceEventTopic0: `0x${string}`;
  manifestHash: `0x${string}`;
  schemaVersion: typeof EXTERNAL_ORIGIN_SCHEMA_VERSION;
  claimKinds: readonly ("token-created" | "source-listed")[];
}>;

export type ExternalOriginAdapterManifestInput = Omit<
  ExternalOriginAdapterManifest,
  "manifestHash"
>;

const SLUG_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const ZERO_ADDRESS = "0x" + "0".repeat(40);
const ZERO_HASH = "0x" + "0".repeat(64);

function requireHttps(name: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(name + " must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(name + " must use HTTPS");
  }
}

function requireHash(name: string, value: string) {
  if (!HASH_PATTERN.test(value) || value === ZERO_HASH) {
    throw new Error(name + " must be a nonzero lowercase hash");
  }
}

export function canonicalExternalOriginManifest(
  manifest: ExternalOriginAdapterManifestInput
) {
  return JSON.stringify({
    schema: "rmt-external-origin-adapter-v2",
    chainId: manifest.chainId,
    adapterId: manifest.adapterId,
    sourceId: manifest.sourceId,
    sourceName: manifest.sourceName,
    sourceUrl: manifest.sourceUrl,
    evidenceUrl: manifest.evidenceUrl,
    evidenceContract: manifest.evidenceContract,
    evidenceRole: manifest.evidenceRole,
    startBlock: manifest.startBlock.toString(),
    runtimeCodeHash: manifest.runtimeCodeHash,
    evidenceEventTopic0: manifest.evidenceEventTopic0,
    claimKinds: [...manifest.claimKinds].sort(),
    schemaVersion: manifest.schemaVersion
  });
}

export function deriveExternalOriginManifestHash(
  manifest: ExternalOriginAdapterManifestInput
): `0x${string}` {
  const digest = createHash("sha256")
    .update(canonicalExternalOriginManifest(manifest), "utf8")
    .digest("hex");
  return `0x${digest}`;
}

export function validateExternalOriginAdapters(
  adapters: readonly ExternalOriginAdapterManifest[]
) {
  const adapterIds = new Set<string>();
  const evidenceContracts = new Set<string>();

  for (const adapter of adapters) {
    if (adapter.chainId !== EXTERNAL_ORIGIN_CHAIN_ID) {
      throw new Error(adapter.adapterId + " has the wrong chain ID");
    }
    if (!SLUG_PATTERN.test(adapter.adapterId)) {
      throw new Error("External-origin adapterId must be a lowercase slug");
    }
    if (!SLUG_PATTERN.test(adapter.sourceId)) {
      throw new Error(adapter.adapterId + " has an invalid sourceId");
    }
    if (
      adapter.sourceName.trim() !== adapter.sourceName ||
      adapter.sourceName.length < 1 ||
      adapter.sourceName.length > 120
    ) {
      throw new Error(adapter.adapterId + " has an invalid sourceName");
    }
    if (
      !ADDRESS_PATTERN.test(adapter.evidenceContract) ||
      adapter.evidenceContract === ZERO_ADDRESS
    ) {
      throw new Error(
        adapter.adapterId +
        " evidenceContract must be a nonzero lowercase address"
      );
    }
    if (
      adapter.evidenceRole !== "creation-factory" &&
      adapter.evidenceRole !== "listing-registry" &&
      adapter.evidenceRole !== "curation-registry" &&
      adapter.evidenceRole !== "other-explicit-role"
    ) {
      throw new Error(adapter.adapterId + " has an invalid evidenceRole");
    }
    if (adapter.startBlock < 0n) {
      throw new Error(adapter.adapterId + " has an invalid startBlock");
    }
    requireHash(
      adapter.adapterId + " runtimeCodeHash",
      adapter.runtimeCodeHash
    );
    requireHash(
      adapter.adapterId + " evidenceEventTopic0",
      adapter.evidenceEventTopic0
    );
    requireHash(
      adapter.adapterId + " manifestHash",
      adapter.manifestHash
    );
    if (adapter.schemaVersion !== EXTERNAL_ORIGIN_SCHEMA_VERSION) {
      throw new Error(adapter.adapterId + " has the wrong schemaVersion");
    }
    if (
      adapter.claimKinds.length < 1 ||
      new Set(adapter.claimKinds).size !== adapter.claimKinds.length ||
      adapter.claimKinds.some(
        (kind) => kind !== "token-created" && kind !== "source-listed"
      )
    ) {
      throw new Error(adapter.adapterId + " has invalid claimKinds");
    }
    if (
      adapter.claimKinds.includes("token-created") &&
      adapter.evidenceRole !== "creation-factory"
    ) {
      throw new Error(
        adapter.adapterId +
        " may only claim token-created from a creation-factory"
      );
    }
    if (
      adapter.evidenceRole === "creation-factory" &&
      !adapter.claimKinds.includes("token-created")
    ) {
      throw new Error(
        adapter.adapterId +
        " creation-factory must admit token-created evidence"
      );
    }
    requireHttps(adapter.adapterId + " sourceUrl", adapter.sourceUrl);
    requireHttps(adapter.adapterId + " evidenceUrl", adapter.evidenceUrl);

    const {
      manifestHash: _manifestHash,
      ...manifestInput
    } = adapter;
    if (
      adapter.manifestHash !==
      deriveExternalOriginManifestHash(manifestInput)
    ) {
      throw new Error(
        adapter.adapterId + " manifestHash does not match its manifest"
      );
    }
    if (adapterIds.has(adapter.adapterId)) {
      throw new Error("Duplicate external-origin adapterId");
    }
    if (evidenceContracts.has(adapter.evidenceContract)) {
      throw new Error("Duplicate active external-origin evidence contract");
    }
    adapterIds.add(adapter.adapterId);
    evidenceContracts.add(adapter.evidenceContract);
  }

  return Object.freeze([...adapters]);
}

// This is the only adapter allowlist. It intentionally remains empty until an
// external evidence contract, its explicit role, deployment boundary, runtime
// bytecode, verified ABI/source, and exact event pass independent review.
// Environment variables cannot enable an adapter.
export const externalOriginAdapters = [] as const satisfies
  readonly ExternalOriginAdapterManifest[];
