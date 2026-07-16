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
  factory: `0x${string}`;
  startBlock: bigint;
  runtimeCodeHash: `0x${string}`;
  creationEventTopic0: `0x${string}`;
  manifestHash: `0x${string}`;
  schemaVersion: typeof EXTERNAL_ORIGIN_SCHEMA_VERSION;
  claimKinds: readonly ("token-created" | "source-listed")[];
}>;

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

export function validateExternalOriginAdapters(
  adapters: readonly ExternalOriginAdapterManifest[]
) {
  const adapterIds = new Set<string>();
  const factories = new Set<string>();

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
      !ADDRESS_PATTERN.test(adapter.factory) ||
      adapter.factory === ZERO_ADDRESS
    ) {
      throw new Error(
        adapter.adapterId + " factory must be a nonzero lowercase address"
      );
    }
    if (adapter.startBlock < 0n) {
      throw new Error(adapter.adapterId + " has an invalid startBlock");
    }
    requireHash(
      adapter.adapterId + " runtimeCodeHash",
      adapter.runtimeCodeHash
    );
    requireHash(
      adapter.adapterId + " creationEventTopic0",
      adapter.creationEventTopic0
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
      new Set(adapter.claimKinds).size !== adapter.claimKinds.length
    ) {
      throw new Error(adapter.adapterId + " has invalid claimKinds");
    }
    requireHttps(adapter.adapterId + " sourceUrl", adapter.sourceUrl);
    requireHttps(adapter.adapterId + " evidenceUrl", adapter.evidenceUrl);

    if (adapterIds.has(adapter.adapterId)) {
      throw new Error("Duplicate external-origin adapterId");
    }
    if (factories.has(adapter.factory)) {
      throw new Error("Duplicate external-origin factory");
    }
    adapterIds.add(adapter.adapterId);
    factories.add(adapter.factory);
  }

  return Object.freeze([...adapters]);
}

// This is the only adapter allowlist. It intentionally remains empty until an
// external factory, deployment boundary, runtime bytecode, verified ABI/source,
// and creation event pass independent review. Environment variables cannot
// enable an adapter.
export const externalOriginAdapters = [] as const satisfies
  readonly ExternalOriginAdapterManifest[];
