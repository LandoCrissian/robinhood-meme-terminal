import {
  getAddress,
  hashStruct,
  hashTypedData,
  isAddress,
  isHex,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import type { PreparedVNextUniswapXIntent } from "./vnext-uniswapx-adapter";
import {
  ROBINHOOD_UNISWAPX_V3_ORDER_TYPES,
  ROBINHOOD_UNISWAPX_V3_PERMIT_TYPES,
  ROBINHOOD_UNISWAPX_V3_REACTOR,
  ROBINHOOD_UNISWAP_PERMIT2
} from "./vnext-uniswapx-order-verifier";

const MAX_CLOCK_SKEW_MS = 5_000;
const MAX_PLAN_TTL_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const POSITIVE_ATOMIC = /^[1-9][0-9]*$/;
const SIGNED_ATOMIC = /^(0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

type CanonicalPermitData = PreparedVNextUniswapXIntent["permitData"];

export type VNextUniswapXIntentPlan = {
  schemaVersion: 1;
  planId: string;
  sourceQuoteRequestId: string;
  sourceVerificationId: string;
  provider: "uniswapx";
  orderKind: "dutch_v3";
  authorizationKind: "permit2_witness_signature";
  chainId: 4_663;
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  recipient: Address;
  orderHash: Hex;
  permitPayloadHash: Hex;
  permit2: Address;
  reactor: Address;
  nonce: string;
  deadline: string;
  permitData: CanonicalPermitData;
  preparedAtMs: number;
  expiresAtMs: number;
  walletSignatureRequired: true;
  walletSignatureEnabled: false;
  orderSubmissionEnabled: false;
  orderSubmissionRef: null;
};

export type VNextUniswapXIntentExpectation = {
  sourceQuoteRequestId: string;
  sourceVerificationId: string;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  recipient: string;
  minimumProtectedOutputAtomic: string;
};

const planSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().regex(UUID),
  sourceQuoteRequestId: z.string().regex(UUID),
  sourceVerificationId: z.string().regex(UUID),
  provider: z.literal("uniswapx"),
  orderKind: z.literal("dutch_v3"),
  authorizationKind: z.literal("permit2_witness_signature"),
  chainId: z.literal(4_663),
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmountAtomic: z.string().regex(POSITIVE_ATOMIC),
  expectedOutputAtomic: z.string().regex(POSITIVE_ATOMIC),
  protectedOutputAtomic: z.string().regex(POSITIVE_ATOMIC),
  recipient: z.string(),
  orderHash: z.string().regex(HASH),
  permitPayloadHash: z.string().regex(HASH),
  permit2: z.string(),
  reactor: z.string(),
  nonce: z.string().regex(ATOMIC),
  deadline: z.string().regex(POSITIVE_ATOMIC),
  permitData: z.unknown(),
  preparedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive(),
  walletSignatureRequired: z.literal(true),
  walletSignatureEnabled: z.literal(false),
  orderSubmissionEnabled: z.literal(false),
  orderSubmissionRef: z.null()
}).strict();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalTypes(value: unknown) {
  return JSON.stringify(value) === JSON.stringify(ROBINHOOD_UNISWAPX_V3_PERMIT_TYPES);
}

function validAddress(value: unknown): value is string {
  return typeof value === "string" && isAddress(value, { strict: false });
}

function validAtomic(value: unknown, positive = false): value is string {
  return typeof value === "string" && (positive ? POSITIVE_ATOMIC : ATOMIC).test(value);
}

function validCurve(value: unknown) {
  return isObject(value)
    && exactKeys(value, ["relativeBlocks", "relativeAmounts"])
    && validAtomic(value.relativeBlocks)
    && Array.isArray(value.relativeAmounts)
    && value.relativeAmounts.length > 0
    && value.relativeAmounts.length <= 16
    && value.relativeAmounts.every((amount) => typeof amount === "string" && SIGNED_ATOMIC.test(amount));
}

function parseCanonicalPermitData(value: unknown): CanonicalPermitData {
  if (!isObject(value) || !exactKeys(value, ["domain", "types", "primaryType", "message"])) {
    throw new Error("RMT rejected malformed UniswapX Permit2 data.");
  }
  const { domain, message } = value;
  if (
    !isObject(domain)
    || !exactKeys(domain, ["name", "chainId", "verifyingContract"])
    || domain.name !== "Permit2"
    || domain.chainId !== 4_663
    || !validAddress(domain.verifyingContract)
    || getAddress(domain.verifyingContract) !== ROBINHOOD_UNISWAP_PERMIT2
    || value.primaryType !== "PermitWitnessTransferFrom"
    || !canonicalTypes(value.types)
    || !isObject(message)
    || !exactKeys(message, ["permitted", "spender", "nonce", "deadline", "witness"])
  ) throw new Error("RMT rejected a changed UniswapX Permit2 domain or type set.");

  const { permitted, witness } = message;
  if (
    !isObject(permitted)
    || !exactKeys(permitted, ["token", "amount"])
    || !validAddress(permitted.token)
    || !validAtomic(permitted.amount, true)
    || !validAddress(message.spender)
    || !validAtomic(message.nonce)
    || !validAtomic(message.deadline, true)
    || !isObject(witness)
    || !exactKeys(witness, ["info", "cosigner", "startingBaseFee", "baseInput", "baseOutputs"])
  ) throw new Error("RMT rejected changed UniswapX Permit2 economics.");

  const { info, baseInput, baseOutputs } = witness;
  if (
    !isObject(info)
    || !exactKeys(info, ["reactor", "swapper", "nonce", "deadline", "additionalValidationContract", "additionalValidationData"])
    || !validAddress(info.reactor)
    || !validAddress(info.swapper)
    || !validAtomic(info.nonce)
    || !validAtomic(info.deadline, true)
    || !validAddress(info.additionalValidationContract)
    || typeof info.additionalValidationData !== "string"
    || !isHex(info.additionalValidationData)
    || !validAddress(witness.cosigner)
    || !validAtomic(witness.startingBaseFee)
    || !isObject(baseInput)
    || !exactKeys(baseInput, ["token", "startAmount", "curve", "maxAmount", "adjustmentPerGweiBaseFee"])
    || !validAddress(baseInput.token)
    || !validAtomic(baseInput.startAmount, true)
    || !validCurve(baseInput.curve)
    || !validAtomic(baseInput.maxAmount, true)
    || !validAtomic(baseInput.adjustmentPerGweiBaseFee)
    || !Array.isArray(baseOutputs)
    || baseOutputs.length !== 1
  ) throw new Error("RMT rejected a changed UniswapX witness.");

  const output = baseOutputs[0];
  if (
    !isObject(output)
    || !exactKeys(output, ["token", "startAmount", "curve", "recipient", "minAmount", "adjustmentPerGweiBaseFee"])
    || !validAddress(output.token)
    || !validAtomic(output.startAmount, true)
    || !validCurve(output.curve)
    || !validAddress(output.recipient)
    || !validAtomic(output.minAmount, true)
    || !validAtomic(output.adjustmentPerGweiBaseFee)
  ) throw new Error("RMT rejected a changed UniswapX output witness.");

  return value as unknown as CanonicalPermitData;
}

function computeOrderHash(permitData: CanonicalPermitData) {
  return hashStruct({
    primaryType: "V3DutchOrder",
    types: ROBINHOOD_UNISWAPX_V3_ORDER_TYPES,
    data: permitData.message.witness as never
  });
}

function computePermitPayloadHash(permitData: CanonicalPermitData) {
  return hashTypedData({
    domain: permitData.domain,
    types: permitData.types,
    primaryType: permitData.primaryType,
    message: permitData.message as never
  });
}

export function parseVNextUniswapXIntentPlan(
  value: unknown,
  expected: VNextUniswapXIntentExpectation,
  nowMs: number
): VNextUniswapXIntentPlan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error("RMT rejected a malformed UniswapX intent plan.");
  }
  const plan = parsed.data as unknown as VNextUniswapXIntentPlan;
  const permitData = parseCanonicalPermitData(plan.permitData);
  const { message } = permitData;
  const { permitted, witness } = message;
  const output = witness.baseOutputs[0];
  const deadlineMs = Number(BigInt(plan.deadline) * 1_000n);
  if (
    !validAddress(plan.inputAsset)
    || !validAddress(plan.outputAsset)
    || !validAddress(plan.recipient)
    || !validAddress(plan.permit2)
    || !validAddress(plan.reactor)
    || !validAddress(expected.inputAsset)
    || !validAddress(expected.outputAsset)
    || !validAddress(expected.recipient)
    || plan.sourceQuoteRequestId !== expected.sourceQuoteRequestId
    || plan.sourceVerificationId !== expected.sourceVerificationId
    || getAddress(plan.inputAsset) !== getAddress(expected.inputAsset)
    || getAddress(plan.outputAsset) !== getAddress(expected.outputAsset)
    || getAddress(plan.recipient) !== getAddress(expected.recipient)
    || plan.inputAmountAtomic !== expected.inputAmountAtomic
    || BigInt(plan.protectedOutputAtomic) < BigInt(expected.minimumProtectedOutputAtomic)
    || BigInt(plan.protectedOutputAtomic) > BigInt(plan.expectedOutputAtomic)
    || getAddress(plan.permit2) !== ROBINHOOD_UNISWAP_PERMIT2
    || getAddress(plan.reactor) !== ROBINHOOD_UNISWAPX_V3_REACTOR
    || getAddress(permitted.token) !== getAddress(plan.inputAsset)
    || permitted.amount !== plan.inputAmountAtomic
    || getAddress(message.spender) !== getAddress(plan.reactor)
    || message.nonce !== plan.nonce
    || message.deadline !== plan.deadline
    || getAddress(witness.info.reactor) !== getAddress(plan.reactor)
    || getAddress(witness.info.swapper) !== getAddress(plan.recipient)
    || witness.info.nonce !== plan.nonce
    || witness.info.deadline !== plan.deadline
    || getAddress(witness.baseInput.token) !== getAddress(plan.inputAsset)
    || witness.baseInput.startAmount !== plan.inputAmountAtomic
    || witness.baseInput.maxAmount !== plan.inputAmountAtomic
    || getAddress(output.token) !== getAddress(plan.outputAsset)
    || getAddress(output.recipient) !== getAddress(plan.recipient)
    || BigInt(output.startAmount) < BigInt(plan.expectedOutputAtomic)
    || output.minAmount !== plan.protectedOutputAtomic
    || plan.orderHash.toLowerCase() !== computeOrderHash(permitData).toLowerCase()
    || plan.permitPayloadHash.toLowerCase() !== computePermitPayloadHash(permitData).toLowerCase()
    || plan.preparedAtMs > nowMs + MAX_CLOCK_SKEW_MS
    || plan.expiresAtMs <= nowMs
    || plan.expiresAtMs - plan.preparedAtMs > MAX_PLAN_TTL_MS
    || !Number.isSafeInteger(deadlineMs)
    || plan.expiresAtMs > deadlineMs
  ) throw new Error("RMT rejected an inconsistent UniswapX intent plan.");
  return { ...plan, permitData };
}

export function buildVNextUniswapXIntentPlan(input: {
  prepared: PreparedVNextUniswapXIntent;
  planId: string;
  sourceQuoteRequestId: string;
  sourceVerificationId: string;
  preparedAtMs: number;
}): VNextUniswapXIntentPlan {
  const { prepared } = input;
  const deadlineMs = Number(BigInt(prepared.deadline) * 1_000n);
  if (!Number.isSafeInteger(deadlineMs) || !HASH.test(prepared.orderId)) {
    throw new Error("RMT rejected invalid UniswapX intent evidence.");
  }
  const plan: VNextUniswapXIntentPlan = {
    schemaVersion: 1,
    planId: input.planId,
    sourceQuoteRequestId: input.sourceQuoteRequestId,
    sourceVerificationId: input.sourceVerificationId,
    provider: "uniswapx",
    orderKind: "dutch_v3",
    authorizationKind: "permit2_witness_signature",
    chainId: 4_663,
    inputAsset: getAddress(prepared.inputAsset),
    outputAsset: getAddress(prepared.outputAsset),
    inputAmountAtomic: prepared.inputAmountAtomic,
    expectedOutputAtomic: prepared.expectedOutputAtomic,
    protectedOutputAtomic: prepared.protectedOutputAtomic,
    recipient: getAddress(prepared.recipient),
    orderHash: prepared.orderId as Hex,
    permitPayloadHash: prepared.permitPayloadHash,
    permit2: getAddress(prepared.permit2),
    reactor: getAddress(prepared.reactor),
    nonce: prepared.permitData.message.nonce,
    deadline: prepared.deadline,
    permitData: prepared.permitData,
    preparedAtMs: input.preparedAtMs,
    expiresAtMs: Math.min(input.preparedAtMs + MAX_PLAN_TTL_MS, deadlineMs),
    walletSignatureRequired: true,
    walletSignatureEnabled: false,
    orderSubmissionEnabled: false,
    orderSubmissionRef: null
  };
  return parseVNextUniswapXIntentPlan(plan, {
    sourceQuoteRequestId: input.sourceQuoteRequestId,
    sourceVerificationId: input.sourceVerificationId,
    inputAsset: prepared.inputAsset,
    outputAsset: prepared.outputAsset,
    inputAmountAtomic: prepared.inputAmountAtomic,
    recipient: prepared.recipient,
    minimumProtectedOutputAtomic: prepared.protectedOutputAtomic
  }, input.preparedAtMs);
}
