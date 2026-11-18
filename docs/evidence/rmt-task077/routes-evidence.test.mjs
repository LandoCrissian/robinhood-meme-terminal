import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { routePins, validateRound } from "../../../scripts/treasury-v2/routes.mjs";

const report = JSON.parse(readFileSync(new URL("routes-4663.json", import.meta.url)));
const names = ["official", "pocket"];

test("dated mainnet reads retain exact approved runtimes, bindings, compiler and canonical anchor", () => {
  assert.equal(report.scope, "READ_ONLY_4663_TREASURY_ROUTE_REFERENCE_OBSERVATION");
  assert.equal(report.productionChanges, false); assert.equal(report.signingOrBroadcast, false);
  assert.equal(report.productionCompilerInputSha256, "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10");
  assert.equal(report.anchor.number, "117745635");
  assert.equal(report.anchor.hash, "0x89915491572d0a04a77d6d37c842b8742628e934eaee34f99ada478b2b50ce2f");
  assert.equal(report.corroboration.status, "CORROBORATED"); assert.deepEqual(report.corroboration.providers, names);
  assert.equal(report.corroboration.marketIndependence, false);
  for (const name of names) {
    const provider = report.providers[name];
    assert.equal(provider.chain.value, 4663);
    assert.equal(provider.anchor.value.hash, report.anchor.hash); assert.equal(provider.recheckedAnchor.value.hash, report.anchor.hash);
    assert.equal(Object.keys(provider.runtimes).length, 11); assert.equal(Object.keys(provider.bindings).length, 20);
    for (const [role, pin] of Object.entries(routePins)) {
      assert.equal(provider.runtimes[role].value.address, pin.address);
      assert.equal(provider.runtimes[role].value.runtimeHash, pin.runtimeHash);
      assert.equal(provider.runtimes[role].value.matches, true);
    }
    assert.ok(Object.values(provider.bindings).every((item) => item.status === "observed" && item.matches));
  }
  for (const entry of report.sourceBindings) {
    const data = readFileSync(new URL(`../../../${entry.path}`, import.meta.url));
    assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256, entry.path);
  }
});

test("base-asset feeds and deployed oracle proxies do not substitute for project-token evidence", () => {
  assert.equal(report.catalog.count, 62);
  assert.equal(report.catalog.sha256, "9b21f1262fd333228743ce1987506ebfa9aa1296119db2a8aba93848db225339");
  assert.equal(report.catalog.automaticAdmission, false);
  assert.equal(report.directoryCorroboration.status, "CORROBORATED");
  assert.equal(report.directoryCorroboration.value.latestVersion, 0);
  assert.equal(report.directoryCorroboration.value.factories[0], "0x0000000000000000000000000000000000000000");
  assert.deepEqual(report.directoryCorroboration.value.pending.slice(1), [1795131148, 1795722606]);
  assert.equal(report.baseAssetCorroboration.status, "CORROBORATED");
  for (const name of names) {
    const provider = report.providers[name], feed = provider.ethUsd;
    assert.deepEqual(validateRound(feed.latestRoundData.value, report.anchor.timestamp), feed.assessment);
    assert.equal(feed.assessment.ageSeconds, "2525");
    assert.equal(feed.assessment.pricesProjectToken, false);
    assert.equal(feed.assessment.independentlyAdmittedProjectReference, false);
    for (const item of Object.values(provider.unadmittedReferenceCandidates)) {
      assert.equal(item.status, "observed"); assert.ok(item.value.bytes > 0);
      assert.equal(item.value.acceptedProjectFeedId, null);
      assert.equal(item.value.independentlyReviewed, false); assert.equal(item.value.authorizesPurchases, false);
    }
  }
  assert.equal(report.purchaseReadiness.status, "NO_GO"); assert.equal(report.purchaseReadiness.executable, false);
  assert.equal(report.purchaseReadiness.token, null); assert.equal(report.purchaseReadiness.poolIdentity, null);
  assert.equal(report.purchaseReadiness.liquidity, "UNAVAILABLE_NO_ASSIGNED_PROJECT_TOKEN");
  assert.equal(report.purchaseReadiness.hostedQuote, "UNOBSERVED"); assert.equal(report.purchaseReadiness.finality, "L1_UNVERIFIED");
});
