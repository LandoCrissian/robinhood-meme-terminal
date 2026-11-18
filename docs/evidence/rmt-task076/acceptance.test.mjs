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

test("both real synthetic journeys preserve receipt, recovery, custody and source boundaries", () => {
  const priorCompiler = JSON.parse(readFileSync(new URL("docs/evidence/rmt-task075/compiler-31337.json", root)));
  for (const browser of ["chromium", "webkit"]) {
    const core = json(browser + "-core.json"), ui = json(browser + "-browser.json");
    assert.equal(core.status, "passed"); assert.equal(core.chainId, 31337); assert.equal(core.productionExecution, false);
    assert.equal(core.sourceIdentity.commit, "378f3c0a88ff06020854ea156bbf6fed7b874f44");
    assert.equal(core.sourceIdentity.coreCompiler.inputSha256, priorCompiler.inputSha256);
    assert.equal(core.moduleCompiler.inputSha256, json("compiler-manifest.json").inputSha256);
    assert.equal(core.receipts.length, 48); assert.equal(core.receipts.filter(r => r.status === "success").length, 40);
    assert.equal(core.receipts.filter(r => r.status === "reverted").length, 8);
    assert.equal(core.safeExecutions.length, 9); assert.equal(core.purchaseTransactions, 0);
    assert.ok(Object.values(core.checks).every(value => value === true));
    assert.equal(core.insufficientGas.receipt.status, "reverted"); assert.equal(core.insufficientGas.receipt.gasUsed, "50000");
    assert.equal(core.insufficientGas.nonceAfter, core.insufficientGas.nonceBefore + 1);
    assert.equal(core.insufficientGas.creditUnchanged, true); assert.equal(core.insufficientGas.treasuryBalanceUnchanged, true);
    assert.equal(ui.status, "passed"); assert.equal(ui.sends.length, 4); assert.equal(ui.recoveries.length, 3);
    assert.equal(ui.completedCreationArchives.length, 2); assert.equal(ui.layouts.length, 7);
    assert.deepEqual(ui.pageErrors, []); assert.deepEqual(ui.externalRequests, []);
    assert.equal(ui.desktopRead.status, "ready"); assert.equal(ui.desktopRead.indexed, true);
    assert.equal(ui.desktopRead.walletInjected, false); assert.equal(ui.desktopRead.walletRequests, 0);
    assert.equal(core.dashboard.project.graduated, true); assert.equal(core.dashboard.purchases.available, false);
    assert.ok(BigInt(core.lpClaims.nativeWei) > 0n && BigInt(core.lpClaims.tokenWei) > 0n);
  }
});

test("retained Task076 runtime source matches its original journeys, independently of later authorized UI changes", () => {
  const manifest = json("runtime-source-manifest.json");
  assert.equal(manifest.executionSource, "378f3c0a88ff06020854ea156bbf6fed7b874f44");
  assert.equal(manifest.files.length, manifest.count); assert.ok(manifest.count > 100);
  // Task077 changes capability wording/validation. Preserve the exact original
  // source rather than falsely attributing the old receipts to the new UI.
  // All 190 original bytes are retained, hash-bound and individually checked.
  const archivedBytes = readFileSync(new URL("../rmt-task077/task076-runtime-source.json.gz", import.meta.url));
  assert.equal(digest(archivedBytes), "ffe0f941982ba029c8bfa018dc8e10d51e59c7fca57a02e55006a9d2568fb9ae");
  const archived = JSON.parse(gunzipSync(archivedBytes));
  assert.equal(archived.base, "ecf3998f6e9b556c000de5c48908e4fb0b363fc8");
  assert.equal(archived.executionSource, manifest.executionSource);
  assert.equal(archived.files.length, manifest.count);
  const retained = new Map(archived.files.map(file => [file.path, file.content]));
  assert.equal(retained.size, manifest.count);
  for (const file of manifest.files) {
    assert.ok(retained.has(file.path));
    assert.equal(digest(retained.get(file.path)), file.sha256, file.path);
  }
  for (const file of json("files.sha256.json").files) {
    assert.ok(/^[a-zA-Z0-9._/-]+$/.test(file.path) && !file.path.startsWith("/") && !file.path.includes(".."));
    assert.equal(digest(readFileSync(new URL(file.path, import.meta.url))), file.sha256, file.path);
  }
});
