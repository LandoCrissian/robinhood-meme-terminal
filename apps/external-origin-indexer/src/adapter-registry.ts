import {
  EXTERNAL_ORIGIN_CHAIN_ID,
  EXTERNAL_ORIGIN_SCHEMA_VERSION
} from "./config.js";

export type ExternalOriginAdapterManifest = {
  adapterId: string;
  sourceId: string;
  sourceName: string;
  chainId: typeof EXTERNAL_ORIGIN_CHAIN_ID;
  factory: `0x${string}`;
  startBlock: bigint;
  runtimeCodeHash: `0x${string}`;
  manifestHash: `0x${string}`;
  schemaVersion: typeof EXTERNAL_ORIGIN_SCHEMA_VERSION;
  claimKinds: readonly ("token-created" | "source-listed")[];
};

// This is the only adapter allowlist. It intentionally remains empty until an
// external factory, deployment boundary, runtime bytecode, verified ABI/source,
// and creation event pass independent review. Environment variables cannot
// enable an adapter.
export const externalOriginAdapters = [] as const satisfies
  readonly ExternalOriginAdapterManifest[];
