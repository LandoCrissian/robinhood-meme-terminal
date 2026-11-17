import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { MOBILE_DELEGATE_POLICY } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { buildFixedSupplyInput, compileFixedSupplyProfile } from "./fixed-supply-profile.mjs";
import { mobilePayer, pinnedSafeCreationRows, safeProxyRuntimeHash } from "./mobile-review-plan.mjs";
import { buildProtocolContinuation, operationsCreationHash, observeProtocolContinuation,
  validateProtocolContinuationEvidence } from "./prepare-protocol-continuation.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeAbiParameters, getContractAddress, keccak256, padHex, zeroHash } = require("viem");
const profile = JSON.parse(readFileSync(new URL("../../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url)));
const safe = JSON.parse(readFileSync(new URL("../../../docs/evidence/rmt-task045/operations-safe-policy.json", import.meta.url))).operations;
const plans = pinnedSafeCreationRows();
const now = Date.parse("2026-11-17T18:00:00Z");
const anchor = { number: "116770000", hash: "0x" + "aa".repeat(32), blockTimeUtc: new Date(now - 1_000).toISOString() };
const providers = ["official", "pocket"];
const ids = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"];

// Deterministic synthetic observation for validation tests; never a mainnet receipt or release approval.
function fixture() {
  const state = { runtimeHash: safeProxyRuntimeHash, singleton: safe.singleton, version: "1.4.1", owners: safe.owners,
    threshold: "2", nonce: "0", modules: [], moduleNext: "0x0000000000000000000000000000000000000001",
    handler: padHex(safe.setup.fallbackHandler, { size: 32 }), guard: zeroHash };
  return structuredClone({ chainId: 4663, observedAt: new Date(now).toISOString(), broadcastAuthorized: false, anchor, providers,
    sender: { status: "OBSERVED", anchor, accountType: "EIP_7702_DELEGATION", nonceSynchronized: true,
      confirmedNonce: "478", pendingNonce: "478", delegation: { ...MOBILE_DELEGATE_POLICY, status: "PINNED_RUNTIME" } },
    safeReceipts: plans.map((plan, index) => ({ status: "L2_CREATION_VERIFIED", chainId: 4663,
      role: index === 0 ? "RMT-OPERATIONS" : "RMT-RESERVE", safe: plan.expectedAddress,
      hash: index === 0 ? operationsCreationHash : "0x" + "bb".repeat(32), receiptBlock: "116760000", blockHash: "0x" + "cc".repeat(32),
      logIndex: "0", finality: "L1_UNVERIFIED", broadcastAuthorized: false,
      initializationEvidence: { mode: "FRESH_ARCHIVE_STATE_AND_CANONICAL_RECEIPT", archiveProvider: "pocket", canonicalProvider: "official" },
      transactionIdentity: { hash: index === 0 ? operationsCreationHash : "0x" + "bb".repeat(32), chainId: "4663",
        from: mobilePayer, to: plan.to, inputHash: plan.dataHash, valueWei: "0", nonce: String(476 + index),
        blockNumber: "116760000", blockHash: "0x" + "cc".repeat(32) } })),
    safeCurrent: plans.map((plan, index) => ({ role: index === 0 ? "RMT-OPERATIONS" : "RMT-RESERVE",
      safe: plan.expectedAddress, anchor, providers, state })),
    dependencies: profile.externalRuntimePins,
    dependencyWitnesses: providers.map((provider) => ({ provider, anchor, runtimePins: profile.externalRuntimePins })),
    governanceOwners: safe.owners, governanceAccountsCodeEmpty: true,
    destinations: ids.map((id, index) => ({ id, nonce: String(478 + index),
      address: getContractAddress({ from: mobilePayer, nonce: BigInt(478 + index) }), code: "0x", accountNonce: "0",
      pendingCode: "0x", pendingAccountNonce: "0", providers })),
  });
}

test("continuation starts at the actual current nonce after both Safe creations, with no stale +2 offset", () => {
  const evidence = fixture();
  assert.equal(validateProtocolContinuationEvidence(evidence, now), evidence);
  assert.equal(evidence.destinations[0].nonce, evidence.sender.pendingNonce);
  const wrong = fixture();
  wrong.destinations = wrong.destinations.map((row, index) => ({ ...row, nonce: String(480 + index),
    address: getContractAddress({ from: mobilePayer, nonce: BigInt(480 + index) }) }));
  assert.throws(() => validateProtocolContinuationEvidence(wrong, now));
});

test("missing, wrong, unconfirmed and swapped treasury receipts cannot become protocol beneficiaries", () => {
  for (const mutate of [
    (e) => e.safeReceipts.pop(), (e) => e.safeReceipts.reverse(),
    (e) => { e.safeReceipts[1].status = "PENDING"; },
    (e) => { e.safeReceipts[1].hash = operationsCreationHash; },
    (e) => { e.safeReceipts[0].hash = "0x" + "dd".repeat(32); },
    (e) => { e.safeReceipts[1].safe = mobilePayer; },
    (e) => { e.safeReceipts[1].chainId = 31337; },
    (e) => { e.safeReceipts[1].receiptBlock = "116780000"; },
    (e) => { e.safeReceipts[1].blockHash = zeroHash; },
    (e) => { e.safeReceipts[1].transactionIdentity.inputHash = zeroHash; },
    (e) => { e.safeReceipts[1].transactionIdentity.from = safe.owners[0]; },
    (e) => { e.safeReceipts[1].transactionIdentity.valueWei = "1"; },
    (e) => { e.safeReceipts[1].initializationEvidence.mode = "PRESERVED_OPERATOR_ASSERTION"; },
  ]) { const evidence = fixture(); mutate(evidence); assert.throws(() => validateProtocolContinuationEvidence(evidence, now)); }
});

test("changed Safe permissions, owner set, singleton, guard, module, handler or usage halt deployment preparation", () => {
  for (const [field, value] of Object.entries({ runtimeHash: zeroHash, singleton: mobilePayer, version: "1.3.0", threshold: "1",
    nonce: "1", owners: [safe.owners[0], safe.owners[0], safe.owners[2]], modules: [mobilePayer],
    moduleNext: mobilePayer, handler: zeroHash, guard: padHex(mobilePayer, { size: 32 }) })) {
    const evidence = fixture(); evidence.safeCurrent[1].state[field] = value;
    assert.throws(() => validateProtocolContinuationEvidence(evidence, now), field);
  }
});

test("pending sender use, delegation changes, stale anchors, wrong chain and provider disagreement fail closed", () => {
  for (const mutate of [
    (e) => { e.sender.pendingNonce = "479"; }, (e) => { e.sender.nonceSynchronized = false; },
    (e) => { e.sender.delegation.runtimeHash = zeroHash; }, (e) => { e.sender.delegation.designator = "0x"; },
    (e) => { e.sender.delegation.status = "UNVERIFIED"; }, (e) => { e.chainId = 31337; },
    (e) => { e.anchor.hash = zeroHash; }, (e) => { e.anchor.blockTimeUtc = new Date(now - 181_000).toISOString(); },
    (e) => { e.observedAt = new Date(now + 60_000).toISOString(); },
    (e) => { e.dependencyWitnesses[1].runtimePins.poolManager.runtimeHash = zeroHash; },
    (e) => { e.providers = ["official", "official"]; },
    (e) => { e.governanceAccountsCodeEmpty = false; },
  ]) { const evidence = fixture(); mutate(evidence); assert.throws(() => validateProtocolContinuationEvidence(evidence, now)); }
});

test("occupied canonical or pending CREATE destinations, nonce drift and swapped transaction order are rejected", () => {
  for (const mutate of [
    (e) => { e.destinations[0].code = "0x00"; }, (e) => { e.destinations[0].accountNonce = "1"; },
    (e) => { e.destinations[0].pendingCode = "0x00"; }, (e) => { e.destinations[0].pendingAccountNonce = "1"; },
    (e) => { e.destinations[0].address = e.destinations[1].address; }, (e) => e.destinations.reverse(),
    (e) => { e.destinations[0].providers = ["official"]; },
  ]) { const evidence = fixture(); mutate(evidence); assert.throws(() => validateProtocolContinuationEvidence(evidence, now)); }
});

test("missing Reserve hash stops before any RPC; no unsigned fixture may substitute for its real receipt", async () => {
  let calls = 0;
  const readers = { official: async () => { calls++; }, pocket: async () => { calls++; } };
  for (const reserveHash of [undefined, zeroHash, operationsCreationHash, "0x1234"]) {
    await assert.rejects(observeProtocolContinuation({ reserveHash, readers }));
  }
  assert.equal(calls, 0);
});

const solc = process.env.RMT_CONTINUATION_TEST_SOLC;
test("pinned real 4663 bytecode yields five exact constructors, locked treasury identities and four gated governance actions", {
  skip: !solc && "Set RMT_CONTINUATION_TEST_SOLC and RMT_CONTINUATION_TEST_LIB to exercise the checksum-pinned compiler",
}, () => {
  const options = { solc, lib: process.env.RMT_CONTINUATION_TEST_LIB, chainId: 4663, includeImmutableNames: true };
  const { input } = buildFixedSupplyInput(options);
  const compilation = compileFixedSupplyProfile(options);
  const plan = buildProtocolContinuation(compilation, input, fixture(), { now });
  assert.deepEqual(plan.constructors.map(({ id, nonce }) => [id, nonce]), ids.map((id, index) => [id, String(478 + index)]));
  assert.equal(plan.constructors.length, 5);
  assert.equal(plan.tokenCreation, null);
  assert.equal(plan.broadcastAuthorized, false);
  assert.equal(plan.signingAuthorized, false);
  assert.equal(plan.security.strictGate, "FAIL_HIGH");
  assert.equal(plan.security.highFindings, 22);
  assert.equal(plan.finality, "L2_CORROBORATED_L1_FINALITY_UNVERIFIED");
  for (const row of plan.constructors) {
    assert.equal(row.unsigned.from, mobilePayer);
    assert.equal(row.unsigned.value, "0x0");
    assert.equal(row.unsigned.chainId, "0x1237");
    assert.equal(row.unsigned.data, row.initcode);
    assert.equal(keccak256(row.unsigned.data), row.initcodeHash);
    assert.equal(row.fees, null);
    assert.ok(row.initcodeBytes <= 49_152 && row.runtimeBytes <= 24_576);
    assert.equal(row.unsigned.to, undefined);
  }
  const factory = plan.bootstrapChildren[2];
  const factoryAbi = compilation.artifacts.RMTLaunchCurveFactoryV2.abi.find(({ type }) => type === "constructor");
  const factoryArgs = decodeAbiParameters(factoryAbi.inputs, factory.constructorData);
  assert.equal(factoryArgs[1], plans[0].expectedAddress);
  assert.equal(factoryArgs[2], plans[1].expectedAddress);
  assert.equal(factoryArgs.at(-1), 400_000_000_000_000n);
  assert.equal(BigInt(plan.bootstrapChildren[0].address) & 0x3fffn, 0x2000n);
  assert.deepEqual(plan.governanceActions.map(({ id }) => id), ["schedule-factory", "execute-factory", "schedule-migration-template", "execute-migration-template"]);
  for (const action of plan.governanceActions) {
    assert.equal(action.noticeSeconds, 172_800);
    assert.equal(action.requiredSigners, 2);
    assert.equal(action.domain.verifyingContract, plan.constructors[0].address);
    for (const field of ["actionNonce", "signerSetEpoch", "deadline", "signatures", "data", "scheduledDigest", "executeAfter"]) assert.equal(action[field], null);
  }
  const broken = structuredClone(compilation);
  broken.artifacts.RMTLaunchCurveFactoryV2.bytecode += "00";
  assert.throws(() => buildProtocolContinuation(broken, input, fixture(), { now }), /artifact differs/);
  assert.throws(() => buildProtocolContinuation(compilation, input + " ", fixture(), { now }));
});
