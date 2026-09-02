import assert from "node:assert/strict";
import { getAddress, zeroAddress } from "viem";
import {
  disabledVNextFeeEconomics,
  quoteVNextExecutionProviders,
  type VNextProviderQuoteRequest,
  type VNextQuoteProviderAdapter
} from "../server/vnext-provider-adapter";
import {
  createRmtExecutionFeeV2Policy,
  normalizeRmtExecutionFeeV2Input,
  type RmtExecutionFeeV2Economics
} from "./execution-fee-policy-v2";
import { VNEXT_DIRECT_NO_RMT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";
import {
  assertVNextQuoteAttempt,
  selectVNextRoute,
  type VNextQuoteAttempt,
  type VNextQuoteProvider
} from "./quote-observation";

const now = 1_788_000_000_000;
const inputAsset = zeroAddress;
const outputAsset = getAddress("0x39dBED3a2bd333467115dE45665cC57F813C4571");
const pair = getAddress("0x8018Ee3ad3c0321bE0e69536733CD28e29564dD4");
const executorV2 = getAddress("0xB4bF1d99a3BF9201f8197682dcD2bF97725D6230");
const executorV3 = getAddress("0xef729FbC9aDfC431ae46ECc198144160e2dD7832");
const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
const expected = { inputAsset, outputAsset, inputAmountAtomic: "100000000000000" };
const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "51296658" });

function economics(expectedOutputAtomic: string, protectedOutputAtomic: string) {
  return normalizeRmtExecutionFeeV2Input({
    policy,
    inputAssetId: "eip155:4663/native",
    outputAssetId: `eip155:4663/contract:${outputAsset.toLowerCase()}`,
    userGrossInputAtomic: expected.inputAmountAtomic,
    providerGrossExpectedOutputAtomic: expectedOutputAtomic,
    providerProtectedOutputAtomic: protectedOutputAtomic,
    settlementMode: "v2-atomic-input-fee"
  });
}

function atomicAttempt(input: {
  provider: "uniswap-v2" | "uniswap-v3";
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  publicWalletExecutionEligible?: boolean;
}): VNextQuoteAttempt {
  const isV2 = input.provider === "uniswap-v2";
  return {
    provider: input.provider,
    providerLabel: isV2 ? "Uniswap v2" : "Uniswap v3",
    providerFamily: "uniswap",
    adapterVersion: 1,
    status: "indicative",
    chainId: 4_663,
    inputAsset,
    outputAsset,
    inputAmountAtomic: expected.inputAmountAtomic,
    expectedOutputAtomic: input.expectedOutputAtomic,
    protectedOutputAtomic: input.protectedOutputAtomic,
    outputDecimals: 18,
    priceImpact: null,
    liquidityFeeEvidence: isV2 ? [{
      source: "uniswap-v2-factory",
      poolAddress: pair,
      fee: 30,
      denominator: 10_000,
      stable: null,
      tickSpacing: null,
      observedBlock: "52263645",
      observedBlockHash: `0x${"a".repeat(64)}` as `0x${string}`
    }] : [],
    quotedAtMs: now - 100,
    expiresAtMs: now + 30_000,
    latencyMs: isV2 ? 20 : 10,
    executionKind: "direct_amm",
    strictVerificationAvailable: true,
    publicWalletExecutionEligible: input.publicWalletExecutionEligible,
    userPaysGas: true,
    providerFeeAsset: null,
    providerFeeAtomic: null,
    gasSponsorshipFeeAsset: null,
    gasSponsorshipFeeAtomic: null,
    explicitProviderFeeOutputAtomic: null,
    netEconomics: null,
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    executionTarget: isV2 ? executorV2 : executorV3,
    feeV2Economics: economics(input.expectedOutputAtomic, input.protectedOutputAtomic),
    networkFeeNativeAtomic: null,
    networkFeeNativeSymbol: "ETH",
    protectedNetOutputAtomic: null,
    costState: "network_fee_pending",
    authorizationReady: false,
    detail: "Test-only admitted V2 atomic input-fee quote."
  };
}

const validV2 = atomicAttempt({
  provider: "uniswap-v2",
  expectedOutputAtomic: "544529505644669346",
  protectedOutputAtomic: "539084210588222652",
  publicWalletExecutionEligible: false
});
const validV3 = atomicAttempt({
  provider: "uniswap-v3",
  expectedOutputAtomic: "573880000000000000",
  protectedOutputAtomic: "568141000000000000",
  publicWalletExecutionEligible: true
});

async function run() {
assert.equal(policy.policyHash, "0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484");
assert.equal(validV2.feeV2Economics?.expectedFeeAtomic, "250000000000");
assert.equal(validV2.feeV2Economics?.providerInputAtomic, "99750000000000");
assert.doesNotThrow(() => assertVNextQuoteAttempt(validV2, expected, now));
assert.doesNotThrow(() => assertVNextQuoteAttempt(validV3, expected, now));

const quoteOnlyProviders = [
  "uniswap-v4", "up-v2", "up-cl", "sushi", "uniswapx", "zero-x-swap", "zero-x-gasless"
] as const satisfies readonly VNextQuoteProvider[];

function quoteOnlyAttempt(provider: (typeof quoteOnlyProviders)[number]) {
  const liquidityFeeEvidence: VNextQuoteAttempt["liquidityFeeEvidence"] = provider === "up-v2" ? [{
    source: "up-v2-factory",
    poolAddress: pair,
    fee: 30,
    denominator: 10_000,
    stable: false,
    tickSpacing: null,
    observedBlock: "52263645",
    observedBlockHash: `0x${"a".repeat(64)}` as `0x${string}`
  }] : provider === "up-cl" ? [{
    source: "up-cl-pool",
    poolAddress: pair,
    fee: 3_000,
    denominator: 1_000_000,
    stable: null,
    tickSpacing: 60,
    observedBlock: "52263645",
    observedBlockHash: `0x${"a".repeat(64)}` as `0x${string}`
  }] : [];
  const attempt: VNextQuoteAttempt = {
    ...validV2,
    provider,
    providerLabel: provider,
    providerFamily: provider === "sushi"
      ? "sushi"
      : provider === "up-v2" || provider === "up-cl"
        ? "up"
        : provider === "uniswapx"
          ? "uniswapx"
          : provider === "zero-x-swap" || provider === "zero-x-gasless"
            ? "zeroex"
            : "uniswap",
    liquidityFeeEvidence,
    v4Evidence: provider === "uniswap-v4" ? {
      poolId: `0x${"b".repeat(64)}` as `0x${string}`,
      currency0: inputAsset,
      currency1: outputAsset,
      fee: 3_000,
      tickSpacing: 60,
      hooks: zeroAddress,
      recipient: treasury,
      provenance: "canonical-market-indexer+uniswap-v4-quoter+robinhood-rpc",
      observedBlock: "52263645",
      observedBlockHash: `0x${"a".repeat(64)}` as `0x${string}`,
      observedAtMs: now - 100
    } : undefined
  };
  return attempt;
}

for (const provider of quoteOnlyProviders) {
  assert.throws(
    () => assertVNextQuoteAttempt(quoteOnlyAttempt(provider), expected, now),
    /inconsistent V2 fee economics/,
    `${provider} must not claim admitted V2 atomic fee economics`
  );
}

function rejectsV2(mutator: (attempt: VNextQuoteAttempt) => VNextQuoteAttempt, pattern = /execution fee V2|inconsistent V2 fee economics/) {
  assert.throws(() => assertVNextQuoteAttempt(mutator(validV2), expected, now), pattern);
}

rejectsV2((attempt) => ({ ...attempt, settlementMode: VNEXT_DIRECT_NO_RMT_FEE } as unknown as VNextQuoteAttempt));
rejectsV2((attempt) => ({ ...attempt, executionTarget: undefined }));
rejectsV2((attempt) => ({ ...attempt, executionTarget: "not-an-address" }));
rejectsV2((attempt) => ({ ...attempt, netEconomics: disabledVNextFeeEconomics({
  inputAmountAtomic: attempt.inputAmountAtomic,
  expectedOutputAtomic: attempt.expectedOutputAtomic!,
  protectedOutputAtomic: attempt.protectedOutputAtomic!
}) }));
rejectsV2((attempt) => ({ ...attempt, feeV2Economics: { ...attempt.feeV2Economics!, userGrossInputAtomic: "100000000000001" } }), /execution fee V2/);
rejectsV2((attempt) => ({ ...attempt, feeV2Economics: { ...attempt.feeV2Economics!, inputAsset: `eip155:4663/contract:${treasury.toLowerCase()}` } }));
rejectsV2((attempt) => ({ ...attempt, feeV2Economics: { ...attempt.feeV2Economics!, outputAsset: `eip155:4663/contract:${treasury.toLowerCase()}` } }));
rejectsV2((attempt) => ({ ...attempt, feeV2Economics: { ...attempt.feeV2Economics!, expectedUserNetOutputAtomic: "544529505644669345" } }));
rejectsV2((attempt) => ({ ...attempt, feeV2Economics: { ...attempt.feeV2Economics!, protectedUserNetOutputAtomic: "539084210588222651" } }));
rejectsV2((attempt) => ({ ...attempt, feeV2Economics: { ...attempt.feeV2Economics!, feeBps: 24 } as unknown as RmtExecutionFeeV2Economics }), /execution fee V2/);

const request: VNextProviderQuoteRequest = {
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: expected.inputAmountAtomic,
  amountIn: BigInt(expected.inputAmountAtomic),
  recipient: treasury,
  inputIdentity: { address: inputAsset, symbol: "ETH", decimals: 18 },
  outputIdentity: { address: outputAsset, symbol: "PONS", decimals: 18 }
};
const v2Adapter: VNextQuoteProviderAdapter = {
  provider: "uniswap-v2",
  providerLabel: "Uniswap v2",
  providerFamily: "uniswap",
  adapterVersion: 1,
  executionKind: "direct_amm",
  capabilities: { strictVerification: true, walletAuthorization: true },
  async quote() {
    const quotedAtMs = Date.now();
    return { ...validV2, quotedAtMs, expiresAtMs: quotedAtMs + 30_000 };
  }
};
const collected = await quoteVNextExecutionProviders(request, [v2Adapter]);
assert.equal(collected[0].status, "indicative", "the source-admitted V2 attempt must survive adapter collection");

const v3Wins = selectVNextRoute([validV2, validV3], { publicExecutionOnly: true });
assert.equal(v3Wins.bestObserved?.provider, "uniswap-v3");
assert.equal(v3Wins.verificationCandidate?.provider, "uniswap-v3");

const strongerV2 = atomicAttempt({
  provider: "uniswap-v2",
  expectedOutputAtomic: "584000000000000000",
  protectedOutputAtomic: "578000000000000000",
  publicWalletExecutionEligible: false
});
assert.doesNotThrow(() => assertVNextQuoteAttempt(strongerV2, expected, now));
const v2WinsObserved = selectVNextRoute([strongerV2, validV3], { publicExecutionOnly: true });
assert.equal(v2WinsObserved.bestObserved?.provider, "uniswap-v2", "validation must not rewrite normal ranking");
assert.equal(v2WinsObserved.verificationCandidate?.provider, "uniswap-v3", "Production public scope keeps V2 quote-only");

const controlledV2 = { ...strongerV2, publicWalletExecutionEligible: true };
const controlledSelection = selectVNextRoute([controlledV2, validV3], { publicExecutionOnly: true });
assert.equal(controlledSelection.bestObserved?.provider, "uniswap-v2");
assert.equal(controlledSelection.verificationCandidate?.provider, "uniswap-v2", "controlled provider scope may advance V2 to strict verification");

console.log("RMT Uniswap V2 V2 quote-validator admission smoke checks passed.");
}

void run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
