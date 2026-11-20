import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {extractConservationVector, validateFixtureProfile, validateRuntimeObservation, validateSourceBindings,
  verifyConservationVector} from "./migration-proof.mjs";

const json = path => JSON.parse(readFileSync(new URL("../../" + path, import.meta.url), "utf8"));
const observation = json("docs/evidence/rmt-task090/migration/runtime-observation.json");
const fixture = json("packages/contracts/test/fixtures/task090-migration-profile.json");
const register = json("docs/evidence/rmt-task089/security/stage-dispositions.json");
const fresh = value => structuredClone(value);

test("six exact migration IDs bind all 16 first-party and 50 dependency sources", () => {
  const result = validateSourceBindings();
  assert.equal(result.findingIds.length, 6);
  assert.equal(result.sources.length, 16);
  assert.equal(result.dependencies.length, 50);
  assert.equal(result.strictScannerGateChanged, false);
});

test("missing, duplicated or substituted finding IDs reject", () => {
  const index = register.findings.findIndex(row => row.group === "asset-bearing-migration");
  for (const mutation of [copy => copy.findings.splice(index, 1),
    copy => copy.findings.push(copy.findings[index]), copy => copy.findings[index].id = "0".repeat(64)]) {
    const copy = fresh(register); mutation(copy);
    assert.throws(() => validateSourceBindings({register: copy}));
  }
});

test("first-party or pinned dependency drift rejects", () => {
  const read = path => readFileSync(new URL("../../packages/contracts/" + path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const changed of ["src/RMTLaunchBondingCurveV1.sol", "lib/v4-core/src/interfaces/IPoolManager.sol"])
    assert.throws(() => validateSourceBindings({read: path => read(path) + (path === changed ? "\n// drift" : "")}));
});

test("nine exact canonical creation bytecodes and token runtime retain 4663 economics", () => {
  assert.equal(validateFixtureProfile(fixture), true);
  assert.equal(fixture.manifest.terms.graduationBackingWei, "2000000000000000000");
  assert.equal(fixture.manifest.terms.fixedSupplyWei, "1000000000000000000000000000");
});

test("fixture byte drift, missing bytecode and changed chain/economics reject", () => {
  for (const mutation of [copy => copy.creationCode.RMTLaunchCurveFactoryV2 += "00",
    copy => delete copy.creationCode.RMTLaunchCurveSuccessorDeployerV1,
    copy => copy.runtimeCode.RMTLaunchCurveTokenV2 += "00",
    copy => copy.manifest.chainId = 31337, copy => copy.manifest.terms.graduationBackingWei = "1000000000000000000"]) {
    const copy = fresh(fixture); mutation(copy);
    assert.throws(() => validateFixtureProfile(copy));
  }
});

test("two canonical witnesses bind exact deployed migration runtimes and 18 read-only RPCs", () => {
  assert.equal(validateRuntimeObservation(observation), true);
  assert.equal(observation.rpcCalls.length, 18);
});

test("equal declared hash cannot conceal changed or truncated runtime bytes", () => {
  for (const mutation of [copy => copy.witnesses.official.contracts.factory.code += "00",
    copy => copy.witnesses.pocket.contracts.successorV2.code = "0x00"]) {
    const copy = fresh(observation); mutation(copy);
    assert.throws(() => validateRuntimeObservation(copy));
  }
});

test("chain, canonical recheck, RPC scope or signing changes reject", () => {
  for (const mutation of [copy => copy.witnesses.pocket.chainId = "0x7a69",
    copy => copy.witnesses.official.recheckedBlockHash = "0x" + "0".repeat(64),
    copy => copy.rpcCalls.push({provider: "official", method: "eth_call", params: []}),
    copy => copy.signing = true, copy => copy.transactions = true]) {
    const copy = fresh(observation); mutation(copy);
    assert.throws(() => validateRuntimeObservation(copy));
  }
});

test("exact integer vector binds conserved assets, already-earned claims and each final payout", () => {
  const vector = json("docs/evidence/rmt-task090/migration/conservation-vector.json");
  assert.equal(verifyConservationVector(vector), true);
  const log = readFileSync(new URL("../../docs/evidence/rmt-task090/migration/foundry-canonical-4663.log", import.meta.url), "utf8");
  assert.deepEqual(extractConservationVector(log), vector);
  assert.equal(vector.phases[0].balances[0], "297000000000000091", "No JS number rounding permitted");
  for (const mutation of [copy => copy.phases[1].balances[0] = "90",
    copy => copy.phases[1].claimable[1] = "1", copy => copy.phases[2].beneficiaryNative[3] = "0",
    copy => copy.phases[0].canonicalBytecodes = false,
    copy => copy.phases[0].graduationBackingWei = "1000000000000000000"]) {
    const copy = fresh(vector); mutation(copy);
    assert.throws(() => verifyConservationVector(copy));
  }
  const ordinary = readFileSync(new URL("../../docs/evidence/rmt-task090/migration/foundry-default-31337.log", import.meta.url), "utf8");
  assert.throws(() => extractConservationVector(ordinary), "Default-profile evidence must not be relabeled canonical4663");
});
