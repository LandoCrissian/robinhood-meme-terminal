import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bestIndicativeAttempt, hasVNextWalletAuthorizationCodec, parseVNextQuoteResponse, selectVNextRoute, type VNextQuoteResponse } from "./quote-observation";
import { createRmtExecutionV1Policy, normalizeDisabledRmtFee, normalizeInputSideRmtFee } from "./execution-fee-policy";
import { VNEXT_LEGACY_V1_FEE, VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "./execution-settlement";
import { createVNextZeroXProviderNativeFee } from "./zero-x-settlement";

const now = 1_786_000_000_000;
const inputAsset = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const outputAsset = "0xe934e36A439C94017B64a3FecE66AF12099aBF50";
const expected = { inputAsset, outputAsset, inputAmountAtomic: "100000000" };
const response: VNextQuoteResponse = {
  requestId: "11111111-1111-4111-8111-111111111111",
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "100000000",
  requestedAtMs: now - 1_000,
  completedAtMs: now - 100,
  attempts: [
    {
      provider: "sushi",
      providerLabel: "Sushi",
      providerFamily: "sushi",
      adapterVersion: 1,
      status: "indicative",
      chainId: 4_663,
      inputAsset,
      outputAsset,
      inputAmountAtomic: "100000000",
      expectedOutputAtomic: "1000000000000000000000",
      protectedOutputAtomic: "990000000000000000000",
      outputDecimals: 18,
      priceImpact: 0.01,
      liquidityFeeEvidence: [],
      quotedAtMs: now - 500,
      expiresAtMs: now + 29_500,
      latencyMs: 500,
      executionKind: "aggregator",
      strictVerificationAvailable: false,
      userPaysGas: true,
      providerFeeAsset: null,
      providerFeeAtomic: null,
      gasSponsorshipFeeAsset: null,
      gasSponsorshipFeeAtomic: null,
      explicitProviderFeeOutputAtomic: null,
      netEconomics: normalizeDisabledRmtFee({
        userGrossInputAtomic: "100000000",
        providerGrossExpectedOutputAtomic: "1000000000000000000000",
        providerProtectedOutputAtomic: "990000000000000000000"
      }),
      networkFeeNativeAtomic: null,
      networkFeeNativeSymbol: "ETH",
      protectedNetOutputAtomic: null,
      costState: "network_fee_pending",
      authorizationReady: false,
      detail: "Live indicative route."
    },
    {
      provider: "uniswap-v3",
      providerLabel: "Uniswap v3",
      providerFamily: "uniswap",
      adapterVersion: 1,
      status: "no_route",
      chainId: 4_663,
      inputAsset,
      outputAsset,
      inputAmountAtomic: "100000000",
      expectedOutputAtomic: null,
      protectedOutputAtomic: null,
      outputDecimals: null,
      priceImpact: null,
      liquidityFeeEvidence: [],
      quotedAtMs: null,
      expiresAtMs: null,
      latencyMs: 200,
      executionKind: "direct_amm",
      strictVerificationAvailable: true,
      userPaysGas: null,
      providerFeeAsset: null,
      providerFeeAtomic: null,
      gasSponsorshipFeeAsset: null,
      gasSponsorshipFeeAtomic: null,
      explicitProviderFeeOutputAtomic: null,
      netEconomics: null,
      networkFeeNativeAtomic: null,
      networkFeeNativeSymbol: null,
      protectedNetOutputAtomic: null,
      costState: null,
      authorizationReady: false,
      detail: "No direct route."
    }
  ]
};

const parsed = parseVNextQuoteResponse(response, expected, now);
assert.equal(bestIndicativeAttempt(parsed.attempts)?.provider, "sushi");
assert.equal(selectVNextRoute(parsed.attempts).verificationCandidate, undefined);
assert.equal(selectVNextRoute(parsed.attempts).selectionBasis, "protected_output_before_network_fee");
assert.equal(selectVNextRoute(parsed.attempts).netOutcomeReady, false);
const withVerifiedBackup = parseVNextQuoteResponse({
  ...response,
  attempts: [response.attempts[0], {
    ...response.attempts[1],
    status: "indicative",
    expectedOutputAtomic: "989000000000000000000",
    protectedOutputAtomic: "980000000000000000000",
    outputDecimals: 18,
    quotedAtMs: now - 400,
    expiresAtMs: now + 29_600,
    userPaysGas: true,
    netEconomics: normalizeDisabledRmtFee({
      userGrossInputAtomic: "100000000",
      providerGrossExpectedOutputAtomic: "989000000000000000000",
      providerProtectedOutputAtomic: "980000000000000000000"
    }),
    networkFeeNativeSymbol: "ETH",
    costState: "network_fee_pending"
  }]
}, expected, now);
const backupSelection = selectVNextRoute(withVerifiedBackup.attempts);
assert.equal(backupSelection.bestObserved?.provider, "sushi");
assert.equal(backupSelection.verificationCandidate?.provider, "uniswap-v3", "fee-free execution admission is independent from dormant fee settlement");
assert.equal(backupSelection.usesVerifiedBackup, true);

const feePolicy = createRmtExecutionV1Policy({
  treasury: "0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC",
  chainId: 4_663,
  fromBlock: "35041945",
  eligibleSettlementAssetIds: [
    `eip155:4663/contract:${inputAsset.toLowerCase()}`,
    "eip155:4663/contract:0x0bd7d308f8e1639fab988df18a8011f41eacad73"
  ]
});
const feeBearingV3 = parseVNextQuoteResponse({
  ...response,
  attempts: [response.attempts[0], {
    ...withVerifiedBackup.attempts[1],
    expectedOutputAtomic: "980000000000000000000",
    protectedOutputAtomic: "970000000000000000000",
    netEconomics: normalizeInputSideRmtFee({
      policy: feePolicy,
      inputAssetId: `eip155:4663/contract:${inputAsset.toLowerCase()}`,
      outputAssetId: `eip155:4663/contract:${outputAsset.toLowerCase()}`,
      feeAssetId: `eip155:4663/contract:${inputAsset.toLowerCase()}`,
      settlementMode: "rmt-direct-executor-v1",
      userGrossInputAtomic: "100000000",
      providerGrossExpectedOutputAtomic: "980000000000000000000",
      providerProtectedOutputAtomic: "970000000000000000000"
    }),
    settlementMode: VNEXT_LEGACY_V1_FEE,
    executionTarget: "0xcB9c00524848038D211921e0f3975190D7Aa1e8f"
  }]
}, expected, now);
const netEconomicsSelection = selectVNextRoute(feeBearingV3.attempts);
assert.equal(netEconomicsSelection.bestObserved?.provider, "sushi", "a lower-net fee-bearing V3 route cannot outrank a better fee-free route");
assert.equal(netEconomicsSelection.verificationCandidate?.provider, "uniswap-v3", "the fee-bearing route remains an explicit verified fallback");
assert.equal(hasVNextWalletAuthorizationCodec("uniswap-v3"), true);
assert.equal(hasVNextWalletAuthorizationCodec("uniswap-v4"), true);
assert.equal(hasVNextWalletAuthorizationCodec("zero-x-swap"), true);
assert.equal(hasVNextWalletAuthorizationCodec("zero-x-gasless"), false);
assert.equal(hasVNextWalletAuthorizationCodec("uniswapx"), false);
assert.equal(hasVNextWalletAuthorizationCodec("up-v2"), true);
assert.equal(hasVNextWalletAuthorizationCodec("up-cl"), true);

const uniswapXAttempt = {
  ...response.attempts[0],
  provider: "uniswapx" as const,
  providerLabel: "UniswapX",
  providerFamily: "uniswapx" as const,
  executionKind: "rfq_intent" as const,
  userPaysGas: false,
  networkFeeNativeSymbol: null,
  protectedNetOutputAtomic: response.attempts[0].protectedOutputAtomic,
  costState: null
};
const uniswapXSelection = selectVNextRoute(parseVNextQuoteResponse({
  ...response,
  attempts: [uniswapXAttempt, withVerifiedBackup.attempts[1]]
}, expected, now).attempts);
assert.equal(uniswapXSelection.bestObserved?.provider, "uniswapx");
assert.equal(uniswapXSelection.verificationCandidate?.provider, "uniswap-v3");
assert.equal(uniswapXSelection.usesVerifiedBackup, true);

const strictOnlyZeroX = parseVNextQuoteResponse({
  ...response,
  attempts: [{
    ...response.attempts[0],
    provider: "zero-x-swap",
    providerLabel: "0x Swap",
    providerFamily: "zeroex",
    strictVerificationAvailable: true,
    netEconomics: null,
    settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE,
    providerNativeFee: createVNextZeroXProviderNativeFee({
      inputAsset, outputAsset, recipient: "0x0000000000000000000000000000000000010000",
      userGrossInputAtomic: expected.inputAmountAtomic,
      expectedOutputAtomic: response.attempts[0].expectedOutputAtomic!,
      protectedOutputAtomic: response.attempts[0].protectedOutputAtomic!, authorizationState: "indicative"
    })
  }]
}, expected, now);
const strictOnlySelection = selectVNextRoute(strictOnlyZeroX.attempts);
assert.equal(strictOnlySelection.bestObserved?.provider, "zero-x-swap");
assert.equal(strictOnlySelection.verificationCandidate?.provider, "zero-x-swap");
assert.throws(() => parseVNextQuoteResponse({ ...strictOnlyZeroX, attempts: [{ ...strictOnlyZeroX.attempts[0], providerNativeFee: undefined }] }, expected, now), /provider-native fee authority/);
assert.equal(strictOnlySelection.usesVerifiedBackup, false);

const feeCoveredProviderUnavailable = parseVNextQuoteResponse({
  ...response,
  attempts: [{
    ...response.attempts[1],
    status: "temporarily_unavailable",
    detail: "The separately fee-covered implementation failed closed."
  }, {
    ...response.attempts[0],
    strictVerificationAvailable: true
  }]
}, expected, now);
const noFeeFreePromotion = selectVNextRoute(feeCoveredProviderUnavailable.attempts);
assert.equal(noFeeFreePromotion.bestObserved?.provider, "sushi", "fee-free providers remain quote-visible");
assert.equal(noFeeFreePromotion.verificationCandidate, undefined, "a fee-covered provider failure cannot promote a fee-free fallback");

assert.equal(parseVNextQuoteResponse({
  ...response,
  completedAtMs: now + 5_000,
  attempts: [{ ...response.attempts[0], quotedAtMs: now + 5_000 }, response.attempts[1]]
}, expected, now).requestId, response.requestId);
assert.throws(() => parseVNextQuoteResponse({ ...response, completedAtMs: now + 5_001 }, expected, now), /inconsistent/);
assert.throws(() => parseVNextQuoteResponse({ ...response, outputAsset: inputAsset }, expected, now), /inconsistent/);
assert.throws(() => parseVNextQuoteResponse({ ...response, attempts: [
  { ...response.attempts[0], protectedOutputAtomic: "1000000000000000000001" },
  response.attempts[1]
] }, expected, now), /output is invalid/);
assert.throws(() => parseVNextQuoteResponse({ ...response, attempts: [
  response.attempts[0],
  { ...response.attempts[1], expectedOutputAtomic: "1" }
] }, expected, now), /partial economics/);
assert.throws(() => parseVNextQuoteResponse({ ...response, attempts: [
  { ...response.attempts[0], protectedNetOutputAtomic: response.attempts[0].protectedOutputAtomic },
  response.attempts[1]
] }, expected, now), /wallet-gas economics/);
assert.throws(() => parseVNextQuoteResponse({ ...response, attempts: [
  { ...response.attempts[0], netEconomics: { ...response.attempts[0].netEconomics!, rmtFee: {
    ...response.attempts[0].netEconomics!.rmtFee,
    expectedFeeAtomic: "1"
  } } },
  response.attempts[1]
] }, expected, now), /disabled commitment exposed fee authority/);

const gaslessAttempt = {
  ...response.attempts[0],
  provider: "zero-x-gasless" as const,
  providerLabel: "0x Gasless",
  providerFamily: "zeroex" as const,
  executionKind: "gasless" as const,
  userPaysGas: false,
  providerFeeAsset: inputAsset,
  providerFeeAtomic: "150000",
  gasSponsorshipFeeAsset: inputAsset,
  gasSponsorshipFeeAtomic: "22000",
  networkFeeNativeSymbol: null,
  protectedNetOutputAtomic: response.attempts[0].protectedOutputAtomic,
  costState: null
};
assert.equal(parseVNextQuoteResponse({ ...response, attempts: [gaslessAttempt] }, expected, now).attempts[0].userPaysGas, false);
assert.throws(() => parseVNextQuoteResponse({
  ...response,
  attempts: [{ ...gaslessAttempt, gasSponsorshipFeeAtomic: null }]
}, expected, now), /fee economics/);

const route = readFileSync(new URL("../../app/api/vnext/quotes/route.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../server/vnext-provider-adapter.ts", import.meta.url), "utf8");
const sushiAdapter = readFileSync(new URL("../server/vnext-sushi-adapter.ts", import.meta.url), "utf8");
const uniswapAdapter = readFileSync(new URL("../server/vnext-uniswap-v3-adapter.ts", import.meta.url), "utf8");
const zeroXAdapter = readFileSync(new URL("../server/vnext-zero-x-adapter.ts", import.meta.url), "utf8");
const uniswapXAdapter = readFileSync(new URL("../server/vnext-uniswapx-adapter.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const sushi = readFileSync(new URL("../server/sushi-trade.ts", import.meta.url), "utf8");
const uniswap = readFileSync(new URL("../server/vnext-uniswap-quote.ts", import.meta.url), "utf8");
assert.match(route, /requireAuthenticatedTradeWallet/);
assert.match(route, /readVNextVerifiedAssetIdentity/);
assert.match(route, /quoteRobinhoodVNextExecution/);
assert.doesNotMatch(route, /Native ETH settlement is not enabled/);
assert.match(route, /Cache-Control": "no-store/);
assert.doesNotMatch(route, /quoteSushiAssetRoute|quoteVNextUniswapDirect/);
assert.match(engine, /Promise\.all/);
assert.match(engine, /authorizationReady: false/);
assert.match(engine, /networkFeeNativeAtomic: null/);
assert.match(sushiAdapter, /quoteSushiAssetRoute/);
assert.match(sushiAdapter, /isRobinhoodNativeAsset\(request\.outputAsset\)/);
assert.match(uniswapAdapter, /quoteVNextUniswapForUser/);
assert.match(uniswap, /unwrapWETH9/);
assert.match(composer, /ROBINHOOD_NATIVE_ASSET_ADDRESS/);
assert.match(zeroXAdapter, /RMT_VNEXT_ZEROX_OBSERVATION_ENABLED/);
assert.match(uniswapXAdapter, /RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED/);
assert.match(uniswapXAdapter, /protocols: \["UNISWAPX_V3"\]/);
assert.match(uniswapXAdapter, /ROBINHOOD_UNIVERSAL_ROUTER_VERSION = "2\.1\.1"/);
assert.doesNotMatch(uniswapXAdapter, /\/order|\/swap|writeContract|sendTransaction|signTypedData|privateKey/);
assert.match(zeroXAdapter, /"\/gasless\/price"/);
assert.match(zeroXAdapter, /"\/swap\/allowance-holder\/price"/);
assert.doesNotMatch(zeroXAdapter, /"\/(?:gasless|swap\/allowance-holder)\/quote"/);
assert.doesNotMatch(zeroXAdapter, /writeContract|sendTransaction|signTypedData|privateKey/);
assert.doesNotMatch(route, /writeContract|sendTransaction|signTypedData|calldata|database|firestore/);
assert.match(sushi, /quoteSushiAssetRoute/);
assert.match(uniswap, /quoteExactInputSingle/);
assert.match(composer, /\/api\/vnext\/quotes/);
assert.match(composer, /One tap checks the best route and prepares an explicit external-wallet review/);
assert.match(composer, /Protected user output after RMT fee, before network fee/);
assert.match(composer, /attempt\.userPaysGas === null \? "gas unknown"/);
assert.doesNotMatch(composer, /writeContract|sendTransaction|signTypedData/);

console.log("RMT VNext live quote observation smoke checks passed.");
