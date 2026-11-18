import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("./", import.meta.url);
const read = file => JSON.parse(readFileSync(new URL(file, root), "utf8"));
const manifest = read("acceptance.json");

test("Task075 evidence hashes match the complete Git-normalized review package", () => {
  const names = readdirSync(root).filter(name => name !== "acceptance.json" && !name.endsWith(".test.mjs")).sort();
  assert.deepEqual(manifest.evidenceHashes.map(entry => entry.file).sort(), names);
  for (const entry of manifest.evidenceHashes) {
    assert.match(entry.file, /^[a-z0-9-]+\.(?:json|png)$/);
    const raw = readFileSync(new URL(entry.file, root));
    // Git stores text with LF; a Windows checkout may materialize CRLF. Binary
    // screenshots are hashed unchanged. No report content is reserialized.
    const bytes = entry.file.endsWith(".json") ? Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n")) : raw;
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.file);
  }
});

test("Task075 reported acceptance remains synthetic and cannot clear production release holds", () => {
  assert.equal(manifest.release, "BLOCKED_NO_BROADCAST");
  assert.equal(manifest.productionExecution, false); assert.equal(manifest.productionChanged, false);
  assert.equal(manifest.retainedSecurity.highFindings, 22);
  assert.deepEqual(manifest.retainedSecurity.failedStaticGates, ["slither", "fixed-supply-4663"]);
  assert.equal(manifest.physicalIphoneClaims, "not performed");
  for (const engine of ["chromium", "webkit"]) {
    const browser = read(engine + "-browser.json"), core = read(engine + "-core.json");
    assert.equal(browser.status, "passed"); assert.equal(browser.chainId, 31337);
    assert.equal(browser.sends.length, 3); assert.equal(new Set(browser.sends.map(s => s.receipt.transactionHash)).size, 3);
    assert.equal(browser.recoveries.length, 11); assert.equal(browser.checks.walletConfirmationAttempts, 4);
    assert.equal(core.coreUniqueIncludingMigrationReceipts, 34); assert.equal(core.coreReceiptCount, 32);
    assert.equal(core.browserAdditionalReceipts, 3);
    for (const proof of browser.recoveries) {
      assert.notEqual(proof.stage, "settled"); assert.equal(proof.finality.productionPolicySupported, false);
    }
  }
});
