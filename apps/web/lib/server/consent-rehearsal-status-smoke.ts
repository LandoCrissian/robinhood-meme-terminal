import assert from "node:assert/strict";
import fs from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import {
  CONSENT_REHEARSAL_PROOF_MAX_AGE_MS,
  CONSENT_REHEARSAL_PROOF_MAX_FUTURE_SKEW_MS,
  consentRehearsalContractNames,
  consentRehearsalRelease,
  getConsentRehearsalProofMode,
  isConsentRehearsalProofFresh,
  type ConsentRehearsalStatus
} from "../consent-rehearsal";
import {
  consentRehearsalUnpauseCalldata,
  deriveConsentRehearsalActivation,
  evaluateConsentRehearsalGovernance,
  unavailableConsentRehearsalStatus,
  type ConsentGovernanceTransaction
} from "./consent-rehearsal-status";

assert.equal(consentRehearsalRelease.network.chainId, 46_630);
assert.equal(consentRehearsalRelease.release.status, "verified-paused");
assert.equal(consentRehearsalRelease.verification.result, "passed");
assert.equal(consentRehearsalRelease.classification.realAssetsPermitted, false);
assert.equal(consentRehearsalRelease.classification.publicExecutionEnabled, false);
assert.equal(consentRehearsalRelease.configuration.initialPaused, true);
assert.equal(consentRehearsalRelease.configuration.governanceDelaySeconds, 86_400);
assert.equal(consentRehearsalRelease.configuration.governanceWindowSeconds, 604_800);
assert.equal(consentRehearsalRelease.contracts.migrator.address, "0x01Cdc5FA002F0dEee4B153D31763392EC81e8f05");
assert.equal(consentRehearsalRelease.contracts.governance.address, "0xA7892f1D730132834493C5DC361e289430D3d3c0");
assert.equal(consentRehearsalContractNames.length, 10);
for (const name of consentRehearsalContractNames) {
  assert.match(consentRehearsalRelease.contracts[name].address, /^0x[0-9a-fA-F]{40}$/);
  assert.match(consentRehearsalRelease.contracts[name].runtimeCodeHash, /^0x[0-9a-f]{64}$/);
  assert.equal(consentRehearsalRelease.contracts[name].sourceVerification, "verified");
}

const operator = getAddress(consentRehearsalRelease.operator);
const migrator = getAddress(consentRehearsalRelease.contracts.migrator.address);

function proposal(overrides: Partial<ConsentGovernanceTransaction> = {}): ConsentGovernanceTransaction {
  return {
    id: 0n,
    proposer: operator,
    target: migrator,
    value: 0n,
    data: consentRehearsalUnpauseCalldata,
    executeAfter: 200n,
    executeBefore: 605_000n,
    configurationEpoch: 1n,
    confirmations: 1n,
    executed: false,
    cancelled: false,
    ...overrides
  };
}

function state(paused: boolean, blockTimestamp: bigint, transactions: ConsentGovernanceTransaction[]) {
  return deriveConsentRehearsalActivation({
    paused,
    transactions,
    currentEpoch: 1n,
    threshold: 1n,
    blockTimestamp
  });
}

assert.equal(state(true, 100n, []).state, "paused");
assert.equal(state(true, 100n, [proposal()]).state, "proposal-pending");
assert.equal(state(true, 200n, [proposal()]).state, "ready-to-execute");
assert.equal(state(true, 605_001n, [proposal()]).state, "proposal-expired");
assert.equal(state(false, 250n, [proposal({ executed: true })]).state, "active");
assert.equal(state(true, 250n, [proposal({ executed: true })]).state, "paused-after-activation");
assert.equal(state(false, 250n, []).state, "invalid-active-state");
assert.equal(state(true, 250n, [proposal({ cancelled: true })]).state, "paused");
assert.equal(state(true, 250n, [proposal({ configurationEpoch: 0n })]).state, "paused");
assert.equal(state(true, 250n, [proposal({ confirmations: 0n })]).state, "paused");
assert.equal(state(true, 250n, [proposal({ data: "0xdeadbeef" as Hex })]).matchingCount, 0);
assert.equal(state(true, 250n, [proposal({ target: operator as Address })]).matchingCount, 0);
assert.equal(state(true, 250n, [proposal({ executeBefore: 500n })]).matchingCount, 0);
assert.equal(state(true, 250n, [proposal({ executed: true, cancelled: true })]).matchingCount, 0);

function governance(overrides: Partial<Parameters<typeof evaluateConsentRehearsalGovernance>[0]> = {}) {
  return evaluateConsentRehearsalGovernance({
    paused: true,
    transactionCount: 0n,
    transactions: [],
    configurationEpoch: 1n,
    signerCount: 1n,
    threshold: 1n,
    operatorIsSigner: true,
    blockTimestamp: 100n,
    ...overrides
  });
}

assert.deepEqual(governance().mismatches, []);
assert.deepEqual(governance({ transactionCount: 1n, transactions: [proposal()] }).mismatches, []);
assert.match(governance({ configurationEpoch: 2n }).mismatches.join(";"), /configuration epoch/);
assert.match(governance({ signerCount: 2n }).mismatches.join(";"), /signer count/);
assert.match(governance({ threshold: 2n }).mismatches.join(";"), /threshold/);
assert.match(governance({ operatorIsSigner: false }).mismatches.join(";"), /Governance signer/);
assert.match(governance({
  transactionCount: 1n,
  transactions: [proposal({ configurationEpoch: 0n })]
}).mismatches.join(";"), /Unrecognized governance proposal/);
assert.match(governance({
  transactionCount: 1n,
  transactions: [proposal({ confirmations: 0n })]
}).mismatches.join(";"), /Unrecognized governance proposal/);
assert.match(governance({
  transactionCount: 1n,
  transactions: [proposal({ executeBefore: 500n })]
}).mismatches.join(";"), /Unrecognized governance proposal/);
assert.match(governance({
  transactionCount: 1n,
  transactions: [proposal({ executed: true, cancelled: true })]
}).mismatches.join(";"), /Unrecognized governance proposal/);
assert.match(governance({
  transactionCount: 1n,
  transactions: [proposal({ data: "0xdeadbeef" as Hex })]
}).mismatches.join(";"), /Unrecognized governance proposal/);
assert.match(governance({
  transactionCount: 2n,
  transactions: [proposal(), proposal({ id: 1n })]
}).mismatches.join(";"), /proposal count/);

const unavailable = unavailableConsentRehearsalStatus();
assert.equal(unavailable.ok, false);
assert.equal(unavailable.integrity, "unavailable");
assert.equal(unavailable.activationState, "unavailable");
assert.equal(unavailable.live.paused, null);
assert.equal(unavailable.live.sessionIdle, null);
assert.equal(getConsentRehearsalProofMode(unavailable), "unavailable");
const verifiedPaused = {
  ...unavailable,
  ok: true,
  integrity: "verified",
  activationState: "paused",
  live: { ...unavailable.live, paused: true }
} satisfies ConsentRehearsalStatus;
const proofNow = Date.parse(verifiedPaused.checkedAt);
assert.equal(isConsentRehearsalProofFresh(verifiedPaused, proofNow), true);
assert.equal(getConsentRehearsalProofMode(verifiedPaused, proofNow), "verified");
assert.equal(getConsentRehearsalProofMode({
  ...verifiedPaused,
  activationState: "active",
  live: { ...verifiedPaused.live, paused: false }
}, proofNow), "active");
assert.equal(getConsentRehearsalProofMode({
  ...verifiedPaused,
  activationState: "paused",
  live: { ...verifiedPaused.live, paused: false }
}, proofNow), "attention");
assert.equal(getConsentRehearsalProofMode({
  ...verifiedPaused,
  ok: false,
  integrity: "mismatch"
}, proofNow), "attention");
assert.equal(
  getConsentRehearsalProofMode(verifiedPaused, proofNow + CONSENT_REHEARSAL_PROOF_MAX_AGE_MS + 1),
  "unavailable"
);
assert.equal(
  getConsentRehearsalProofMode(verifiedPaused, proofNow - CONSENT_REHEARSAL_PROOF_MAX_FUTURE_SKEW_MS - 1),
  "unavailable"
);
assert.equal(getConsentRehearsalProofMode({ ...verifiedPaused, checkedAt: "not-a-date" }, proofNow), "unavailable");

const route = fs.readFileSync(new URL("../../app/api/rescue/status/route.ts", import.meta.url), "utf8");
assert.match(route, /sharedMaxAgeSeconds: 10/);
assert.match(route, /status: 503/);
assert.match(route, /Cache-Control": "no-store"/);
assert.doesNotMatch(route, /staleIfErrorSeconds/);

const reader = fs.readFileSync(new URL("./consent-rehearsal-status.ts", import.meta.url), "utf8");
assert.match(reader, /blockNumber/g);
assert.match(reader, /MAX_REVIEWED_GOVERNANCE_PROPOSALS = 1n/);
assert.match(reader, /EXPECTED_GOVERNANCE_EXECUTION_WINDOW/);
assert.match(reader, /RMT_CONSENT_TESTNET_RPC_URL/);
assert.doesNotMatch(reader, /privateKey|walletClient|writeContract/);

const proof = fs.readFileSync(new URL("../../app/rescue/rehearsal-proof.tsx", import.meta.url), "utf8");
assert.match(proof, /refreshSequence/);
assert.match(proof, /sequence !== refreshSequence\.current/);
assert.match(proof, /FETCH_TIMEOUT_MS/);
assert.match(proof, /visibilitychange/);
assert.match(proof, /VERIFIED · ACTIVE · TESTNET REHEARSAL/);

console.info("Consent rehearsal public status smoke test passed");
