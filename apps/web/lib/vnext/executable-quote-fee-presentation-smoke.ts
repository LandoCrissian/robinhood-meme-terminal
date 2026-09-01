import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { normalizeDisabledRmtFee } from "./execution-fee-policy";
import { createRmtExecutionFeeV2Policy, normalizeRmtExecutionFeeV2Input } from "./execution-fee-policy-v2";
import { formatVNextFeeAtomic, vNextQuoteFeePresentation } from "./executable-quote-fee-presentation";
import { selectVNextRoute, type VNextQuoteAttempt } from "./quote-observation";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";

const input = getAddress("0x0000000000000000000000000000000000000000");
const output = getAddress("0x0000000000000000000000000000000000001001");
const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
const executor = getAddress("0xef729FbC9aDfC431ae46ECc198144160e2dD7832");
const pool = getAddress("0x1111111111111111111111111111111111111111");
const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "51296658" });
const grossInput = "100000000000000";

function attempt(inputAttempt: Partial<VNextQuoteAttempt> & Pick<VNextQuoteAttempt, "provider" | "providerLabel" | "protectedOutputAtomic">): VNextQuoteAttempt {
  return {
    provider: inputAttempt.provider,
    providerLabel: inputAttempt.providerLabel,
    providerFamily: inputAttempt.provider.startsWith("uniswap") ? "uniswap" : "sushi",
    adapterVersion: 1,
    status: "indicative",
    chainId: 4_663,
    inputAsset: input,
    outputAsset: output,
    inputAmountAtomic: grossInput,
    expectedOutputAtomic: inputAttempt.expectedOutputAtomic ?? inputAttempt.protectedOutputAtomic,
    protectedOutputAtomic: inputAttempt.protectedOutputAtomic,
    outputDecimals: 18,
    priceImpact: 0.001,
    liquidityFeeEvidence: inputAttempt.liquidityFeeEvidence ?? [],
    quotedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
    latencyMs: inputAttempt.latencyMs ?? 10,
    executionKind: "direct_amm",
    strictVerificationAvailable: inputAttempt.strictVerificationAvailable ?? true,
    publicWalletExecutionEligible: inputAttempt.publicWalletExecutionEligible ?? false,
    userPaysGas: true,
    providerFeeAsset: null,
    providerFeeAtomic: null,
    gasSponsorshipFeeAsset: null,
    gasSponsorshipFeeAtomic: null,
    explicitProviderFeeOutputAtomic: null,
    netEconomics: inputAttempt.netEconomics ?? null,
    settlementMode: inputAttempt.settlementMode,
    executionTarget: inputAttempt.executionTarget,
    feeV2Economics: inputAttempt.feeV2Economics,
    networkFeeNativeAtomic: null,
    networkFeeNativeSymbol: "ETH",
    protectedNetOutputAtomic: null,
    costState: "network_fee_pending",
    authorizationReady: false,
    detail: "Deterministic fee presentation fixture."
  };
}

const v3Economics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: "eip155:4663/native",
  outputAssetId: `eip155:4663/contract:${output.toLowerCase()}`,
  userGrossInputAtomic: grossInput,
  providerGrossExpectedOutputAtomic: "8586172043977260462",
  providerProtectedOutputAtomic: "8500310323537487857",
  settlementMode: "v2-atomic-input-fee"
});
const v3 = attempt({
  provider: "uniswap-v3",
  providerLabel: "Uniswap V3",
  expectedOutputAtomic: v3Economics.expectedUserNetOutputAtomic,
  protectedOutputAtomic: v3Economics.protectedUserNetOutputAtomic,
  publicWalletExecutionEligible: true,
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
  executionTarget: executor,
  feeV2Economics: v3Economics
});
const v2 = attempt({
  provider: "uniswap-v2",
  providerLabel: "Uniswap V2",
  expectedOutputAtomic: "8650000000000000000",
  protectedOutputAtomic: "8560000000000000000",
  publicWalletExecutionEligible: false,
  liquidityFeeEvidence: [{
    source: "uniswap-v2-factory",
    poolAddress: pool,
    fee: 30,
    denominator: 10_000,
    stable: null,
    tickSpacing: null,
    observedBlock: "51760163",
    observedBlockHash: `0x${"1".repeat(64)}`
  }],
  netEconomics: normalizeDisabledRmtFee({
    userGrossInputAtomic: grossInput,
    providerGrossExpectedOutputAtomic: "8650000000000000000",
    providerProtectedOutputAtomic: "8560000000000000000",
    reason: "provider_not_admitted"
  })
});

const splitSelection = selectVNextRoute([v2, v3], { publicExecutionOnly: true });
const split = vNextQuoteFeePresentation({
  bestObserved: splitSelection.bestObserved,
  bestExecutable: splitSelection.verificationCandidate
});
assert.equal(splitSelection.bestObserved?.provider, "uniswap-v2");
assert.equal(splitSelection.verificationCandidate?.provider, "uniswap-v3");
assert.equal(split.separateContexts, true);
assert.deepEqual(split.bestObserved, { state: "no_rmt_fee" });
assert.equal(split.bestExecutable?.state, "planned");
assert.equal(split.bestExecutable?.state === "planned" ? split.bestExecutable.feeBps : null, 25);
assert.equal(split.bestExecutable?.state === "planned" ? split.bestExecutable.expectedFeeAtomic : null, "250000000000");
assert.equal(split.bestExecutable?.state === "planned" ? split.bestExecutable.providerInputAtomic : null, "99750000000000");
assert.equal(splitSelection.bestObserved?.protectedOutputAtomic, "8560000000000000000");

const same = vNextQuoteFeePresentation({ bestObserved: v3, bestExecutable: v3 });
assert.equal(same.separateContexts, false);
assert.equal(same.bestObserved?.state, "planned");
assert.equal(same.bestExecutable?.state, "planned");

const v2FeeCandidate = attempt({
  provider: "uniswap-v2",
  providerLabel: "Uniswap V2",
  expectedOutputAtomic: v3Economics.expectedUserNetOutputAtomic,
  protectedOutputAtomic: v3Economics.protectedUserNetOutputAtomic,
  publicWalletExecutionEligible: true,
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
  executionTarget: getAddress("0x2222222222222222222222222222222222222222"),
  feeV2Economics: v3Economics
});
const v2CandidatePresentation = vNextQuoteFeePresentation({
  bestObserved: v2FeeCandidate,
  bestExecutable: v2FeeCandidate
});
assert.equal(v2CandidatePresentation.separateContexts, false);
assert.equal(v2CandidatePresentation.bestExecutable?.state, "planned");
assert.equal(
  v2CandidatePresentation.bestExecutable?.state === "planned"
    ? v2CandidatePresentation.bestExecutable.feeBps
    : null,
  25
);
assert.equal(
  v2CandidatePresentation.bestExecutable?.state === "planned"
    ? v2CandidatePresentation.bestExecutable.providerInputAtomic
    : null,
  "99750000000000"
);

const noExecutable = vNextQuoteFeePresentation({ bestObserved: v2, bestExecutable: undefined });
assert.equal(noExecutable.bestObserved?.state, "no_rmt_fee");
assert.equal(noExecutable.bestExecutable, null);

const incompleteV3 = attempt({
  provider: "uniswap-v3",
  providerLabel: "Uniswap V3",
  protectedOutputAtomic: "8500310323537487857",
  publicWalletExecutionEligible: true,
  settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
  executionTarget: executor
});
const incomplete = vNextQuoteFeePresentation({ bestObserved: incompleteV3, bestExecutable: incompleteV3 });
assert.deepEqual(incomplete.bestExecutable, { state: "unavailable" });

const v4 = attempt({
  provider: "uniswap-v4",
  providerLabel: "Uniswap V4",
  protectedOutputAtomic: "8700000000000000000",
  publicWalletExecutionEligible: false,
  netEconomics: normalizeDisabledRmtFee({
    userGrossInputAtomic: grossInput,
    providerGrossExpectedOutputAtomic: "8750000000000000000",
    providerProtectedOutputAtomic: "8700000000000000000",
    reason: "provider_not_admitted"
  })
});
const v4SplitSelection = selectVNextRoute([v4, v3], { publicExecutionOnly: true });
const v4Split = vNextQuoteFeePresentation({ bestObserved: v4SplitSelection.bestObserved, bestExecutable: v4SplitSelection.verificationCandidate });
assert.equal(v4SplitSelection.bestObserved?.provider, "uniswap-v4");
assert.equal(v4Split.bestObserved?.state, "no_rmt_fee");
assert.equal(v4Split.bestExecutable?.state, "planned");

const erc20Economics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: `eip155:4663/contract:${output.toLowerCase()}`,
  outputAssetId: "eip155:4663/native",
  userGrossInputAtomic: "1000000",
  providerGrossExpectedOutputAtomic: "1000000000000",
  providerProtectedOutputAtomic: "990000000000",
  settlementMode: "v2-atomic-input-fee"
});
assert.equal(erc20Economics.feeAsset, `eip155:4663/contract:${output.toLowerCase()}`);
assert.equal(v3Economics.feeAsset, "eip155:4663/native");
assert.equal(formatVNextFeeAtomic("1", 18), "0.000000000000000001");
assert.equal(formatVNextFeeAtomic("250000000000", 18), "0.00000025");

assert.equal(getAddress(executor as Address), "0xef729FbC9aDfC431ae46ECc198144160e2dD7832");
console.log("VNext executable-quote fee presentation smoke passed.");
