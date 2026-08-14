import assert from "node:assert/strict";
import {
  RmtPaperQuoteService,
  type RmtPaperQuoteReader,
  type RmtPaperQuoteReaderInput,
} from "./rmt-paper-quote.ts";
import {
  ROBINHOOD_NATIVE_ETH_ASSET_ID,
  assertPaperFillCostPlan,
  buildPaperFillCostPlan,
} from "./paper-fill-cost.ts";

const inputAsset = "0x1111111111111111111111111111111111111111";
const outputAsset = "0x2222222222222222222222222222222222222222";
const now = 100_000;

function quoteAttempt(input: {
  userPaysGas: boolean;
  networkFeeNativeAtomic: string | null;
}) {
  return {
    provider: "uniswap-v3",
    adapterVersion: 1,
    status: "indicative",
    chainId: 4_663,
    inputAsset,
    outputAsset,
    inputAmountAtomic: "1000000",
    expectedOutputAtomic: "985000000000000000",
    protectedOutputAtomic: "980000000000000000",
    outputDecimals: 18,
    priceImpact: 0.001,
    quotedAtMs: 99_900,
    expiresAtMs: 120_000,
    latencyMs: 20,
    strictVerificationAvailable: true,
    authorizationReady: false,
    userPaysGas: input.userPaysGas,
    networkFeeNativeAtomic: input.userPaysGas ? input.networkFeeNativeAtomic : null,
    networkFeeNativeSymbol: input.userPaysGas ? "ETH" : null,
    costState: input.userPaysGas ? "network_fee_pending" : null,
  };
}

function response(attempt: unknown) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    chainId: 4_663,
    inputAsset,
    outputAsset,
    inputAmountAtomic: "1000000",
    requestedAtMs: 99_850,
    completedAtMs: 99_950,
    attempts: [attempt],
  };
}

class FakeReader implements RmtPaperQuoteReader {
  readonly sourceId = "rmt-vnext-normalized-quote-reader-v1";
  private readonly payload: unknown;

  constructor(payload: unknown) {
    this.payload = payload;
  }

  async compare(_input: RmtPaperQuoteReaderInput): Promise<unknown> {
    return structuredClone(this.payload);
  }
}

async function quote(payload: unknown) {
  return new RmtPaperQuoteService({
    reader: new FakeReader(payload),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now });
}

const pendingQuote = await quote(response(quoteAttempt({ userPaysGas: true, networkFeeNativeAtomic: null })));
const pending = buildPaperFillCostPlan(pendingQuote);
assert.equal(pending.status, "BLOCKED_NETWORK_FEE_PENDING");
assert.equal(pending.networkGasAssetId, ROBINHOOD_NATIVE_ETH_ASSET_ID);
assert.equal(pending.networkGasCostAtomic, null);
assert.equal(pending.costs, null);
assert.doesNotThrow(() => assertPaperFillCostPlan(pending, pendingQuote));

const knownGasQuote = await quote(response(quoteAttempt({ userPaysGas: true, networkFeeNativeAtomic: "21000000000000" })));
const knownGas = buildPaperFillCostPlan(knownGasQuote);
assert.equal(knownGas.status, "READY");
assert.equal(knownGas.networkGasAssetId, ROBINHOOD_NATIVE_ETH_ASSET_ID);
assert.equal(knownGas.networkGasCostAtomic, "21000000000000");
assert.equal(knownGas.costs?.feeAmountAtomic, "0");
assert.equal(knownGas.costs?.feeAssetId, undefined);
assert.equal(knownGas.costs?.gasAssetId, ROBINHOOD_NATIVE_ETH_ASSET_ID);
assert.equal(knownGas.costs?.gasCostAtomic, "21000000000000");
assert.doesNotThrow(() => assertPaperFillCostPlan(knownGas, knownGasQuote));

const sponsoredQuote = await quote(response(quoteAttempt({ userPaysGas: false, networkFeeNativeAtomic: null })));
const sponsored = buildPaperFillCostPlan(sponsoredQuote);
assert.equal(sponsored.status, "READY");
assert.equal(sponsored.networkGasAssetId, null);
assert.equal(sponsored.networkGasCostAtomic, null);
assert.deepEqual(sponsored.costs, { feeAmountAtomic: "0", gasCostAtomic: "0" });
assert.doesNotThrow(() => assertPaperFillCostPlan(sponsored, sponsoredQuote));

const tamperedGas = structuredClone(knownGas);
tamperedGas.costs!.gasCostAtomic = "1";
assert.throws(() => assertPaperFillCostPlan(tamperedGas, knownGasQuote), /gas debit does not match/);

const doubleCounted = structuredClone(sponsored);
doubleCounted.costs!.feeAmountAtomic = "25";
doubleCounted.costs!.feeAssetId = outputAsset;
assert.throws(() => assertPaperFillCostPlan(doubleCounted, sponsoredQuote), /must not double-count/);

const wrongQuote = await quote(response(quoteAttempt({ userPaysGas: true, networkFeeNativeAtomic: "22000000000000" })));
assert.throws(() => assertPaperFillCostPlan(knownGas, wrongQuote), /quote result mismatch/);

assert.equal("fill" in knownGas, false);
assert.equal("execute" in knownGas, false);
console.log("paper-fill-cost smoke: ok");
