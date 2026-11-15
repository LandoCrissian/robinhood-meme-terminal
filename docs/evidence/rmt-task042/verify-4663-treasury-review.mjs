import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [checkout, solc] = process.argv.slice(2);
assert.ok(checkout && solc && process.argv.length === 4,
  "Usage: node verify-4663-treasury-review.mjs /path/to/exact-594 /path/to/pinned-solc");
const manifest = JSON.parse(readFileSync(new URL("4663-treasury-review-manifest.json", import.meta.url), "utf8"));
const historical = new URL("../rmt-task039/", import.meta.url);
const contractTree = "packages/contracts/src";
const harnessPath = "packages/contracts/scripts/validate-curve-graduation-4663.mjs";
const git = (...args) => execFileSync("git", args, { cwd: resolve(checkout), encoding: "utf8" }).trim();

assert.equal(manifest.profile, "rmt-curve-v1-4663-treasury-review-v1");
assert.equal(manifest.chainId, 4663);
assert.equal(manifest.status, "BLOCKED_NO_BROADCAST");
assert.equal(manifest.broadcastAuthorized, false);
assert.equal(manifest.provisionalTerms.approved, false);
const unassigned = ["operatingRecipient", "futureReserveRecipient", "directorySignerA", "directorySignerB", "directorySignerC",
  "deployer", "confirmedDeployerNonce", "directoryAddress", "projectRegistryAddress", "successorDeployers", "guardSalt",
  "derivedAddresses", "encodedConstructors", "expectedRuntimeHashes", "signedTransactions"];
assert.deepEqual(Object.keys(manifest.productionInputs).sort(), unassigned.sort());
assert.ok(Object.values(manifest.productionInputs).every((value) => value === null), "Review profile cannot contain production assignments");

assert.equal(git("rev-parse", "HEAD"), manifest.source.harnessCommit, "Use the pinned harness checkout");
assert.equal(git("rev-parse", `HEAD:${contractTree}`), manifest.source.solidityTree);
assert.equal(git("rev-parse", `${manifest.source.solidityCommit}:${contractTree}`), manifest.source.solidityTree);
assert.equal(git("rev-parse", `HEAD:${harnessPath}`), manifest.source.harnessBlob);
assert.equal(git("status", "--porcelain", "--", contractTree, harnessPath), "", "Review inputs contain local changes");
for (const [name, expected] of Object.entries(manifest.replayInputsSha256Lf)) {
  const text = readFileSync(new URL(name, historical), "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(text).digest("hex"), expected, name);
}

const fork = JSON.parse(readFileSync(new URL("historical-4663-fork-2eth.json", historical), "utf8"));
const scope = JSON.parse(readFileSync(new URL("scope-report.json", historical), "utf8"));
assert.deepEqual(manifest.externalRuntimePins, fork.report.network.contracts);
assert.equal(manifest.compiler.sourceClosureFiles, Object.keys(scope.sourceGraph).length);
assert.equal(manifest.compiler.slitherInputSha256, scope.slitherCompilerInputSha256);
assert.deepEqual(manifest.compiler.exactInputTransformation, fork.manifest.sourceChanges);
assert.equal(manifest.historicalFixture.originBlock, fork.report.network.blockNumber);
assert.equal(manifest.historicalFixture.originHash, fork.report.network.blockHash);
assert.equal(manifest.provisionalTerms.creationFeeWei, fork.deployment.creationFeeWei);
assert.equal(manifest.provisionalTerms.graduationBackingWei, fork.terms.backingWei);
assert.equal(manifest.provisionalTerms.virtualEthWei, fork.terms.virtualEthWei);

const recentBytes = readFileSync(new URL("fork/4663-lifecycle.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(recentBytes).digest("hex"), manifest.freshFork.receiptEvidenceSha256Lf);
const recent = JSON.parse(recentBytes);
const recentNetwork = recent.report.network;
assert.equal(recentNetwork.chainId, manifest.chainId);
assert.equal(recentNetwork.blockNumber, manifest.freshFork.block);
assert.equal(recentNetwork.blockHash, manifest.freshFork.blockHash);
assert.equal(recentNetwork.stateRoot, manifest.freshFork.stateRoot);
assert.deepEqual(recentNetwork.contracts, manifest.externalRuntimePins);
assert.equal(recent.report.execution.host, "127.0.0.1");
assert.equal(recent.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
assert.equal(recent.creation.treasuryShareBps, 0);
assert.equal(recent.manifest.inputSha256, manifest.compiler.inputSha256);
assert.deepEqual(recent.manifest.templates, fork.manifest.templates);
assert.equal(recent.migration.backingInventoryFeesAndQuotesUnchanged, true);
assert.equal(recent.successorMigration.backingInventoryFeesAndQuotesUnchanged, true);
assert.equal(recent.lpFees.principalAndCustodyUnchanged, true);

const working = mkdtempSync(join(tmpdir(), "rmt-treasury-review-"));
const output = join(working, "offline-template-replay.json");
try {
  execFileSync(process.execPath, [
    fileURLToPath(new URL("verify-4663-bytecode.mjs", historical)), resolve(checkout), resolve(solc),
    fileURLToPath(new URL("historical-4663-fork-2eth.json", historical)), output,
  ], { stdio: "inherit", timeout: 200_000 });
  const replay = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(replay.inputSha256, manifest.compiler.inputSha256);
  assert.equal(replay.bootstrapInitcode.sha256, manifest.historicalFixture.bootstrapSha256);
  assert.equal(replay.bootstrapInitcode.sizeBytes, manifest.historicalFixture.bootstrapSizeBytes);
  assert.equal(replay.templates.RMTLaunchCurveFactoryV1.runtimeBytes, manifest.historicalFixture.factoryRuntimeBytes);
  assert.ok(replay.bootstrapInitcode.sizeBytes <= manifest.limits.initcodeBytes
    && Object.values(replay.templates).every(({ runtimeBytes }) => runtimeBytes <= manifest.limits.runtimeBytes), "Bytecode limit");
  console.log(JSON.stringify({
    profile: manifest.profile, chainId: replay.chainId, status: manifest.status, broadcastAuthorized: manifest.broadcastAuthorized,
    compilerSha256: replay.compilerSha256, inputSha256: replay.inputSha256,
    templatesVerified: Object.keys(replay.templates).length, externalRuntimePins: Object.keys(manifest.externalRuntimePins).length,
    fixtureDerivations: replay.fixtureAddressDerivations, fixtureForkBlock: recentNetwork.blockNumber,
    unassignedProductionFields: unassigned.length,
  }, null, 2));
} finally {
  rmSync(output, { force: true });
  rmdirSync(working);
}
