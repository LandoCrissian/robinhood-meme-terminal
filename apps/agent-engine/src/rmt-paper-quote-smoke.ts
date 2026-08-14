import assert from "node:assert/strict";
import { hashCanonicalPayload, hashPaperQuoteEvidence } from "../../../packages/agent-core/src/index.ts";
import {
  RmtPaperQuoteService,
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteReader,
  type RmtPaperQuoteReaderInput,
} from "./rmt-paper-quote.ts";

const inputAsset = "0x1111111111111111111111111111111111111111";
const outputAsset = "0x2222222222222222222222222222222222222222";
const now = 100_000;

function attempt(input: {
  provider: "sushi" | "uniswap-v3" | "uniswapx" | "zero-x-swap" | "zero-x-gasless" | "up-v2" | "up-cl";
  protectedOutputAtomic: string;
  expectedOutputAtomic?: string;
  priceImpact: number;
  strictVerificationAvailable: boolean;
  quotedAtMs?: number;
  expiresAtMs?: number;
  latencyMs?: number;
  userPaysGas?: boolean;
}) {
  const userPaysGas = input.userPaysGas ?? true;
  return {
    provider: input.provider,
    adapterVersion: 1,
    status: "indicative",
    chainId: 4_663,
    inputAsset,
    outputAsset,
    inputAmountAtomic: "1000000",
    expectedOutputAtomic: input.expectedOutputAtomic ?? input.protectedOutputAtomic,
    protectedOutputAtomic: input.protectedOutputAtomic,
    outputDecimals: 18,
    priceImpact: input.priceImpact,
    quotedAtMs: input.quotedAtMs ?? 99_900,
    expiresAtMs: input.expiresAtMs ?? 120_000,
    latencyMs: input.latencyMs ?? 20,
    strictVerificationAvailable: input.strictVerificationAvailable,
    authorizationReady: false,
    userPaysGas,
    networkFeeNativeAtomic: null,
    networkFeeNativeSymbol: userPaysGas ? "ETH" : null,
    costState: userPaysGas ? "network_fee_pending" : null,
  };
}

function response(attempts: unknown[]) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    chainId: 4_663,
    inputAsset,
    outputAsset,
    inputAmountAtomic: "1000000",
    requestedAtMs: 99_850,
    completedAtMs: 99_950,
    attempts,
  };
}

class FakeQuoteReader implements RmtPaperQuoteReader {
  readonly sourceId = "rmt-vnext-normalized-quote-reader-v1";
  calls = 0;
  lastInput: RmtPaperQuoteReaderInput | undefined;
  private readonly payload: unknown;

  constructor(payload: unknown) {
    this.payload = payload;
  }

  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
    this.calls += 1;
    this.lastInput = structuredClone(input);
    return structuredClone(this.payload);
  }
}

const reader = new FakeQuoteReader(response([
  attempt({ provider: "uniswapx", protectedOutputAtomic: "990000000000000000", priceImpact: 0.004, strictVerificationAvailable: false, latencyMs: 5 }),
  attempt({ provider: "uniswap-v3", protectedOutputAtomic: "980000000000000000", expectedOutputAtomic: "985000000000000000", priceImpact: 0.00121, strictVerificationAvailable: true, latencyMs: 30 }),
  attempt({ provider: "sushi", protectedOutputAtomic: "970000000000000000", priceImpact: 0.001, strictVerificationAvailable: true, latencyMs: 10 }),
]));
const service = new RmtPaperQuoteService({ reader, policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 } });
const selected = await service.quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now });
assert.equal(reader.calls, 1);
assert.equal(reader.lastInput?.chainId, 4_663);
assert.equal(selected.provider, "uniswap-v3");
assert.equal(selected.evidence.outputAmountAtomic, "980000000000000000");
assert.equal(selected.evidence.priceImpactBps, 13);
assert.equal(selected.evidence.inputAssetId, `eip155:4663/contract:${inputAsset}`);
assert.equal(selected.evidence.outputAssetId, `eip155:4663/contract:${outputAsset}`);
assert.equal(selected.evidence.providerId, "rmt-vnext:uniswap-v3:adapter-v1");
assert.equal(selected.evidence.observedAt, 99_900);
assert.equal(selected.evidence.expiresAt, 120_000);
assert.equal(selected.costState, "NETWORK_FEE_PENDING");
assert.equal(selected.comparison.attempts.length, 3);
assert.equal(selected.comparisonHash, hashCanonicalPayload(selected.comparison));
const selectedAttempt = selected.comparison.attempts.find((candidate) => candidate.provider === selected.provider)!;
assert.equal(selected.selectedAttemptHash, hashCanonicalPayload(selectedAttempt));
const { evidenceHash, ...evidencePayload } = selected.evidence;
assert.equal(evidenceHash, hashPaperQuoteEvidence(evidencePayload));
assert.match(selected.resultHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertRmtPaperQuoteResult(selected));

const tampered = structuredClone(selected);
tampered.comparison.attempts[0]!.protectedOutputAtomic = "1";
assert.throws(() => assertRmtPaperQuoteResult(tampered), /comparison hash mismatch/);
assert.equal("fill" in service, false);
assert.equal("submitPaperOrder" in service, false);
assert.equal("execute" in service, false);

const tinyImpact = await new RmtPaperQuoteService({
  reader: new FakeQuoteReader(response([
    attempt({ provider: "uniswap-v3", protectedOutputAtomic: "980000000000000000", priceImpact: 0.0000001, strictVerificationAvailable: true }),
  ])),
  policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 1 },
}).quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now });
assert.equal(tinyImpact.evidence.priceImpactBps, 1);

await assert.rejects(
  () => new RmtPaperQuoteService({
    reader: new FakeQuoteReader(response([
      attempt({ provider: "uniswap-v3", protectedOutputAtomic: "980000000000000000", priceImpact: 0.004, strictVerificationAvailable: true }),
    ])),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now }),
  /no strictly verified paper quote satisfies/,
);

const staleResponse = {
  ...response([
    attempt({ provider: "uniswap-v3", protectedOutputAtomic: "980000000000000000", priceImpact: 0.001, strictVerificationAvailable: true, quotedAtMs: 90_000, expiresAtMs: 120_000 }),
  ]),
  requestedAtMs: 89_900,
  completedAtMs: 90_100,
};
await assert.rejects(
  () => new RmtPaperQuoteService({
    reader: new FakeQuoteReader(staleResponse),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now }),
  /no strictly verified paper quote satisfies/,
);

await assert.rejects(
  () => new RmtPaperQuoteService({
    reader: new FakeQuoteReader(response([
      attempt({ provider: "uniswap-v3", protectedOutputAtomic: "980000000000000000", priceImpact: 0.001, strictVerificationAvailable: true, quotedAtMs: 104_975, expiresAtMs: 120_000 }),
    ])),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now }),
  /timestamp is inconsistent with comparison window/,
);

const authorizationPayload = response([
  { ...attempt({ provider: "uniswap-v3", protectedOutputAtomic: "980000000000000000", priceImpact: 0.001, strictVerificationAvailable: true }), authorizationReady: true },
]);
await assert.rejects(
  () => new RmtPaperQuoteService({
    reader: new FakeQuoteReader(authorizationPayload),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now }),
  /cannot claim wallet authorization readiness/,
);

const malformedPartial = response([{
  provider: "sushi",
  adapterVersion: 1,
  status: "no_route",
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "1000000",
  expectedOutputAtomic: "1",
  protectedOutputAtomic: null,
  outputDecimals: null,
  priceImpact: null,
  quotedAtMs: null,
  expiresAtMs: null,
  latencyMs: 10,
  strictVerificationAvailable: false,
  authorizationReady: false,
  userPaysGas: null,
  networkFeeNativeAtomic: null,
  networkFeeNativeSymbol: null,
  costState: null,
}]);
await assert.rejects(
  () => new RmtPaperQuoteService({
    reader: new FakeQuoteReader(malformedPartial),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset, outputAsset, inputAmountAtomic: "1000000", observedAtMs: now }),
  /unavailable paper quote attempt exposed partial economics/,
);

console.log("rmt-paper-quote smoke: ok");
