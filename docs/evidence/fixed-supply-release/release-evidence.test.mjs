import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const read = (name) => readFileSync(new URL(name, import.meta.url));
const parse = (data) => JSON.parse(data.toString("utf8"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const release = parse(read("release-manifest.json"));
const bundleText = read("unsigned-bundle.json").toString("utf8").replaceAll("\r\n", "\n");
const bundle = parse(bundleText);
const archive = read("fork-4663.json.gz");
const reportBytes = gunzipSync(archive);
const fork = parse(reportBytes);
const frozen = parse(read("../fixed-supply-security/release-manifest.json"));

test("unsigned package pins compiler and failing security evidence without binding live transactions", () => {
  assert.equal(release.status, "BLOCKED_NO_BROADCAST");
  assert.equal(release.broadcastAuthorized, false);
  assert.equal(bundle.status, release.status);
  assert.equal(bundle.broadcastAuthorized, false);
  assert.equal(hash(bundleText), release.unsignedBundleSha256Lf);
  assert.equal(hash(archive), release.fork.archiveSha256);
  assert.equal(hash(reportBytes), release.fork.reportSha256);
  assert.equal(bundle.fixtureOnly.forkSha256, hash(reportBytes));
  assert.equal(bundle.compiler.inputSha256, frozen.compiler.inputSha256);
  assert.equal(fork.manifest.inputSha256, bundle.compiler.inputSha256);
  assert.deepEqual(release.staticAnalysis, frozen.staticAnalysis);
  assert.deepEqual(release.compiler, frozen.compiler);
  const { transactions, ...unassigned } = bundle.production;
  assert.deepEqual(transactions, []);
  assert.ok(Object.values(unassigned).every((value) => value === null));
  assert.equal(bundle.provisionalTerms.fixedSupplyWei, "1000000000000000000000000000");
  assert.deepEqual([bundle.provisionalTerms.curveInventoryWei, bundle.provisionalTerms.initialLiquidityInventoryWei],
    ["600000000000000000000000000", "400000000000000000000000000"]);
  assert.deepEqual([bundle.provisionalTerms.projectBps, bundle.provisionalTerms.operationsBps, bundle.provisionalTerms.reserveBps],
    [9000, 500, 500]);
  assert.deepEqual(bundle.fixtureOnly.transactions.map(({ name }) => name), ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"]);
  assert.equal(bundle.fixtureOnly.transactions.at(-1).initcodeHeadroom, frozen.compiler.bootstrapInitcodeHeadroom);
  assert.equal(bundle.fixtureOnly.bootstrapChildren.at(-1).runtimeHeadroom, frozen.compiler.factoryRuntimeHeadroom);
  assert.equal(bundle.fixtureOnly.firstProject.poolId, fork.projects[0].graduation.poolId);
  assert.equal(bundle.fixtureOnly.firstProject.token.address.toLowerCase(), fork.projects[0].projectAsset.toLowerCase());
});

test("pinned loopback fork preserves migration and settles all three projects with exact principal", () => {
  assert.equal(fork.report.execution.host, "127.0.0.1");
  assert.equal(fork.report.execution.chainId, 4663);
  assert.equal(fork.report.network.blockNumber, release.fork.blockNumber);
  assert.equal(fork.report.network.blockHash, release.fork.blockHash);
  assert.equal(fork.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  for (const method of fork.report.archiveBoundary.forwardedMethods) {
    assert.ok(fork.report.archiveBoundary.methodAllowlist.includes(method));
    assert.doesNotMatch(method, /send|sign|setBalance/);
  }
  assert.deepEqual(fork.projects.map(({ symbol }) => symbol), ["RMT", "HBR", "CDR"]);
  for (const project of fork.projects) {
    assert.equal(project.principalUnchanged, true);
    assert.ok(project.settlementTraces.graduation);
    assert.ok(project.settlementTraces.collection);
    assert.equal(project.crossProjectClaims.lp.status, "reverted");
  }
  const first = fork.projects[0];
  assert.deepEqual(first.migrations.map(({ version }) => version), [2, 3]);
  for (const migration of first.migrations) {
    assert.equal(migration.premature.status, "reverted");
    assert.equal(migration.migrated.status, "success");
    assert.equal(migration.graph.length, 6);
  }
  assert.equal(first.migrations[0].successor, first.migrations[1].source);
  assert.deepEqual(first.migrations[0].originalCredits, first.migrations[1].originalCredits);
  assert.equal(first.migrations[0].commitment, first.migrations[1].commitment);
});
