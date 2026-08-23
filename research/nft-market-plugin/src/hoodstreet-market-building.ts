import {
  RMT_ECOSYSTEM_SCHEMA_VERSION,
  canonicalId,
  normalizeBytes32,
  normalizeEvmAddress,
  type CapabilityEvidenceState
} from "./ecosystem-capabilities.ts";

export type MarketBuildingTransferPolicy = "nontransferable" | "controller_migration_only";
export type MarketBuildingAccountKind = "none" | "erc6551" | "safe_7579" | "other_smart_account";

export type MarketBuildingAccountBinding = {
  kind: MarketBuildingAccountKind;
  address: string | null;
  implementationRef: string | null;
  custodyScope: "none" | "non_regulated_assets_only" | "project_operations";
  regulatedAssetCustodyAllowed: false;
};

export type MarketBuildingFloor = {
  floorId: string;
  label: string;
  capabilityIds: readonly string[];
  authority: "external_capabilities_only";
};

export type MarketBuildingEvidenceAnchor = {
  kind: "attestation" | "asset_anchor" | "receipt_root" | "source_manifest" | "agent_identity" | "role_registry";
  reference: string;
  evidenceState: CapabilityEvidenceState;
  expiresAtMs: number | null;
};

export type MarketBuildingDynamicTraits = {
  verifiedAssetCount: number;
  observedMarketCount: number;
  verifiedRmtExecutionCount: number;
  claimablePositionCount: number;
  registeredAgentCount: number;
  capabilityHealth: "healthy" | "mixed" | "degraded" | "unknown";
  observedAtMs: number;
  evidenceRoot: string;
};

export type HoodStreetMarketBuildingManifest = {
  schemaVersion: typeof RMT_ECOSYSTEM_SCHEMA_VERSION;
  buildingId: string;
  projectId: string;
  controller: string;
  transferPolicy: MarketBuildingTransferPolicy;
  financialRights: "none";
  safetyEndorsement: false;
  paidPlacementMayAffectMarketRanking: false;
  identityTokenRef: string | null;
  projectAccount: MarketBuildingAccountBinding;
  floors: readonly MarketBuildingFloor[];
  anchors: readonly MarketBuildingEvidenceAnchor[];
  dynamicTraits: MarketBuildingDynamicTraits;
  manifestHash: string;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid HoodStreet Market Building: ${message}.`);
}

function nonnegativeInteger(value: number, label: string) {
  invariant(Number.isSafeInteger(value) && value >= 0, `${label} is invalid`);
}

export function assertMarketBuildingAccount(account: MarketBuildingAccountBinding) {
  if (account.kind === "none") {
    invariant(account.address === null && account.implementationRef === null && account.custodyScope === "none", "empty account binding contains authority");
  } else {
    invariant(account.address !== null, "smart-account binding lacks an address");
    normalizeEvmAddress(account.address!, "project account");
    invariant(account.implementationRef !== null && account.implementationRef.trim().length > 0, "project account implementation evidence is missing");
  }
  invariant(account.regulatedAssetCustodyAllowed === false, "market building account cannot be a compliance bypass for regulated assets");
  return true;
}

export function assertMarketBuildingManifest(manifest: HoodStreetMarketBuildingManifest) {
  invariant(manifest.schemaVersion === RMT_ECOSYSTEM_SCHEMA_VERSION, "schema version is unsupported");
  canonicalId(manifest.buildingId, "building ID");
  canonicalId(manifest.projectId, "project ID");
  normalizeEvmAddress(manifest.controller, "building controller");
  invariant(manifest.transferPolicy === "nontransferable" || manifest.transferPolicy === "controller_migration_only", "building transfer policy is unsafe");
  invariant(manifest.financialRights === "none", "building identity cannot imply dividends, revenue share or RWA ownership");
  invariant(manifest.safetyEndorsement === false, "building membership cannot imply safety");
  invariant(manifest.paidPlacementMayAffectMarketRanking === false, "payment cannot alter RMT market ranking");
  if (manifest.identityTokenRef !== null) invariant(manifest.identityTokenRef.trim().length > 0, "identity token reference is empty");
  assertMarketBuildingAccount(manifest.projectAccount);

  invariant(manifest.floors.length > 0, "building has no capability floors");
  const floorIds = new Set<string>();
  const capabilityIds = new Set<string>();
  for (const floor of manifest.floors) {
    canonicalId(floor.floorId, "floor ID");
    invariant(!floorIds.has(floor.floorId), "floor IDs are duplicated");
    floorIds.add(floor.floorId);
    invariant(floor.label.trim().length > 0, "floor label is missing");
    invariant(floor.authority === "external_capabilities_only", "building floor claims protocol authority");
    invariant(floor.capabilityIds.length > 0, "building floor has no capabilities");
    for (const capabilityId of floor.capabilityIds) {
      canonicalId(capabilityId, "floor capability ID");
      invariant(!capabilityIds.has(capabilityId), "capability appears on multiple floors");
      capabilityIds.add(capabilityId);
    }
  }

  invariant(manifest.anchors.length > 0, "building has no evidence anchors");
  for (const anchor of manifest.anchors) {
    invariant(anchor.reference.trim().length > 0, "evidence anchor reference is missing");
    invariant(anchor.expiresAtMs === null || (Number.isSafeInteger(anchor.expiresAtMs) && anchor.expiresAtMs > 0), "anchor expiry is invalid");
  }

  nonnegativeInteger(manifest.dynamicTraits.verifiedAssetCount, "verified asset count");
  nonnegativeInteger(manifest.dynamicTraits.observedMarketCount, "observed market count");
  nonnegativeInteger(manifest.dynamicTraits.verifiedRmtExecutionCount, "verified RMT execution count");
  nonnegativeInteger(manifest.dynamicTraits.claimablePositionCount, "claimable position count");
  nonnegativeInteger(manifest.dynamicTraits.registeredAgentCount, "registered agent count");
  invariant(Number.isSafeInteger(manifest.dynamicTraits.observedAtMs) && manifest.dynamicTraits.observedAtMs > 0, "trait observation time is invalid");
  normalizeBytes32(manifest.dynamicTraits.evidenceRoot, "dynamic-trait evidence root");
  normalizeBytes32(manifest.manifestHash, "building manifest hash");
  return true;
}

export function buildingCapabilityIds(manifest: HoodStreetMarketBuildingManifest) {
  assertMarketBuildingManifest(manifest);
  return manifest.floors.flatMap((floor) => [...floor.capabilityIds]);
}
