import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readVNextReleaseReadiness } from "./release-readiness";

const disabled = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production"
});
assert.equal(disabled.mode, "disabled");
assert.equal(disabled.shellEnabled, false);
assert.equal(disabled.productionObservationReady, false);

const observation = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true"
});
assert.equal(observation.mode, "observation");
assert.equal(observation.shellMode, "production-observe");
assert.equal(observation.configurationConsistent, true);
assert.equal(observation.productionObservationReady, true);
assert.deepEqual(observation.execution, {
  authorizationClientEnabled: false,
  authorizationServerEnabled: false,
  walletSubmissionEnabled: false
});

const walletReview = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true"
});
assert.equal(walletReview.mode, "wallet-review");
assert.equal(walletReview.productionObservationReady, false);

const interactive = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
  NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED: "true",
  RMT_SUSHI_QUOTES_ENABLED: "true"
});
assert.equal(interactive.mode, "interactive");
assert.equal(interactive.configurationConsistent, true);

const mismatchedAuthorization = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true"
});
assert.equal(mismatchedAuthorization.mode, "misconfigured");
assert.equal(mismatchedAuthorization.configurationConsistent, false);

const invalidSubmission = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true"
});
assert.equal(invalidSubmission.mode, "misconfigured");

const mismatchedSushi = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED: "true"
});
assert.equal(mismatchedSushi.mode, "misconfigured");

const route = readFileSync(new URL("../../app/api/vnext/readiness/route.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
assert.match(route, /readVNextReleaseReadiness\(process\.env\)/);
assert.match(route, /private, no-store, max-age=0/);
assert.match(route, /noindex, nofollow/);
assert.doesNotMatch(route, /RMT_INDEXER_READ_TOKEN|RMT_ZEROX_API_KEY|RMT_UNISWAP_API_KEY|PRIVY_APP_SECRET/);
assert.match(envExample, /^RMT_VNEXT_SHELL_ENABLED=false$/m);
assert.doesNotMatch(envExample, /^NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED=/m);

console.log("RMT VNext production release-readiness smoke checks passed.");
