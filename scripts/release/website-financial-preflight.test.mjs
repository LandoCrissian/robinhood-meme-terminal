import assert from "node:assert/strict";
import test from "node:test";
import { checkFinancialActivation, checkFinancialArtifacts, financialActivationKeys } from "./website-financial-preflight.mjs";

test("new financial flags and attestations cannot bypass the retained artifact-only preflight", () => {
  assert.equal(checkFinancialActivation({}).financialFlags, "ALL_UNSET");
  for (const key of financialActivationKeys) assert.throws(() => checkFinancialActivation({ [key]: "present" }));
});
test("both financial Next routes must retain the existing edge rule without provisioning extra rules", () => {
  const routes = ["/api/launchpad/production-lifecycle", "/api/launchpad/production-earnings"];
  const artifacts = { appRoutes: routes.map(path => path + "/route"), edge: { nativeRules: ["launch-discovery-limit", "launch-creation-limit"] } };
  const edge = { routes: routes.map(path => ({ function: "launch-creation-limit", path })) };
  assert.equal(checkFinancialArtifacts(artifacts, edge).execution, "BLOCKED_NO_BROADCAST");
  for (const route of routes) {
    assert.throws(() => checkFinancialArtifacts({ ...artifacts, appRoutes: artifacts.appRoutes.filter(path => path !== route + "/route") }, edge));
    assert.throws(() => checkFinancialArtifacts(artifacts, { routes: edge.routes.filter(entry => entry.path !== route) }));
  }
  assert.throws(() => checkFinancialArtifacts({ ...artifacts, edge: { nativeRules: ["one", "two", "extra"] } }, edge));
});
