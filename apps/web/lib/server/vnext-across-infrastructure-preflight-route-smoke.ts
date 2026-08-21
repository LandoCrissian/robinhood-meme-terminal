import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA,
  AcrossInfrastructurePreflightError,
  handleAcrossInfrastructurePreflightRequest,
  type AcrossInfrastructurePreflightSuccess
} from "./vnext-across-infrastructure-preflight";

const testBearer = Array.from({ length: 64 }, (_, index) => (index % 16).toString(16)).join("");
const enabledEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  VERCEL_ENV: "production",
  RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_ENABLED: "true",
  RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_TOKEN: testBearer
};
const success = {
  schemaVersion: ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA,
  status: "across_infrastructure_preflight_passed"
} as AcrossInfrastructurePreflightSuccess;
let calls = 0;
const runner = async () => {
  calls += 1;
  return success;
};

async function main() {
const disabled = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid"), {
  env: { ...enabledEnv, RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_ENABLED: "false" },
  runPreflight: runner
});
assert.equal(disabled.status, 404);
const outsideProduction = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid"), {
  env: { ...enabledEnv, VERCEL_ENV: "preview" },
  runPreflight: runner
});
assert.equal(outsideProduction.status, 404);
const missing = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid"), {
  env: enabledEnv,
  runPreflight: runner
});
assert.equal(missing.status, 401);
const weakConfiguredToken = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid", {
  headers: { Authorization: "Bearer too-short" }
}), {
  env: { ...enabledEnv, RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_TOKEN: "too-short" },
  runPreflight: runner
});
assert.equal(weakConfiguredToken.status, 401);
const wrong = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid", {
  headers: { Authorization: `Bearer ${"f".repeat(64)}` }
}), { env: enabledEnv, runPreflight: runner });
assert.equal(wrong.status, 401);
assert.equal(calls, 0, "infrastructure must not run before all route gates pass");

const approved = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid", {
  method: "POST",
  headers: { Authorization: `Bearer ${testBearer}` }
}), { env: enabledEnv, runPreflight: runner });
assert.equal(approved.status, 200);
assert.equal(calls, 1);
assert.equal(approved.headers.get("cache-control"), "private, no-store, max-age=0");
assert.equal(approved.headers.get("x-robots-tag"), "noindex, nofollow");
assert.equal(approved.headers.get("x-content-type-options"), "nosniff");
assert.equal((await approved.json()).status, "across_infrastructure_preflight_passed");

const failed = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid", {
  method: "POST",
  headers: { Authorization: `Bearer ${testBearer}` }
}), {
  env: enabledEnv,
  runPreflight: async () => {
    throw new Error(`Authorization: Bearer ${testBearer}`);
  }
});
assert.equal(failed.status, 503);
assert.equal(failed.headers.get("cache-control"), "private, no-store, max-age=0");
assert.equal(failed.headers.get("x-robots-tag"), "noindex, nofollow");
assert.equal(failed.headers.get("x-content-type-options"), "nosniff");
const failedText = await failed.text();
assert.equal(failedText.includes(testBearer), false);
assert.doesNotMatch(failedText, /Authorization:|privateKey|apiKey|authToken|process\.env/i);

const firebaseFailed = await handleAcrossInfrastructurePreflightRequest(new Request("https://rmt.invalid", {
  method: "POST",
  headers: { Authorization: `Bearer ${testBearer}` }
}), {
  env: enabledEnv,
  runPreflight: async () => {
    throw new AcrossInfrastructurePreflightError("FIREBASE_ADMIN_READ", "PERMISSION_DENIED");
  }
});
assert.equal(firebaseFailed.status, 503);
assert.equal(firebaseFailed.headers.get("cache-control"), "private, no-store, max-age=0");
assert.equal(firebaseFailed.headers.get("x-robots-tag"), "noindex, nofollow");
assert.equal(firebaseFailed.headers.get("x-content-type-options"), "nosniff");
assert.deepEqual(await firebaseFailed.json(), {
  schemaVersion: ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA,
  status: "across_infrastructure_preflight_failed",
  classification: "FIREBASE_ADMIN_READ",
  sanitizedMessage: "Firebase Admin read-only connectivity could not be verified.",
  firebaseAdminFailure: "PERMISSION_DENIED",
  walletUsed: false,
  quoteRequested: false,
  transactionAttempted: false
});

const moduleSource = readFileSync(new URL("./vnext-across-infrastructure-preflight.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../../app/api/vnext/readiness/across-infrastructure/route.ts", import.meta.url), "utf8");
assert.match(moduleSource, /timingSafeEqual/);
assert.match(moduleSource, /RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_TOKEN/);
assert.match(moduleSource, /RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_ENABLED/);
assert.match(moduleSource, /collection\("__rmt_preflight__"\)\.doc\("across-infrastructure"\)\.get\(\)/);
assert.match(routeSource, /export const runtime = "nodejs"/);
assert.match(routeSource, /export const dynamic = "force-dynamic"/);
assert.doesNotMatch(routeSource, /export (?:async )?function GET|export const GET/);
assert.doesNotMatch(moduleSource, /api\/swap\/approval|sendTransaction|signTransaction/);

console.log("RMT Across production-runtime route gate and response-sanitization checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
