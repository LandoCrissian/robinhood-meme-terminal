import assert from "node:assert/strict";
import {
  deriveExternalOriginManifestHash,
  externalOriginAdapters,
  validateExternalOriginAdapters,
  type ExternalOriginAdapterManifest,
  type ExternalOriginAdapterManifestInput
} from "../adapter-registry.js";
import {
  EXTERNAL_ORIGIN_ATTRIBUTION_ACTIVATION_LOCKED,
  EXTERNAL_ORIGIN_SCHEMA_VERSION,
  loadExternalOriginConfig
} from "../config.js";
import {
  STONKBROKERS_ARCHIVED_TESTNET_FACTORY,
  assertStonkBrokersProductionEvidenceContract,
  canonicalStonkBrokersSourceIdentity,
  classifyStonkAssociation,
  deriveStonkBrokersSourceIdentityHash,
  stonkBrokersCandidate,
  validateStonkBrokersSourceIdentity,
  type StonkAssociationKind,
  type StonkBrokersSourceIdentity
} from "./stonkbrokers-candidate.js";

assert.equal(stonkBrokersCandidate.sourceId, "stonkbrokers");
assert.equal(stonkBrokersCandidate.sourceName, "StonkBrokers");
assert.equal(stonkBrokersCandidate.chainId, 4663);
assert.equal(stonkBrokersCandidate.activationEligible, false);
assert.equal(stonkBrokersCandidate.adapterRegistered, false);
assert.equal(stonkBrokersCandidate.allowedClaimKinds.length, 0);
assert.equal(
  stonkBrokersCandidate.sourceIdentityHash,
  "0x06cdcf12543b78e8a064ed4fd01b8e181a540254b1a4383fdcf2852d99377e62"
);
assert.equal(
  Object.values(stonkBrokersCandidate.productionEvidence).every(
    (value) => value === "unknown"
  ),
  true
);
assert.equal(EXTERNAL_ORIGIN_ATTRIBUTION_ACTIVATION_LOCKED, true);
assert.equal(externalOriginAdapters.length, 0);

const identity = validateStonkBrokersSourceIdentity(stonkBrokersCandidate);
assert.equal(identity.sourceIdentityHash, stonkBrokersCandidate.sourceIdentityHash);
assert.equal(
  deriveStonkBrokersSourceIdentityHash(stonkBrokersCandidate),
  stonkBrokersCandidate.sourceIdentityHash
);
assert.match(
  canonicalStonkBrokersSourceIdentity(stonkBrokersCandidate),
  /rmt-stonkbrokers-source-candidate-v1/
);

const mutatedIdentity = {
  ...stonkBrokersCandidate,
  launcherUrl: "https://www.stonkbrokers.cash/launcher-changed"
} as StonkBrokersSourceIdentity;
assert.notEqual(
  deriveStonkBrokersSourceIdentityHash(mutatedIdentity),
  stonkBrokersCandidate.sourceIdentityHash
);
assert.throws(
  () => validateStonkBrokersSourceIdentity({
    ...stonkBrokersCandidate,
    chainId: 1
  } as StonkBrokersSourceIdentity),
  /wrong chain ID/
);
assert.throws(
  () => validateStonkBrokersSourceIdentity({
    ...stonkBrokersCandidate,
    sourceId: "fake-stonk"
  } as StonkBrokersSourceIdentity),
  /wrong source identity/
);
assert.throws(
  () => validateStonkBrokersSourceIdentity({
    ...stonkBrokersCandidate,
    sourceUrl: "http://www.stonkbrokers.cash/"
  } as StonkBrokersSourceIdentity),
  /HTTPS/
);

assert.equal(
  stonkBrokersCandidate.archivedTestnetEvidence.address,
  STONKBROKERS_ARCHIVED_TESTNET_FACTORY
);
assert.equal(
  stonkBrokersCandidate.archivedTestnetEvidence.mainnetRuntimeAtReview,
  "empty"
);
assert.throws(
  () => assertStonkBrokersProductionEvidenceContract(
    STONKBROKERS_ARCHIVED_TESTNET_FACTORY
  ),
  /testnet factory is forbidden/
);
assert.equal(
  assertStonkBrokersProductionEvidenceContract(`0x${"a".repeat(40)}`),
  `0x${"a".repeat(40)}`
);

for (const [kind, label] of [
  ["special-project", "DERP"],
  ["special-project", "MANCER"],
  ["special-project", "YARD"],
  ["special-project", "Arbitrary Special Project"],
  ["website-listing", "Stonk website card"],
  ["stonk-exchange-listing", "Stonk Exchange"],
  ["stonkbroker-pair", "TOKEN/STONKBROKER"],
  ["up-pool", "up-v2 pool"],
  ["up-gauge", "up gauge"]
] as const satisfies readonly (readonly [StonkAssociationKind, string])[]) {
  const classification = classifyStonkAssociation({ kind, label });
  assert.equal(classification.tokenCreated, false, label);
  assert.equal(classification.sourceListed, false, label);
  assert.equal(classification.authoritative, false, label);
  assert.equal(classification.claimKinds.length, 0, label);
}

const listingInput: ExternalOriginAdapterManifestInput = {
  adapterId: "listing-example-v1",
  sourceId: "listing-example",
  sourceName: "Listing Example",
  sourceUrl: "https://example.com/source",
  evidenceUrl: "https://example.com/evidence",
  chainId: 4663,
  evidenceContract: `0x${"1".repeat(40)}`,
  evidenceRole: "listing-registry",
  startBlock: 1n,
  runtimeCodeHash: `0x${"2".repeat(64)}`,
  evidenceEventTopic0: `0x${"3".repeat(64)}`,
  schemaVersion: EXTERNAL_ORIGIN_SCHEMA_VERSION,
  claimKinds: ["source-listed"]
};
const listingManifest: ExternalOriginAdapterManifest = {
  ...listingInput,
  manifestHash: deriveExternalOriginManifestHash(listingInput)
};
assert.equal(validateExternalOriginAdapters([listingManifest]).length, 1);
assert.throws(
  () => validateExternalOriginAdapters([{
    ...listingManifest,
    evidenceContract: `0x${"4".repeat(40)}`
  }]),
  /manifestHash/
);

const poisonedCreatedInput = {
  ...listingInput,
  claimKinds: ["token-created"] as const
};
const poisonedCreatedManifest: ExternalOriginAdapterManifest = {
  ...poisonedCreatedInput,
  manifestHash: deriveExternalOriginManifestHash(poisonedCreatedInput)
};
assert.throws(
  () => validateExternalOriginAdapters([poisonedCreatedManifest]),
  /only claim token-created from a creation-factory/
);

const config = loadExternalOriginConfig({
  EXTERNAL_ORIGIN_DATABASE_URL:
    "postgresql://external:secret@db.example.com/external_origin",
  EXTERNAL_ORIGIN_READ_TOKEN: "stonk-candidate-test-token-0000000000000001",
  EXTERNAL_ORIGIN_STONKBROKERS_ENABLED: "true",
  STONKBROKERS_FACTORY: STONKBROKERS_ARCHIVED_TESTNET_FACTORY
});
assert.equal("stonkBrokersEnabled" in config, false);
assert.equal(externalOriginAdapters.length, 0);

console.info("StonkBrokers candidate adversarial smoke checks passed");
