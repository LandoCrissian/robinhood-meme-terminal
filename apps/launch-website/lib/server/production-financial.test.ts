import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { curveProductionDeployment, curveProductionPins, curveProductionProfile } from "./curve-production";
import { configuredProductionFinancial, configuredProductionFinancialPage, configuredProductionFinancialCapabilities,
  parseProductionFinancialRelease, productionReleaseReadiness } from "./production-financial";

const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
const reference = "a".repeat(64);
const base = JSON.stringify({ profile: curveProductionProfile, chainId: 4663, origin: "https://www.rmtlaunch.fun",
  compilerInputSha256: curveProductionDeployment.compilerInputSha256, factoryRuntimeHash: curveProductionPins.factory[1],
  ownerCreationApprovalSha256: reference, fullSourceVerificationSha256: reference, operationalAcceptanceSha256: reference,
  l1FinalityPolicyAcceptanceSha256: reference, indexingRecoveryAcceptanceSha256: reference,
  publication: { transactionHash: `0x${"b".repeat(64)}`, blockNumber: "116835200", blockHash: `0x${"c".repeat(64)}` } });
const accepted = { schemaVersion: 1, profile: curveProductionProfile, chainId: 4663, origin: "https://www.rmtlaunch.fun",
  baseReleaseSha256: sha(base), scopes: ["trading", "claims"], ownerApprovalSha256: reference,
  productionAdapterAcceptanceSha256: reference, iPhoneAcceptanceSha256: reference };
const financial = JSON.stringify(accepted);
const env = { RMT_CURVE_PRODUCTION_PREPARATION: curveProductionProfile, RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile,
  RMT_CURVE_PRODUCTION_RELEASE: base, RMT_CURVE_PRODUCTION_RELEASE_SHA256: sha(base),
  RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE: financial, RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE_SHA256: sha(financial),
  RMT_CURVE_PRODUCTION_TRADING: "owner-trading-approved", RMT_CURVE_PRODUCTION_CLAIMS: "owner-claims-approved" };
const headers = () => new Headers({ host: "www.rmtlaunch.fun", "x-forwarded-proto": "https", origin: "https://www.rmtlaunch.fun" });

test("financial capabilities require distinct approval, exact base release and physical-device acceptance", () => {
  assert.equal(configuredProductionFinancial(headers(), "trading", {}) , null);
  assert.ok(configuredProductionFinancial(headers(), "trading", env));
  assert.ok(configuredProductionFinancial(headers(), "claims", env));
  assert.notEqual(configuredProductionFinancial(headers(), "trading", env)?.approvalBinding,
    configuredProductionFinancial(headers(), "claims", env)?.approvalBinding);
  for (const key of Object.keys(env)) assert.equal(configuredProductionFinancial(headers(), key.includes("CLAIMS") ? "claims" : "trading", { ...env, [key]: undefined }), null, key);
  assert.equal(configuredProductionFinancial(headers(), "trading", { ...env, RMT_CURVE_FIXTURE: "local" }), null);
  for (const changed of [{ baseReleaseSha256: reference }, { iPhoneAcceptanceSha256: "0".repeat(64) },
    { scopes: [] }, { scopes: ["claims", "claims"] }, { scopes: ["creation"] }, { extra: true }, { chainId: 31337 }]) {
    const raw = JSON.stringify({ ...accepted, ...changed });
    assert.equal(parseProductionFinancialRelease(raw, sha(raw), sha(base)), null);
  }
  assert.equal(parseProductionFinancialRelease(financial + " ", sha(financial), sha(base)), null);
});

test("origin, authority and scope gates cannot be inherited from creation or preview", () => {
  for (const changed of [{ host: "deploy-preview.netlify.app" }, { "x-forwarded-proto": "http" },
    { origin: "https://rmtlaunch.fun" }, { "x-forwarded-host": "evil.invalid" }, { forwarded: "host=www.rmtlaunch.fun" }]) {
    const h = headers(); Object.entries(changed).forEach(([key, value]) => h.set(key, value));
    assert.equal(configuredProductionFinancial(h, "trading", env), null);
  }
  const h = headers(); h.delete("origin");
  assert.equal(configuredProductionFinancial(h, "claims", env), null);
  assert.ok(configuredProductionFinancial(h, "claims", env, false));
  assert.equal(configuredProductionFinancial(headers(), "claims", { ...env, RMT_CURVE_PRODUCTION_CLAIMS: "owner-creation-approved" }), null);
  const raw = JSON.stringify({ ...accepted, scopes: ["trading"] });
  assert.equal(configuredProductionFinancial(headers(), "claims", { ...env, RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE: raw,
    RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE_SHA256: sha(raw) }), null);
});

test("approved page capability survives an RPC outage while executable readiness remains unavailable", async () => {
  const h = headers(); h.delete("origin");
  const capability = configuredProductionFinancialPage(h, "trading", env);
  assert.ok(capability);
  let reads = 0;
  const unavailable = await productionReleaseReadiness(capability.release, {
    verify: async () => { reads++; throw Error("RPC timeout"); },
    discovery: async () => ({ status: "unavailable", launches: [] }),
  });
  assert.equal(reads, 1);
  assert.equal(unavailable, "unavailable");
  assert.deepEqual(configuredProductionFinancialPage(h, "trading", env), capability);
  assert.equal(configuredProductionFinancialPage(h, "trading", { ...env, RMT_CURVE_PRODUCTION_TRADING: undefined }), null);
  h.set("host", "preview.netlify.app");
  assert.equal(configuredProductionFinancialPage(h, "trading", env), null);
});

test("capability checks are local release reads; unavailable providers never become readiness or authority", () => {
  const originalFetch = globalThis.fetch;
  let networkReads = 0;
  globalThis.fetch = async () => { networkReads++; throw Error("Provider unavailable"); };
  try {
    const h = headers(); h.delete("origin");
    const tradingOnly = { ...env, RMT_CURVE_PRODUCTION_CLAIMS: undefined };
    const first = configuredProductionFinancialCapabilities(h, tradingOnly);
    assert.ok(first);
    assert.equal(first.readiness, "check-on-prepare");
    assert.equal(first.trading, "enabled");
    assert.equal(first.claims, "disabled");
    assert.equal(first.approvals.claims, undefined);
    assert.equal(first.approvals.trading, configuredProductionFinancial(h, "trading", tradingOnly, false)?.approvalBinding);
    assert.deepEqual(configuredProductionFinancialCapabilities(h, tradingOnly), first);
    assert.equal(configuredProductionFinancialCapabilities(h, { ...tradingOnly, RMT_CURVE_PRODUCTION_TRADING: undefined }), null);
    h.set("x-forwarded-host", "untrusted.invalid");
    assert.equal(configuredProductionFinancialCapabilities(h, tradingOnly), null);
    assert.equal(networkReads, 0);
  } finally { globalThis.fetch = originalFetch; }
});
