import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

const root = new URL("../../../", import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const normalized = path => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");

test("Task076 preserves every Task075 Solidity source and adds a separate complete module closure", () => {
  const frozen = json("frozen-source-manifest.json"), manifest = json("compiler-manifest.json");
  assert.equal(frozen.baseline, "51e0ee874b635f1e104a40ff6419af3b5659fb90");
  assert.equal(frozen.files.length, 36); assert.equal(frozen.count, frozen.files.length);
  for (const file of frozen.files) assert.equal(digest(normalized(file.path)), file.sha256, file.path);
  assert.equal(manifest.coreModified, false); assert.equal(manifest.status, "BLOCKED_NO_BROADCAST");
  assert.equal(manifest.broadcastAuthorized, false); assert.deepEqual(manifest.transformations, []);
  const input = gunzipSync(readFileSync(new URL("compiler-input.json.gz", import.meta.url)));
  assert.equal(digest(input), manifest.inputSha256);
  const parsed = JSON.parse(input);
  assert.equal(manifest.sourceCount, 3);
  assert.deepEqual(Object.keys(parsed.sources).sort(), manifest.roots);
  for (const [path, expected] of manifest.sourceSha256) {
    assert.equal(digest(normalized("packages/contracts/" + path)), expected);
    assert.equal(digest(parsed.sources[path].content), expected);
    assert.doesNotMatch(parsed.sources[path].content, /slither-disable|slither-disable-next-line/);
  }
});
test("new-module size evidence stays separate from unchanged core bootstrap measurements", () => {
  const m = json("compiler-manifest.json");
  assert.equal(m.compilerVersion, "0.8.26+commit.8a97fa7a");
  assert.equal(m.compilerSettings.evmVersion, "cancun"); assert.equal(m.compilerSettings.viaIR, true);
  const factory = m.templates.RMTProjectTreasuryFactoryV1, treasury = m.templates.RMTProjectTreasuryV1;
  assert.equal(factory.runtimeBytes, 1881); assert.equal(treasury.runtimeBytes, 22705);
  assert.equal(factory.creationBytes, 26100); assert.equal(treasury.creationBytes, 23377);
  for (const item of [factory, treasury]) assert.ok(item.runtimeBytes < 24576);
  assert.ok(factory.creationBytes + 5 * 32 < 49152); assert.ok(treasury.creationBytes + 9 * 32 < 49152);
});
test("all-detector reports retain the new highs and never represent a passing strict gate", () => {
  const initial = JSON.parse(gunzipSync(readFileSync(new URL("slither-initial.json.gz", import.meta.url))));
  const current = JSON.parse(gunzipSync(readFileSync(new URL("slither-current.json.gz", import.meta.url))));
  for (const report of [initial, current]) { assert.equal(report.detectorCount, 101); assert.equal(report.tool, "Slither 0.11.5"); }
  assert.equal(current.inputSha256, json("compiler-manifest.json").inputSha256);
  assert.equal(initial.detectors.filter(v => v.impact === "High").length, 7);
  const highs = current.detectors.filter(v => v.impact === "High");
  assert.equal(current.detectors.length, 25); assert.equal(highs.length, 6);
  assert.ok(highs.every(v => v.check === "reentrancy-balance"));
  assert.ok(initial.detectors.some(v => v.check === "encode-packed-collision"));
  assert.ok(!current.detectors.some(v => v.check === "encode-packed-collision"));
});
