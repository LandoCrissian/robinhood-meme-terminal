import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readVNextReleaseReadiness } from "./release-readiness";
import { RMT_UNISWAP_V3_FEE_MAINNET_PROOF } from "./uniswap-v3-fee-mainnet-proof";
import { ACROSS_FUNDING_DEPLOYMENT_V1 } from "./across-funding-deployment";

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

const invalidUpAuthorization = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  RMT_VNEXT_UP_V2_AUTHORIZATION_ENABLED: "true"
});
assert.equal(invalidUpAuthorization.mode, "misconfigured");
assert.equal(invalidUpAuthorization.providers.upV2.authorizationEnabled, false);
assert.equal(invalidUpAuthorization.providers.upV2.strictVerificationAvailable, true);
assert.equal(invalidUpAuthorization.providers.upCl.walletAuthorizationAvailable, true);

const invalidFeeAuthorization = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true"
});
assert.equal(invalidFeeAuthorization.mode, "misconfigured");
assert.equal(invalidFeeAuthorization.providers.uniswapV3FeeExecutor.authorizationEnabled, false);
assert.equal(invalidFeeAuthorization.providers.uniswapV3FeeExecutor.deployedAndVerified, true);
assert.equal(invalidFeeAuthorization.providers.uniswapV3FeeExecutor.mainnetProofComplete, true);

const feeProofConfiguration = {
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: `0x${"1".repeat(40)}`,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: `0x${"2".repeat(64)}`,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: `0x${"3".repeat(40)}`,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "35041945",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: `eip155:4663/contract:0x${"4".repeat(40)}`
};
const feeMissingProofWallet = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
  ...feeProofConfiguration
});
assert.equal(feeMissingProofWallet.mode, "misconfigured");
assert.equal(feeMissingProofWallet.providers.uniswapV3FeeExecutor.proofWalletConfigured, false);
assert.equal(feeMissingProofWallet.providers.uniswapV3FeeExecutor.authorizationEnabled, false);

const feeProofReady = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: `0x${"5".repeat(40)}`,
  ...feeProofConfiguration
});
assert.equal(feeProofReady.mode, "interactive");
assert.equal(feeProofReady.configurationConsistent, true);
assert.equal(feeProofReady.providers.uniswapV3FeeExecutor.proofWalletConfigured, true);
assert.equal(feeProofReady.providers.uniswapV3FeeExecutor.releaseScope, "proof-wallet");
assert.equal(feeProofReady.providers.uniswapV3FeeExecutor.authorizationEnabled, true);
assert.equal(feeProofReady.providers.uniswapV3FeeExecutor.publicAuthorizationEnabled, false);
assert.equal(feeProofReady.providers.uniswapV3FeeExecutor.mainnetProofComplete, true);

const feePublicReady = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executorRuntimeHash,
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "35041945",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: [
    "eip155:4663/contract:0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    "eip155:4663/native"
  ].join(","),
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED: "true",
});
assert.equal(feePublicReady.mode, "interactive");
assert.equal(feePublicReady.configurationConsistent, true);
assert.equal(feePublicReady.providers.uniswapV3FeeExecutor.releaseScope, "public");
assert.equal(feePublicReady.providers.uniswapV3FeeExecutor.publicAuthorizationEnabled, true);
assert.equal(feePublicReady.providers.uniswapV3FeeExecutor.publicProofBindingValid, true);
assert.equal(feePublicReady.providers.uniswapV3FeeExecutor.mainnetProofComplete, true);

const invalidFeePublicGate = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED: "true"
});
assert.equal(invalidFeePublicGate.mode, "misconfigured");
assert.equal(invalidFeePublicGate.configurationConsistent, false);
assert.equal(invalidFeePublicGate.providers.uniswapV3FeeExecutor.publicAuthorizationEnabled, false);

const mismatchedSushi = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED: "true"
});
assert.equal(mismatchedSushi.mode, "misconfigured");

const invalidAcross = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  RMT_VNEXT_ACROSS_FUNDING_AUTHORIZATION_ENABLED: "true"
});
assert.equal(invalidAcross.mode, "misconfigured");
assert.equal(invalidAcross.providers.acrossFunding.authorizationEnabled, false);
assert.equal(invalidAcross.providers.acrossFunding.credentialsConfigured, false);
assert.equal(invalidAcross.providers.acrossFunding.deploymentPinsConfigured, false);
assert.equal(invalidAcross.providers.acrossFunding.publicAssetSelectionEnabled, false);
assert.equal(invalidAcross.providers.acrossFunding.mainnetProofComplete, false);

const acrossCredentialsOnly = readVNextReleaseReadiness({
  RMT_ACROSS_API_KEY: "server-key",
  RMT_ACROSS_INTEGRATOR_ID: "0x1234"
});
assert.equal(acrossCredentialsOnly.providers.acrossFunding.credentialsConfigured, true);
assert.equal(acrossCredentialsOnly.providers.acrossFunding.deploymentPinsConfigured, false);
assert.equal(acrossCredentialsOnly.providers.acrossFunding.configured, false);

const acrossPins = Object.fromEntries((["ETHEREUM", "ARBITRUM", "BASE", "ROBINHOOD"] as const).flatMap((chain, index) => {
  const chainId = [1, 42161, 8453, 4663][index] as keyof typeof ACROSS_FUNDING_DEPLOYMENT_V1;
  const admitted = ACROSS_FUNDING_DEPLOYMENT_V1[chainId];
  return [
    [`RMT_ACROSS_${chain}_SPOKE_POOL_PROXY_CODE_HASH`, admitted.proxyRuntimeHash],
    [`RMT_ACROSS_${chain}_SPOKE_POOL_IMPLEMENTATION_ADDRESS`, admitted.implementationAddress],
    [`RMT_ACROSS_${chain}_SPOKE_POOL_IMPLEMENTATION_CODE_HASH`, admitted.implementationRuntimeHash]
  ];
}));
const acrossReady = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  RMT_ACROSS_API_KEY: "server-key",
  RMT_ACROSS_INTEGRATOR_ID: "0x1234",
  RMT_ETHEREUM_RPC_URL: "https://ethereum.rpc.example",
  RMT_ETHEREUM_RPC_AUTH_TOKEN: "ethereum-token",
  RMT_ARBITRUM_RPC_URL: "https://arbitrum.rpc.example",
  RMT_ARBITRUM_RPC_AUTH_TOKEN: "arbitrum-token",
  RMT_BASE_RPC_URL: "https://base.rpc.example",
  RMT_BASE_RPC_AUTH_TOKEN: "base-token",
  RMT_ACROSS_ROBINHOOD_RPC_URL: "https://robinhood.rpc.example",
  RMT_ACROSS_ROBINHOOD_RPC_AUTH_TOKEN: "robinhood-token",
  FIREBASE_ADMIN_PROJECT_ID: "rmt-live",
  FIREBASE_ADMIN_CLIENT_EMAIL: "rmt@rmt-live.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  RMT_VNEXT_ACROSS_FUNDING_QUOTES_ENABLED: "true",
  ...acrossPins
});
assert.equal(acrossReady.configurationConsistent, true);
assert.equal(acrossReady.providers.acrossFunding.configured, true);
assert.equal(acrossReady.providers.acrossFunding.credentialsConfigured, true);
assert.equal(acrossReady.providers.acrossFunding.deploymentPinsConfigured, true);
assert.equal(acrossReady.providers.acrossFunding.rpcConfigured, true);
assert.equal(acrossReady.providers.acrossFunding.persistenceConfigured, true);
assert.equal(acrossReady.providers.acrossFunding.quotesEnabled, true);
assert.equal(acrossReady.providers.acrossFunding.authorizationEnabled, false);
assert.equal(acrossReady.providers.acrossFunding.trackingEnabled, true);

const route = readFileSync(new URL("../../app/api/vnext/readiness/route.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
assert.match(route, /readVNextReleaseReadiness\(process\.env\)/);
assert.match(route, /private, no-store, max-age=0/);
assert.match(route, /noindex, nofollow/);
assert.doesNotMatch(route, /RMT_INDEXER_READ_TOKEN|RMT_ZEROX_API_KEY|RMT_UNISWAP_API_KEY|PRIVY_APP_SECRET/);
assert.match(envExample, /^RMT_VNEXT_SHELL_ENABLED=false$/m);
assert.match(envExample, /^RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED=false$/m);
assert.doesNotMatch(envExample, /^NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED=/m);

console.log("RMT VNext production release-readiness smoke checks passed.");
