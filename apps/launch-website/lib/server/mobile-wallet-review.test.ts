import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mobileReviewApi, proposedProductionSender } from "../mobile-wallet-review";
import { configuredMobileReview, handleMobileReview, readMobilePlan } from "./mobile-wallet-review";

const origin = "http://127.0.0.1:3100";
const address = (digit: string) => "0x" + digit.repeat(40);
const hash = (digit: string) => "0x" + digit.repeat(64);

test("mobile review requires explicit loopback mode, exact origin and an authorized synthetic account", async () => {
  const folder = mkdtempSync(join(tmpdir(), "rmt-mobile-review-"));
  const deployment = join(folder, "fixture.json");
  writeFileSync(deployment, JSON.stringify({
    profile: "rmt-curve-fixed-supply-security-v2", fixedSupplyWei: "1000000000000000000000000000", chainId: 31337,
    factory: address("1"), projectRegistry: address("2"), factoryRuntimeHash: hash("a"), registryRuntimeHash: hash("b"),
    deployBlock: "100", deploymentBlockHash: hash("c"), creationFeeWei: "400000000000000", creationFeeRecipient: address("3"),
  }));
  const env = { RMT_CURVE_FIXTURE: "rmt-curve-fixed-supply-security-v2", RMT_CURVE_FIXTURE_SITE_ORIGIN: origin,
    RMT_CURVE_FIXTURE_READ_KEY: "1".repeat(64), RMT_CURVE_FIXTURE_RPC: "http://127.0.0.1:3200/",
    RMT_CURVE_FIXTURE_INDEXER: "http://127.0.0.1:3300/", RMT_CURVE_FIXTURE_DEPLOYMENT: deployment,
    RMT_MOBILE_REVIEW_FIXTURE: "local-reviewed-31337", RMT_MOBILE_REVIEW_FIXTURE_ACCOUNT: address("4"), NETLIFY: "" };
  const prior = Object.entries(env).map(([key]) => [key, process.env[key]]);
  const headers = new Headers({ host: new URL(origin).host, "content-type": "application/json", origin });
  const call = (body: unknown, overrides = headers, url = origin + mobileReviewApi) =>
    handleMobileReview(new Request(url, { method: "POST", headers: overrides, body: JSON.stringify(body) }));
  try {
    Object.assign(process.env, env);
    assert.equal(configuredMobileReview(headers)?.account, address("4"));
    const wrongOrigin = new Headers(headers);
    wrongOrigin.set("origin", "https://example.test");
    assert.equal((await call({}, wrongOrigin)).status, 403);
    assert.equal((await call({}, headers, "https://example.test" + mobileReviewApi)).status, 404);
    assert.equal((await call({}, headers, origin + mobileReviewApi + "?debug")).status, 403);
    const forwarded = new Headers(headers);
    forwarded.set("forwarded", "host=127.0.0.1:3100;proto=http");
    assert.equal((await call({}, forwarded)).status, 404);
    assert.equal((await call({ action: "prepare", account: proposedProductionSender, intentId: hash("d") })).status, 422);
    assert.equal((await call({ action: "refresh", review: { attestation: hash("d") } })).status, 422);
    process.env.RMT_MOBILE_REVIEW_FIXTURE_ACCOUNT = proposedProductionSender;
    assert.equal(configuredMobileReview(headers), null);
    process.env.RMT_MOBILE_REVIEW_FIXTURE_ACCOUNT = address("4");
    process.env.NETLIFY = "true";
    assert.equal((await call({})).status, 404);
    process.env.NETLIFY = "";
    delete process.env.RMT_MOBILE_REVIEW_FIXTURE;
    assert.equal((await call({})).status, 404);
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    rmSync(folder, { recursive: true });
  }
});

test("local offline review has only unsigned 4663 evidence and display fields", () => {
  const key = "RMT_MOBILE_REVIEW_PLAN";
  const prior = process.env[key];
  try {
    process.env[key] = fileURLToPath(new URL("../../../../docs/evidence/mobile-signing/review-plan-4663.json", import.meta.url));
    const plan = readMobilePlan();
    assert.equal(plan?.rows.length, 12);
    assert.equal(plan.rows[0]?.safe?.owners.length, 3);
    assert.notEqual(plan.rows[0]?.safe?.saltNonce, plan.rows[1]?.safe?.saltNonce);
    assert.equal(plan.observation?.accountType, "EIP_7702_DELEGATION");
    assert.equal(plan.observation?.safes.length, 2);
    assert.doesNotMatch(JSON.stringify(plan), /"data"|"initializer"|"privateKey"|"transactions"/);
    process.env[key] = "./local-plan.json";
    assert.equal(readMobilePlan(), null);
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
});
