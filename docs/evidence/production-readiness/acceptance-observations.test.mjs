import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const read = (name) => readFileSync(new URL(name, import.meta.url));
const report = JSON.parse(gunzipSync(read("acceptance-observations.json.gz")));
const releaseText = read("../fixed-supply-release/release-manifest.json").toString("utf8").replaceAll("\r\n", "\n");
const release = JSON.parse(releaseText);

test("live observations keep historical checkpoint finality and exact hosted routing separate from deployment", () => {
  assert.equal(report.mode, "PUBLIC_READ_ONLY");
  assert.equal(report.status, "BLOCKED_NO_BROADCAST");
  assert.equal(report.broadcastAuthorized, false);
  assert.equal(report.compilerInputSha256, release.compiler.inputSha256);
  assert.equal(report.reviewedManifestSha256, createHash("sha256").update(releaseText).digest("hex"));
  assert.equal(report.indexer.directory.counts.exactPinnedRegistrations, 4);
  assert.deepEqual([report.indexer.directory.counts.v4, report.indexer.directory.counts.v6], [2, 2]);
  assert.equal(report.indexer.releases.historicalRegistrationWitnesses, "VERIFIED_L2");
  assert.equal(report.indexer.releases.directAuthorizedBackendRead, "UNVERIFIED_NO_PROBE_CREDENTIAL");
  assert.equal(report.indexer.releases.newEngineHostedIngestion, "DEPLOYMENT_DEPENDENT");
  assert.equal(report.rpc.finality.historicalBatch.status, "CORROBORATED_FINALIZED_L1_POSTING");
  assert.equal(report.rpc.finality.hostedCheckpoint.status, "UNVERIFIED");
  assert.equal(report.rpc.finality.hostedCheckpoint.target.number, report.indexer.directory.checkpoint.blockNumber);
  assert.equal(report.rpc.finality.hostedCheckpoint.target.hash, report.indexer.directory.checkpoint.blockHash);
  assert.equal(report.routing.hosted.productionPoolKey, null);
  assert.equal(report.routing.hosted.quotesObserved, false);
});

test("live Safe observations retain separate proposals and exact estimates with no beneficiary approval", () => {
  const { safes } = report;
  assert.equal(safes.threshold, 2);
  assert.equal(new Set(safes.owners).size, 3);
  assert.equal(safes.deployments, null);
  assert.equal(safes.broadcastAuthorized, false);
  assert.equal(safes.status, "READ_ONLY_ESTIMATED");
  assert.deepEqual(safes.proposals.map(({ role }) => role), ["RMT-OPERATIONS", "RMT-RESERVE"]);
  assert.equal(new Set(safes.proposals.map(({ counterfactualAddress }) => counterfactualAddress)).size, 2);
  assert.equal(new Set(safes.proposals.map(({ saltNonce }) => saltNonce)).size, 2);
  let sum = 0n;
  for (const { verifiedBeneficiary, approvedDeploymentSaltNonce, vacancy, gas, simulation, counterfactualAddress } of safes.proposals) {
    assert.equal(verifiedBeneficiary, null);
    assert.equal(approvedDeploymentSaltNonce, null);
    assert.equal(vacancy.status, "VACANT");
    assert.equal(simulation.value, counterfactualAddress);
    assert.equal(BigInt(gas.estimatedTotalWei), BigInt(gas.l1PosterWei) + BigInt(gas.l2ExecutionWei));
    sum += BigInt(gas.estimatedTotalWei);
  }
  assert.equal(sum.toString(), safes.combinedEstimatedWei);
});
