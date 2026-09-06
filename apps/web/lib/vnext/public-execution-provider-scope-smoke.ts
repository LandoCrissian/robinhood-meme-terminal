import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VNextPublicExecutionProviderConfigurationError,
  VNextPublicExecutionProviderNotReleasedError,
  VNextPublicExecutionSettlementNotReleasedError,
  hasExactVNextV2V3PublicExecutionProviderScope,
  hasExactVNextV3V2PublicExecutionProviderScope,
  hasExactVNextZeroXOnlyPublicExecutionProviderScope,
  readVNextPublicExecutionReleaseScope,
  readVNextPublicExecutionProviderScope,
  requireVNextPublicExecutionProvider,
  requireVNextPublicExecutionSettlement,
  vNextPublicExecutionProviderScopeErrorResponse
} from "../server/vnext-public-execution-provider-scope";
import { selectVNextRoute, type VNextQuoteAttempt, type VNextQuoteProvider } from "./quote-observation";
import { readVNextReleaseReadiness } from "./release-readiness";
import { VNEXT_DIRECT_NO_RMT_FEE, VNEXT_PROVIDER_NATIVE_INPUT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";

function scope(value?: string) {
  return readVNextPublicExecutionProviderScope(value === undefined
    ? {}
    : { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: value });
}

assert.deepEqual(scope(), { configured: false, valid: true, providers: [] });
assert.throws(() => requireVNextPublicExecutionProvider("uniswap-v3", {}), VNextPublicExecutionProviderNotReleasedError);

const v3OnlyEnv = { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v3" };
assert.deepEqual(scope("uniswap-v3"), { configured: true, valid: true, providers: ["uniswap-v3"] });
assert.deepEqual(scope("  uniswap-v3  "), { configured: true, valid: true, providers: ["uniswap-v3"] });
assert.doesNotThrow(() => requireVNextPublicExecutionProvider("uniswap-v3", v3OnlyEnv));
assert.doesNotThrow(() => requireVNextPublicExecutionSettlement("uniswap-v3", VNEXT_V2_ATOMIC_INPUT_FEE, v3OnlyEnv));
assert.throws(
  () => requireVNextPublicExecutionSettlement("uniswap-v3", VNEXT_DIRECT_NO_RMT_FEE, v3OnlyEnv),
  VNextPublicExecutionSettlementNotReleasedError
);
assert.equal(hasExactVNextV3V2PublicExecutionProviderScope(v3OnlyEnv), true);
assert.equal(readVNextPublicExecutionReleaseScope(v3OnlyEnv), "v3-only");

const v2V3Env = { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v2,uniswap-v3" };
assert.deepEqual(scope(v2V3Env.RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS), {
  configured: true,
  valid: true,
  providers: ["uniswap-v2", "uniswap-v3"]
});
assert.equal(hasExactVNextV2V3PublicExecutionProviderScope(v2V3Env), true);
assert.equal(hasExactVNextV3V2PublicExecutionProviderScope(v2V3Env), false);
assert.equal(readVNextPublicExecutionReleaseScope(v2V3Env), "v2-v3");
assert.doesNotThrow(() => requireVNextPublicExecutionProvider("uniswap-v2", v2V3Env));
assert.doesNotThrow(() => requireVNextPublicExecutionProvider("uniswap-v3", v2V3Env));
assert.doesNotThrow(() => requireVNextPublicExecutionSettlement("uniswap-v2", VNEXT_V2_ATOMIC_INPUT_FEE, v2V3Env));

const zeroXOnlyEnv = { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "zero-x-swap" };
assert.deepEqual(scope("zero-x-swap"), { configured: true, valid: true, providers: ["zero-x-swap"] });
assert.equal(readVNextPublicExecutionReleaseScope(zeroXOnlyEnv), "ZERO_X_ONLY");
assert.equal(hasExactVNextZeroXOnlyPublicExecutionProviderScope(zeroXOnlyEnv), true);
assert.doesNotThrow(() => requireVNextPublicExecutionSettlement("zero-x-swap", VNEXT_PROVIDER_NATIVE_INPUT_FEE, zeroXOnlyEnv));
assert.throws(() => requireVNextPublicExecutionSettlement("zero-x-swap", VNEXT_DIRECT_NO_RMT_FEE, zeroXOnlyEnv), VNextPublicExecutionSettlementNotReleasedError);
assert.throws(() => requireVNextPublicExecutionProvider("uniswap-v3", zeroXOnlyEnv), VNextPublicExecutionProviderNotReleasedError);

for (const noncanonical of [
  "uniswap-v2",
  "uniswap-v3,uniswap-v2",
  "uniswap-v2, uniswap-v3",
  " uniswap-v2,uniswap-v3",
  "uniswap-v2,uniswap-v3,uniswap-v4"
]) {
  assert.equal(scope(noncanonical).valid, true, `${noncanonical} remains a structurally known provider list`);
  assert.equal(readVNextPublicExecutionReleaseScope({ RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: noncanonical }), "invalid-unreleased");
  assert.equal(hasExactVNextV2V3PublicExecutionProviderScope({ RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: noncanonical }), false);
}

for (const provider of ["uniswap-v2", "uniswap-v4", "sushi", "up-v2", "up-cl", "zero-x-swap", "zero-x-gasless", "uniswapx"] as const) {
  assert.throws(() => requireVNextPublicExecutionProvider(provider, v3OnlyEnv), VNextPublicExecutionProviderNotReleasedError);
}

for (const malformed of ["", " ", "*", "unknown", "uniswap-v3,", ",uniswap-v3", "uniswap-v3,,uniswap-v2", "uniswap-v3,uniswap-v3"]) {
  assert.equal(scope(malformed).valid, false, `${JSON.stringify(malformed)} must fail closed`);
  assert.deepEqual(scope(malformed).providers, []);
  assert.throws(
    () => requireVNextPublicExecutionProvider("uniswap-v3", { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: malformed }),
    VNextPublicExecutionProviderConfigurationError
  );
}

const deniedCause = new VNextPublicExecutionProviderNotReleasedError("uniswap-v2");
const deniedResponse = vNextPublicExecutionProviderScopeErrorResponse(deniedCause);
assert.equal(deniedResponse?.status, 403);
const invalidResponse = vNextPublicExecutionProviderScopeErrorResponse(new VNextPublicExecutionProviderConfigurationError());
assert.equal(invalidResponse?.status, 503);

function attempt(provider: VNextQuoteProvider, protectedOutputAtomic: string, publicWalletExecutionEligible: boolean): VNextQuoteAttempt {
  return {
    provider,
    providerLabel: provider,
    providerFamily: provider === "sushi" ? "sushi" : provider.startsWith("uniswap") ? "uniswap" : provider.startsWith("up-") ? "up" : "zeroex",
    adapterVersion: 1,
    status: "indicative",
    chainId: 4_663,
    inputAsset: "0x0000000000000000000000000000000000000000",
    outputAsset: "0x1111111111111111111111111111111111111111",
    inputAmountAtomic: "100000000000000",
    expectedOutputAtomic: protectedOutputAtomic,
    protectedOutputAtomic,
    outputDecimals: 18,
    priceImpact: null,
    liquidityFeeEvidence: [],
    quotedAtMs: 1,
    expiresAtMs: 2,
    latencyMs: provider === "uniswap-v2" ? 1 : 2,
    executionKind: "direct_amm",
    strictVerificationAvailable: true,
    publicWalletExecutionEligible,
    userPaysGas: true,
    providerFeeAsset: null,
    providerFeeAtomic: null,
    gasSponsorshipFeeAsset: null,
    gasSponsorshipFeeAtomic: null,
    explicitProviderFeeOutputAtomic: null,
    netEconomics: null,
    networkFeeNativeAtomic: null,
    networkFeeNativeSymbol: "ETH",
    protectedNetOutputAtomic: null,
    costState: "network_fee_pending",
    authorizationReady: false,
    detail: "test"
  };
}

const v2QuoteOnlyWinner = attempt("uniswap-v2", "110", false);
const v3Executable = attempt("uniswap-v3", "100", true);
const normalRanking = selectVNextRoute([v2QuoteOnlyWinner, v3Executable]);
const publicRanking = selectVNextRoute([v2QuoteOnlyWinner, v3Executable], { publicExecutionOnly: true });
assert.equal(normalRanking.bestObserved, v2QuoteOnlyWinner);
assert.equal(publicRanking.bestObserved, v2QuoteOnlyWinner, "public scope must not rewrite the best observed quote");
assert.equal(publicRanking.verificationCandidate, v3Executable);
assert.equal(publicRanking.usesVerifiedBackup, true);
assert.equal(v2QuoteOnlyWinner.protectedOutputAtomic, "110");
assert.equal(v3Executable.protectedOutputAtomic, "100");
assert.equal(selectVNextRoute([attempt("uniswap-v3", "100", false)], { publicExecutionOnly: true }).verificationCandidate, undefined);

const exactV2Authority = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
  RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED: "true",
  RMT_VNEXT_EXECUTION_V2_TREASURY: "0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC",
  RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK: "51296658",
  RMT_VNEXT_EXECUTION_V2_POLICY_HASH: "0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484",
  RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_ADDRESS: "0xef729FbC9aDfC431ae46ECc198144160e2dD7832",
  RMT_VNEXT_UNISWAP_V3_V2_EXECUTOR_RUNTIME_HASH: "0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d",
  RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_V2_PUBLIC_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET: "s".repeat(32)
} as const;
const missingProviderScope = readVNextReleaseReadiness(exactV2Authority);
assert.equal(missingProviderScope.configurationConsistent, false);
assert.equal(missingProviderScope.providers.uniswapV3V2FeeExecutor.publicAuthorizationEnabled, false);
assert.deepEqual(missingProviderScope.publicExecution.providers, []);

const exactPublicV3 = readVNextReleaseReadiness({
  ...exactV2Authority,
  RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v3"
});
assert.equal(exactPublicV3.configurationConsistent, true);
assert.equal(exactPublicV3.providers.uniswapV3V2FeeExecutor.publicAuthorizationEnabled, true);
assert.deepEqual(exactPublicV3.publicExecution.providers, ["uniswap-v3"]);
assert.deepEqual(exactPublicV3.publicExecution.unintendedProviders, []);
assert.equal(exactPublicV3.publicExecution.exactV3V2ReleaseScope, true);

for (const largerScope of ["uniswap-v3,uniswap-v2", "uniswap-v3,uniswap-v4", "uniswap-v3,up-v2"]) {
  const readiness = readVNextReleaseReadiness({ ...exactV2Authority, RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: largerScope });
  assert.equal(readiness.configurationConsistent, false);
  assert.equal(readiness.providers.uniswapV3V2FeeExecutor.publicAuthorizationEnabled, false);
  assert.equal(readiness.publicExecution.exactV3V2ReleaseScope, false);
}

const globalOnly = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true"
});
assert.deepEqual(globalOnly.publicExecution.providers, []);
assert.equal(globalOnly.providers.uniswapV3V2FeeExecutor.publicAuthorizationEnabled, false);

const exactPublicZeroX = readVNextReleaseReadiness({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  RMT_VNEXT_SHELL_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_AUTHORIZATION_ENABLED: "true",
  NEXT_PUBLIC_RMT_VNEXT_WALLET_SUBMISSION_ENABLED: "true",
  RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "zero-x-swap",
  RMT_VNEXT_ZEROX_OBSERVATION_ENABLED: "true",
  RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED: "true",
  RMT_ZEROX_API_KEY: "present-not-real",
  RMT_ZEROX_ALLOWANCE_HOLDER: "0x0000000000001fF3684f28c67538d4D072C22734",
  RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH: `0x${"1".repeat(64)}`
});
assert.equal(exactPublicZeroX.configurationConsistent, true);
assert.deepEqual(exactPublicZeroX.publicExecution.providers, ["zero-x-swap"]);
assert.equal(exactPublicZeroX.publicExecution.exactZeroXOnlyReleaseScope, true);
assert.equal(exactPublicZeroX.providers.zeroXSwap.publicAuthorizationEnabled, true);

const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const quoteRoute = readFileSync(new URL("../../app/api/vnext/quotes/route.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
for (const route of [verifyRoute, authorizeRoute]) {
  assert.match(route, /requireVNextPublicExecutionProvider\(parsed\.data\.provider\)/);
  assert.match(route, /requireVNextPublicExecutionSettlement\(parsed\.data\.provider, settlementMode\)/);
  assert.match(route, /vNextPublicExecutionProviderScopeErrorResponse/);
}
assert.match(quoteRoute, /publicWalletExecutionEligible/);
assert.match(quoteRoute, /attempts\.map/);
assert.match(quoteRoute, /attempt\.settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE/);
assert.match(composer, /publicExecutionOnly: true/);
assert.match(composer, /Best currently executable/);
assert.match(composer, /quote-only/);
assert.doesNotMatch(composer, /RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS/);
assert.match(envExample, /^# RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS=uniswap-v3$/m);
assert.doesNotMatch(envExample, /NEXT_PUBLIC_RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS/);

console.log("RMT VNext public execution provider-scope smoke checks passed.");
