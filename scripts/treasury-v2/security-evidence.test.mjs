import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

const repository = new URL("../../", import.meta.url);
const directory = new URL("docs/evidence/rmt-task077/security/", repository);
const bytes = url => readFileSync(url);
const sha = value => createHash("sha256").update(value).digest("hex");
const read = url => JSON.parse(bytes(url));
const register = read(new URL("disposition.json", directory));
const rawV1 = gunzipSync(bytes(new URL(register.v1.rawReport, directory)));
const rawV2 = gunzipSync(bytes(new URL(register.v2Prototype.rawReport, directory)));
const v1 = JSON.parse(rawV1), v2 = JSON.parse(rawV2);
const highs = report => report.detectors.filter(finding => finding.impact === "High");

test("six independently reproduced V1 findings retain exact IDs, dataflow and failed gate", () => {
  const original = JSON.parse(gunzipSync(bytes(new URL("docs/evidence/rmt-task076/slither-current.json.gz", repository))));
  assert.equal(sha(rawV1), register.v1.rawSha256);
  assert.equal(v1.inputSha256, original.inputSha256);
  assert.equal(v1.inputSha256, register.v1.inputSha256);
  assert.equal(v1.detectorCount, 101);
  assert.deepEqual(highs(v1).map(row => row.id).sort(), highs(original).map(row => row.id).sort());
  assert.deepEqual(register.v1.rows.map(row => row.id).sort(), highs(v1).map(row => row.id).sort());
  assert.equal(register.v1.rows.length, 6);
  assert.equal(register.v1.strictGateExit, 1);
  for (const row of register.v1.rows) {
    const finding = highs(v1).find(item => item.id === row.id);
    assert.equal(row.detector, finding.check);
    assert.equal(row.severity, "High");
    assert.equal(row.cleared, false);
    assert.equal(row.sourceChanged, false);
    assert.match(row.disposition, /UNRESOLVED_GATE$/);
    assert.ok(finding.description.includes(row.balanceVariable));
    assert.ok(row.assertionLines.length > 0 && row.externalCallLine > 0);
    const [path, name] = row.test.split("::");
    assert.match(bytes(new URL(path, repository)).toString(), new RegExp("function " + name + "\\("));
  }
});

test("new nonspending prototype report is separate from unchanged core and V1 findings", () => {
  assert.equal(sha(rawV2), register.v2Prototype.rawSha256);
  assert.equal(v2.inputSha256, register.v2Prototype.inputSha256);
  assert.equal(v2.detectorCount, 101);
  assert.equal(v2.sources, 3);
  assert.equal(highs(v2).length, 0);
  assert.equal(v2.detectors.length, 3);
  assert.equal(register.v2Prototype.v1FindingsRemediated, false);
  assert.equal(register.v2Prototype.executable, false);
  assert.equal(register.v2Prototype.canInheritV1Credits, false);
  const baseline = register.originalCoreBaseline;
  const compressed = bytes(new URL(baseline.artifact, repository));
  assert.equal(sha(compressed), baseline.compressedSha256);
  const core = JSON.parse(gunzipSync(compressed));
  assert.equal(highs(core).length, 22);
  assert.deepEqual(highs(core).map(row => row.id).sort(), baseline.highIds);
  assert.equal(baseline.sourceChanged, false);
  assert.equal(baseline.dispositionChanged, false);
});

test("reviewed exact sources, including the new prototype and hostile tests, match retained hashes", () => {
  for (const [path, expected] of register.sourceSha256) {
    const normalized = bytes(new URL(path, repository)).toString().replaceAll("\r\n", "\n");
    assert.equal(sha(normalized), expected, "Stale security evidence for " + path);
  }
  assert.equal(register.tools.slither, "0.11.5");
  assert.equal(register.tools.cryticCompile, "0.3.11");
  assert.equal(register.independentAudit, false);
  assert.equal(register.broadcast, false);
  assert.equal(register.productionChanges, false);
  assert.equal(register.status, "BLOCKED_NO_BROADCAST");
});

test("retained actual Foundry output contains every new counterfactual test and 512 fuzz runs", () => {
  const log = bytes(new URL("foundry-disposition.log", directory)).toString();
  for (const name of register.newFoundry.tests) assert.ok(log.includes("[PASS] " + name + "("), name);
  assert.match(log, /13 passed; 0 failed; 0 skipped/);
  assert.match(log, /runs: 512/);
  assert.equal(register.newFoundry.tests.length, 13);
  assert.equal(register.newFoundry.failed, 0);
  assert.equal(register.newFoundry.skipped, 0);
  assert.match(register.newFoundry.fixture, /counterfactual/);
});
