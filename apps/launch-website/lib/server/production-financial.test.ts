import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { curveProductionDeployment, curveProductionPins, curveProductionProfile } from "./curve-production";
import { configuredProductionFinancial, parseProductionFinancialRelease } from "./production-financial";

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
