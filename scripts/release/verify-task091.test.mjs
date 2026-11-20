import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {verifyTask091Acceptance, verifyTask091Admission} from "./verify-task091.mjs";

const load = () => JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task091/security/stage-acceptance.json", import.meta.url)));

test("all exact retained IDs can receive bounded technical acceptance while raw severity gates stay red and authority stays absent", () => {
  const result = verifyTask091Acceptance();
  assert.deepEqual(result.findings, {high: 22, governanceMedium: 7});
  assert.deepEqual(result.rawAnalysis, {detectors: 101, results: 233, strictStatus: "FAIL_HIGH", strictExit: 1});
  for (const stage of Object.values(result.stages)) assert.equal(stage.technicalRecommendation, "ACCEPT_WITH_BOUNDED_RISK");
  for (const key of ["signingAuthorized", "broadcastAuthorized", "factoryPublicationAuthorized", "websiteActivationAuthorized", "tokenCreationAuthorized"]) assert.equal(result[key], false);
  assert.equal(result.ownerRiskAcceptance, "REQUIRED_SEPARATELY");
  assert.equal(result.operationalAcceptance, "REQUIRED_SEPARATELY");
});

test("missing, repeated and substituted original findings fail closed", () => {
  for (const mutate of [
    a => a.findings.pop(),
    a => {a.findings[0] = structuredClone(a.findings[1]);},
    a => {a.findings[0].id = "unknown-new-finding";},
  ]) {
    const a = load(); mutate(a);
    assert.throws(() => verifyTask091Acceptance(a), /Every original/);
  }
});

test("changed severity, detectors, compiler input, raw exit and base cannot inherit acceptance", () => {
  for (const mutate of [
    a => {a.findings[0].impact = "Informational";},
    a => {a.findings[0].check = "suppressed";},
    a => {a.compilerInputSha256 = "0".repeat(64);},
    a => {a.rawAnalysis.strictExit = 0;},
    a => {a.rawAnalysis.detectors = 100;},
    a => {a.sourceBase = "0".repeat(40);},
  ]) {
    const a = load(); mutate(a); assert.throws(() => verifyTask091Acceptance(a));
  }
});

test("a material loss path blocks every applicable stage despite an acceptance label", () => {
  const a = load(), row = a.findings[0]; row.materialLossPath = true;
  for (const stage of Object.values(row.stages)) stage.appliesDirectly = true;
  const result = verifyTask091Acceptance(a);
  for (const stage of Object.values(result.stages)) {
    assert.equal(stage.technicalRecommendation, "BLOCK");
    assert.ok(stage.unresolvedMaterialIds.includes(row.id));
  }
});

test("a stage-specific block never gets cleared by unrelated accepted stages", () => {
  const a = load(), row = a.findings[0]; row.stages.ownerCreation.technicalRecommendation = "BLOCK";
  const result = verifyTask091Acceptance(a);
  assert.equal(result.stages.ownerCreation.technicalRecommendation, "BLOCK");
  assert.equal(result.stages.currentFactoryPublication.technicalRecommendation, "ACCEPT_WITH_BOUNDED_RISK");
});

test("publication and creation cannot admit a reachable material loss path merely because they do not call it directly", () => {
  const a = load(), row = a.findings[0]; row.materialLossPath = true;
  row.stages.currentFactoryPublication.appliesDirectly = false;
  row.stages.ownerCreation.appliesDirectly = false;
  const result = verifyTask091Acceptance(a);
  assert.equal(result.stages.currentFactoryPublication.technicalRecommendation, "BLOCK");
  assert.equal(result.stages.ownerCreation.technicalRecommendation, "BLOCK");
});

test("unknown or missing stages, unsupported labels and absent residual risk are rejected", () => {
  for (const mutate of [
    a => {delete a.findings[0].stages.ownerCreation;},
    a => {a.findings[0].stages.optionalTreasury = a.findings[0].stages.ownerCreation;},
    a => {a.findings[0].stages.ownerCreation.technicalRecommendation = "FALSE_POSITIVE";},
    a => {a.findings[0].residualRisk = "";},
    a => {delete a.findings[0].materialLossPath;},
  ]) {
    const a = load(); mutate(a); assert.throws(() => verifyTask091Acceptance(a));
  }
});

test("evidence byte drift, missing references and path escapes cannot inherit acceptance", () => {
  const a = load();
  assert.throws(() => verifyTask091Acceptance(a, {readEvidence: () => Buffer.from("altered evidence")}), /Evidence bytes changed/);
  for (const mutate of [
    a => {a.findings[0].evidence = [];},
    a => {a.findings[0].evidence[0].sha256 = "0".repeat(64);},
    a => {a.findings[0].evidence[0].path = "docs/evidence/../../private";},
    a => {a.findings[0].evidence[0].path = "C:\\private";},
  ]) {
    const candidate = load(); mutate(candidate); assert.throws(() => verifyTask091Acceptance(candidate));
  }
});

test("current source verification errors propagate instead of producing a recommendation", () => {
  assert.throws(() => verifyTask091Acceptance(load(), {verifySources() {throw new Error("canonical source drift");}}), /canonical source drift/);
});

test("omitted profiles, altered proof counts, extra tests and changed source or raw bytes cannot inherit the admission proof", () => {
  const proof = () => JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task091/security/proof-results.json", import.meta.url)));
  for (const mutate of [
    p => {p.profiles.pop();}, p => {p.profiles[0].passed = 3;},
    p => {p.profiles[0].names.push("untested()");}, p => {p.testSource.sha256 = "0".repeat(64);},
    p => {p.profiles[0].raw.expandedSha256 = "0".repeat(64);},
    p => {p.profiles[0].raw.file = "../outside.json.gz";},
    p => {p.productionWrites = true;},
  ]) {
    const p = proof(); mutate(p); assert.throws(() => verifyTask091Admission(p));
  }
});
