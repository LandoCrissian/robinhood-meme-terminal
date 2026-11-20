import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {validateSourceBindings, validateRuntimeObservation, validateLocalPermit2Binding, verifyConservation, verifyCanonicalLiveRuntimes} from "./graduation-proof.mjs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const report = JSON.parse(read("docs/evidence/rmt-task090/graduation/runtime-observation.json"));
const registry = JSON.parse(read("docs/evidence/rmt-task089/security/stage-dispositions.json"));
const clone = value => structuredClone(value);
const canonical = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/rmt-task090/graduation/canonical-three-artifacts.json.gz", import.meta.url))));

test("binds the exact eleven IDs and unchanged first-party source", () => {
  assert.equal(validateSourceBindings().findingIds.length, 11);
  assert.equal(validateSourceBindings().rawHighCount, 22);
});
for (const [label, change] of [
  ["unknown ID", s => { s.findings.find(x => x.group === "position-funding").id = "0".repeat(64); }],
  ["missing ID", s => { s.findings = s.findings.filter(x => x.id !== s.findings.find(y => y.group === "position-funding").id); }],
  ["duplicate ID", s => { s.findings.push(clone(s.findings.find(x => x.group === "position-funding"))); }],
]) test("rejects " + label, () => {
  const s = clone(registry); change(s);
  assert.throws(() => validateSourceBindings({register: s}));
});
for (const target of ["RMTLaunchBondingCurveV1.sol", "RMTV4CurveGraduationV1.sol", "RMTV4CurveInitializationGuardV1.sol", "RMTLaunchCurveTokenV2.sol"]) {
  test("rejects altered first-party bytes: " + target, () => {
    assert.throws(() => validateSourceBindings({read: path => read(path) + (path.endsWith(target) ? "\n// mutation" : "")}));
  });
}
test("binds both canonical witnesses and embedded local Permit2 byte-for-byte", () => {
  assert.equal(validateRuntimeObservation(report), true);
  assert.equal(validateLocalPermit2Binding(report).runtimeHash, report.witnesses.official.contracts.permit2.runtimeHash);
});
for (const [label, change] of [
  ["chain", r => { r.chainId = 31337; }],
  ["missing witness", r => { delete r.witnesses.pocket; }],
  ["canonical hash", r => { r.witnesses.pocket.blockHash = "0x" + "01".repeat(32); }],
  ["post-read reorg", r => { r.witnesses.official.recheckedBlockHash = "0x" + "01".repeat(32); }],
  ["runtime bytes", r => { r.witnesses.official.contracts.permit2.code += "00"; }],
  ["runtime hash", r => { r.witnesses.official.contracts.positionManager.runtimeHash = "0x" + "00".repeat(32); }],
  ["runtime target", r => { r.witnesses.pocket.contracts.poolManager.address = "0x" + "00".repeat(20); }],
]) test("rejects changed " + label, () => {
  const r = clone(report); change(r); assert.throws(() => validateRuntimeObservation(r));
});
test("rejects embedded Permit2 substitution", () => {
  const source = read("packages/contracts/test/Task090GraduationProof.t.sol");
  assert.throws(() => validateLocalPermit2Binding(report, source.replace('return hex"', 'return hex"00')));
});
test("canonical compiler bytes materialize all three fresh deployed first-party runtimes", () => {
  const result = verifyCanonicalLiveRuntimes(canonical, report);
  assert.equal(result.runtimeBindings.length, 3);
  assert.equal(result.productionExecutionTested, false);
  assert.equal(result.financialActivationAuthorized, false);
});
for (const [label, change] of [
  ["chain", c => { c.manifest.chainId = 31337; }],
  ["compiler input", c => { c.manifest.inputSha256 = "0".repeat(64); }],
  ["compiler settings", c => { c.manifest.compilerSettings.optimizer.runs++; }],
  ["source pin", c => { c.manifest.sourceSha256[0][1] = "0".repeat(64); }],
  ["immutable field identity", c => {
    const used = Object.keys(c.artifacts.RMTV4CurveGraduationV1.immutableOffsets)[0];
    c.immutableNames.find(([id]) => String(id) === used)[1] = "unrecognized";
  }],
  ...["RMTV4CurveInitializationGuardV1", "RMTV4CurveGraduationV1", "RMTLaunchCurveFactoryV2"].map(name =>
    [name + " runtime bytes", c => { c.artifacts[name].runtime = "0x00" + c.artifacts[name].runtime.slice(4); }]),
]) test("canonical correspondence rejects altered " + label, () => {
  const c = clone(canonical); change(c); assert.throws(() => verifyCanonicalLiveRuntimes(c, report));
});
const conservation = () => ({nativeBefore: [100, 3, 5, 7, 11, 13, 17, 19], nativeAfter: [50, 3, 55, 7, 11, 13, 17, 19],
  tokenBefore: [1000, 3, 5, 7, 11, 13, 17, 19], tokenAfter: [500, 3, 505, 7, 11, 13, 17, 19],
  nativeUsed: 50, tokenUsed: 500, liquidity: 1, positionId: 1});
test("independent per-account oracle accepts exact debit and exact PoolManager credit", () => assert.equal(verifyConservation(conservation()), true));
for (const [label, change] of [
  ["native diversion with same total", r => { r.nativeAfter[2]--; r.nativeAfter[7]++; }],
  ["token diversion with same total", r => { r.tokenAfter[2]--; r.tokenAfter[7]++; }],
  ["engine short credit", r => { r.tokenAfter[1]++; }],
  ["prefunded manager neutralization", r => { r.tokenAfter[2] = r.tokenBefore[2]; }],
  ["extra curve debit", r => { r.nativeAfter[0]--; }],
  ["missing account", r => { r.nativeAfter.pop(); }],
  ["zero position", r => { r.positionId = 0; }],
  ["negative amount", r => { r.nativeBefore[0] = -1; }],
]) test("conservation oracle rejects " + label, () => {
  const r = conservation(); change(r); assert.throws(() => verifyConservation(r));
});
