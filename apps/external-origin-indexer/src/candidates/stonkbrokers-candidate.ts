import { createHash } from "node:crypto";
import { EXTERNAL_ORIGIN_CHAIN_ID } from "../config.js";

export const STONKBROKERS_ARCHIVED_TESTNET_FACTORY =
  "0x631f9371fd6b2c85f8f61d19a90547ee67fa61a2" as const;

const SOURCE_ID = "stonkbrokers" as const;
const SOURCE_NAME = "StonkBrokers" as const;
const SOURCE_URL = "https://www.stonkbrokers.cash/" as const;
const LAUNCHER_URL = "https://www.stonkbrokers.cash/launcher" as const;
const DOCUMENTATION_URL = "https://www.stonkbrokers.cash/docs" as const;
const UI_SHELL_URL =
  "https://github.com/Clutch-L4bs/clutch-launchpad" as const;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

export type StonkAssociationKind =
  | "special-project"
  | "website-listing"
  | "stonk-exchange-listing"
  | "stonkbroker-pair"
  | "up-pool"
  | "up-gauge";

export type StonkBrokersSourceIdentity = Readonly<{
  sourceId: string;
  sourceName: string;
  chainId: number;
  sourceUrl: string;
  launcherUrl: string;
  documentationUrl: string;
}>;

const sourceIdentity: StonkBrokersSourceIdentity = Object.freeze({
  sourceId: SOURCE_ID,
  sourceName: SOURCE_NAME,
  chainId: EXTERNAL_ORIGIN_CHAIN_ID,
  sourceUrl: SOURCE_URL,
  launcherUrl: LAUNCHER_URL,
  documentationUrl: DOCUMENTATION_URL
});

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

export function canonicalStonkBrokersSourceIdentity(
  identity: StonkBrokersSourceIdentity
) {
  return JSON.stringify({
    schema: "rmt-stonkbrokers-source-candidate-v1",
    chainId: identity.chainId,
    sourceId: identity.sourceId,
    sourceName: identity.sourceName,
    sourceUrl: identity.sourceUrl,
    launcherUrl: identity.launcherUrl,
    documentationUrl: identity.documentationUrl
  });
}

export function deriveStonkBrokersSourceIdentityHash(
  identity: StonkBrokersSourceIdentity
): `0x${string}` {
  const digest = createHash("sha256")
    .update(canonicalStonkBrokersSourceIdentity(identity), "utf8")
    .digest("hex");
  return `0x${digest}`;
}

export const stonkBrokersCandidate = Object.freeze({
  candidateId: "stonkbrokers-production-launcher-2026-08-12",
  ...sourceIdentity,
  sourceIdentityHash: deriveStonkBrokersSourceIdentityHash(sourceIdentity),
  productionStatus: "coming-soon-unverified" as const,
  productionEvidence: Object.freeze({
    evidenceContract: "unknown" as const,
    deploymentTransaction: "unknown" as const,
    deploymentBlock: "unknown" as const,
    deploymentBlockHash: "unknown" as const,
    runtimeCodeHash: "unknown" as const,
    proxyStatus: "unknown" as const,
    implementationIdentity: "unknown" as const,
    verifiedSource: "unknown" as const,
    abi: "unknown" as const,
    creationEvent: "unknown" as const,
    eventTopic0: "unknown" as const,
    eventFieldSemantics: "unknown" as const,
    launchModeEventCoverage: "unknown" as const
  }),
  archivedTestnetEvidence: Object.freeze({
    address: STONKBROKERS_ARCHIVED_TESTNET_FACTORY,
    classification: "testnet-archive" as const,
    eligibleAsMainnetEvidence: false as const,
    mainnetRuntimeAtReview: "empty" as const,
    evidenceUrl: DOCUMENTATION_URL
  }),
  excludedContractEvidence: Object.freeze([
    Object.freeze({
      url: UI_SHELL_URL,
      classification: "mock-ui-shell-no-contracts" as const
    })
  ]),
  associationOnlySignals: Object.freeze([
    "special-project",
    "website-listing",
    "stonk-exchange-listing",
    "stonkbroker-pair",
    "up-pool",
    "up-gauge"
  ] as const satisfies readonly StonkAssociationKind[]),
  independentSpecialProjects: Object.freeze(["DERP", "MANCER", "YARD"]),
  allowedClaimKinds: Object.freeze([]) as readonly never[],
  activationEligible: false as const,
  adapterRegistered: false as const,
  activationBlockers: Object.freeze([
    "production_evidence_contract_unknown",
    "production_deployment_boundary_unknown",
    "production_runtime_identity_unknown",
    "production_source_and_abi_unknown",
    "production_creation_event_unknown",
    "production_event_semantics_unknown",
    "production_receipt_fixtures_missing",
    "production_state_cross_check_missing",
    "rpc_backfill_not_implemented",
    "independent_shadow_comparison_not_completed"
  ]),
  reviewedAt: "2026-08-12"
} as const);

export function validateStonkBrokersSourceIdentity(
  identity: StonkBrokersSourceIdentity
) {
  if (identity.chainId !== EXTERNAL_ORIGIN_CHAIN_ID) {
    throw new Error("StonkBrokers candidate has the wrong chain ID");
  }
  if (identity.sourceId !== SOURCE_ID || identity.sourceName !== SOURCE_NAME) {
    throw new Error("StonkBrokers candidate has the wrong source identity");
  }
  for (const [name, value] of [
    ["sourceUrl", identity.sourceUrl],
    ["launcherUrl", identity.launcherUrl],
    ["documentationUrl", identity.documentationUrl]
  ] as const) {
    requireHttps(name, value);
  }
  return Object.freeze({
    ...identity,
    sourceIdentityHash: deriveStonkBrokersSourceIdentityHash(identity)
  });
}

export function assertStonkBrokersProductionEvidenceContract(
  address: string
): `0x${string}` {
  if (!ADDRESS_PATTERN.test(address)) {
    throw new Error(
      "StonkBrokers production evidence contract must be a lowercase address"
    );
  }
  if (address === STONKBROKERS_ARCHIVED_TESTNET_FACTORY) {
    throw new Error(
      "Archived StonkBrokers testnet factory is forbidden as mainnet evidence"
    );
  }
  return address as `0x${string}`;
}

export function classifyStonkAssociation(
  association: Readonly<{ kind: StonkAssociationKind; label: string }>
) {
  if (!stonkBrokersCandidate.associationOnlySignals.includes(association.kind)) {
    throw new Error("Unknown StonkBrokers association kind");
  }
  if (
    association.label.trim() !== association.label ||
    association.label.length < 1 ||
    association.label.length > 120
  ) {
    throw new Error("StonkBrokers association label is invalid");
  }
  return Object.freeze({
    sourceId: SOURCE_ID,
    chainId: EXTERNAL_ORIGIN_CHAIN_ID,
    associationKind: association.kind,
    label: association.label,
    claimKinds: Object.freeze([]) as readonly never[],
    tokenCreated: false as const,
    sourceListed: false as const,
    authoritative: false as const
  });
}
