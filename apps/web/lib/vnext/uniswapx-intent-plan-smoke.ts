import assert from "node:assert/strict";
import { getAddress, hashStruct, hashTypedData, zeroAddress } from "viem";
import {
  buildVNextUniswapXIntentPlan,
  parseVNextUniswapXIntentPlan,
  type VNextUniswapXIntentExpectation,
  type VNextUniswapXIntentPlan
} from "../server/vnext-uniswapx-intent-plan";
import type { PreparedVNextUniswapXIntent } from "../server/vnext-uniswapx-adapter";
import {
  ROBINHOOD_UNISWAPX_V3_ORDER_TYPES,
  ROBINHOOD_UNISWAPX_V3_PERMIT_TYPES,
  ROBINHOOD_UNISWAPX_V3_REACTOR,
  ROBINHOOD_UNISWAP_PERMIT2
} from "../server/vnext-uniswapx-order-verifier";

const now = 1_900_000_000_000;
const deadline = "1900000120";
const inputAsset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const outputAsset = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
const cosigner = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const inputAmountAtomic = "1000000000";
const expectedOutputAtomic = "520000000000000000";
const protectedOutputAtomic = "514800000000000000";
const sourceQuoteRequestId = "11111111-1111-4111-8111-111111111111";
const sourceVerificationId = "22222222-2222-4222-8222-222222222222";

const permitData: PreparedVNextUniswapXIntent["permitData"] = {
  domain: { name: "Permit2", chainId: 4_663, verifyingContract: ROBINHOOD_UNISWAP_PERMIT2 },
  types: ROBINHOOD_UNISWAPX_V3_PERMIT_TYPES,
  primaryType: "PermitWitnessTransferFrom",
  message: {
    permitted: { token: inputAsset, amount: inputAmountAtomic },
    spender: ROBINHOOD_UNISWAPX_V3_REACTOR,
    nonce: "7",
    deadline,
    witness: {
      info: {
        reactor: ROBINHOOD_UNISWAPX_V3_REACTOR,
        swapper: recipient,
        nonce: "7",
        deadline,
        additionalValidationContract: zeroAddress,
        additionalValidationData: "0x"
      },
      cosigner,
      startingBaseFee: "100000000",
      baseInput: {
        token: inputAsset,
        startAmount: inputAmountAtomic,
        curve: { relativeBlocks: "655361", relativeAmounts: ["0", "0"] },
        maxAmount: inputAmountAtomic,
        adjustmentPerGweiBaseFee: "0"
      },
      baseOutputs: [{
        token: outputAsset,
        startAmount: expectedOutputAtomic,
        curve: { relativeBlocks: "655361", relativeAmounts: ["0", "5200000000000000"] },
        recipient,
        minAmount: protectedOutputAtomic,
        adjustmentPerGweiBaseFee: "0"
      }]
    }
  }
};

function orderHash(data: typeof permitData) {
  return hashStruct({
    primaryType: "V3DutchOrder",
    types: ROBINHOOD_UNISWAPX_V3_ORDER_TYPES,
    data: data.message.witness as never
  });
}

function permitHash(data: typeof permitData) {
  return hashTypedData({
    domain: data.domain,
    types: data.types,
    primaryType: data.primaryType,
    message: data.message as never
  });
}

const prepared: PreparedVNextUniswapXIntent = {
  provider: "uniswapx",
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic,
  expectedOutputAtomic,
  protectedOutputAtomic,
  recipient,
  orderId: orderHash(permitData),
  deadline,
  permit2: ROBINHOOD_UNISWAP_PERMIT2,
  reactor: ROBINHOOD_UNISWAPX_V3_REACTOR,
  permitPayloadHash: permitHash(permitData),
  permitData,
  submissionPayload: { routing: "DUTCH_V3", quote: { encodedOrder: "0xdeadbeef" } }
};

const expectation: VNextUniswapXIntentExpectation = {
  sourceQuoteRequestId,
  sourceVerificationId,
  inputAsset,
  outputAsset,
  inputAmountAtomic,
  recipient,
  minimumProtectedOutputAtomic: protectedOutputAtomic
};

const plan = buildVNextUniswapXIntentPlan({
  prepared,
  planId: "33333333-3333-4333-8333-333333333333",
  sourceQuoteRequestId,
  sourceVerificationId,
  preparedAtMs: now
});

assert.equal(plan.provider, "uniswapx");
assert.equal(plan.orderKind, "dutch_v3");
assert.equal(plan.authorizationKind, "permit2_witness_signature");
assert.equal(plan.orderHash, prepared.orderId);
assert.equal(plan.permitPayloadHash, prepared.permitPayloadHash);
assert.equal(plan.walletSignatureRequired, true);
assert.equal(plan.walletSignatureEnabled, false);
assert.equal(plan.orderSubmissionEnabled, false);
assert.equal(plan.orderSubmissionRef, null);
assert.equal("submissionPayload" in plan, false);
assert.equal("encodedOrder" in plan, false);
assert.equal(JSON.stringify(plan).includes("deadbeef"), false);
assert.equal(parseVNextUniswapXIntentPlan(plan, expectation, now + 1_000).planId, plan.planId);

function clonePlan() {
  return structuredClone(plan) as VNextUniswapXIntentPlan;
}

function rehash(mutated: VNextUniswapXIntentPlan) {
  mutated.orderHash = hashStruct({
    primaryType: "V3DutchOrder",
    types: ROBINHOOD_UNISWAPX_V3_ORDER_TYPES,
    data: mutated.permitData.message.witness as never
  });
  mutated.permitPayloadHash = hashTypedData({
    domain: mutated.permitData.domain,
    types: mutated.permitData.types,
    primaryType: mutated.permitData.primaryType,
    message: mutated.permitData.message as never
  });
  return mutated;
}

const wrongDomain = clonePlan();
wrongDomain.permitData.domain.verifyingContract = inputAsset;
wrongDomain.permit2 = inputAsset;
wrongDomain.permitPayloadHash = hashTypedData({
  domain: wrongDomain.permitData.domain,
  types: wrongDomain.permitData.types,
  primaryType: wrongDomain.permitData.primaryType,
  message: wrongDomain.permitData.message as never
});
assert.throws(() => parseVNextUniswapXIntentPlan(wrongDomain, expectation, now + 1_000), /changed UniswapX Permit2 domain/);

const wrongReactor = clonePlan();
wrongReactor.reactor = inputAsset;
wrongReactor.permitData.message.spender = inputAsset;
wrongReactor.permitData.message.witness.info.reactor = inputAsset;
rehash(wrongReactor);
assert.throws(() => parseVNextUniswapXIntentPlan(wrongReactor, expectation, now + 1_000), /inconsistent UniswapX intent plan/);

const wrongRecipient = clonePlan();
wrongRecipient.recipient = inputAsset;
wrongRecipient.permitData.message.witness.info.swapper = inputAsset;
wrongRecipient.permitData.message.witness.baseOutputs[0].recipient = inputAsset;
rehash(wrongRecipient);
assert.throws(() => parseVNextUniswapXIntentPlan(wrongRecipient, expectation, now + 1_000), /inconsistent UniswapX intent plan/);

const wrongInputAmount = clonePlan();
wrongInputAmount.inputAmountAtomic = "999999999";
wrongInputAmount.permitData.message.permitted.amount = "999999999";
wrongInputAmount.permitData.message.witness.baseInput.startAmount = "999999999";
wrongInputAmount.permitData.message.witness.baseInput.maxAmount = "999999999";
rehash(wrongInputAmount);
assert.throws(() => parseVNextUniswapXIntentPlan(wrongInputAmount, expectation, now + 1_000), /inconsistent UniswapX intent plan/);

const weakenedOutput = clonePlan();
weakenedOutput.protectedOutputAtomic = "500000000000000000";
weakenedOutput.permitData.message.witness.baseOutputs[0].minAmount = "500000000000000000";
rehash(weakenedOutput);
assert.throws(() => parseVNextUniswapXIntentPlan(weakenedOutput, expectation, now + 1_000), /inconsistent UniswapX intent plan/);

const changedTypes = clonePlan() as VNextUniswapXIntentPlan & { permitData: { types: Record<string, unknown> } };
changedTypes.permitData.types = { ...changedTypes.permitData.types, UnexpectedOrder: [] };
assert.throws(() => parseVNextUniswapXIntentPlan(changedTypes, expectation, now + 1_000), /changed UniswapX Permit2 domain or type set/);

assert.throws(() => parseVNextUniswapXIntentPlan({ ...plan, orderHash: `0x${"11".repeat(32)}` }, expectation, now + 1_000), /inconsistent UniswapX intent plan/);
assert.throws(() => parseVNextUniswapXIntentPlan({ ...plan, permitPayloadHash: `0x${"22".repeat(32)}` }, expectation, now + 1_000), /inconsistent UniswapX intent plan/);
assert.throws(() => parseVNextUniswapXIntentPlan({ ...plan, walletSignatureEnabled: true }, expectation, now + 1_000), /malformed UniswapX intent plan/);
assert.throws(() => parseVNextUniswapXIntentPlan({ ...plan, orderSubmissionEnabled: true }, expectation, now + 1_000), /malformed UniswapX intent plan/);
assert.throws(() => parseVNextUniswapXIntentPlan({ ...plan, encodedOrder: "0xdeadbeef" }, expectation, now + 1_000), /malformed UniswapX intent plan/);
assert.throws(() => parseVNextUniswapXIntentPlan(plan, { ...expectation, sourceVerificationId: "44444444-4444-4444-8444-444444444444" }, now + 1_000), /inconsistent UniswapX intent plan/);
assert.throws(() => parseVNextUniswapXIntentPlan(plan, expectation, plan.expiresAtMs), /inconsistent UniswapX intent plan/);

console.log("RMT VNext UniswapX intent-plan smoke checks passed.");
