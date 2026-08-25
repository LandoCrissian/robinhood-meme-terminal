import {
  decodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  isAddress,
  keccak256,
  type Hex
} from "viem";
import { z } from "zod";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { UP_CL_EXECUTION_ROUTER, UP_V2_EXECUTION_ROUTER } from "./up-authorization-codec";
import type { RmtNetExecutionEconomics } from "./execution-fee-policy";
import { assertRmtExecutionFeeV2Economics, type RmtExecutionFeeV2Economics } from "./execution-fee-policy-v2";
import {
  assertVNextAtomicFeeAuthorizationBinding,
  type VNextAtomicFeeAuthorizationBinding,
  type VNextAtomicFeeSettlementProof
} from "./provider-fee-settlement";
import type { RmtUniswapV3FeeExecution } from "./uniswap-v3-fee-executor";
import {
  assertVNextDirectNoRmtFeeSettlement,
  assertVNextDirectExecutionBinding,
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE,
  type VNextDirectNoRmtFeeSettlement,
  type VNextDirectExecutionBinding,
  type VNextWalletSettlementMode
} from "./execution-settlement";

const MAX_CLOCK_SKEW_MS = 5_000;

export type VNextAuthorizationPlan = {
  planId: string;
  sourceQuoteRequestId: string;
  sourceVerificationId: string;
  provider: "uniswap-v3" | "up-v2" | "up-cl";
  kind: "erc20_approval" | "swap";
  chainId: 4_663;
  target: string;
  data: Hex;
  value: string;
  gasLimit: string;
  payloadHash: Hex;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  router: string;
  settlementMode: VNextWalletSettlementMode;
  directNoRmtFee?: VNextDirectNoRmtFeeSettlement;
  directAuthorization?: VNextDirectExecutionBinding;
  netEconomics?: RmtNetExecutionEconomics;
  feeExecution?: RmtUniswapV3FeeExecution | null;
  feeV2Economics?: RmtExecutionFeeV2Economics;
  feeV2Authorization?: VNextAtomicFeeAuthorizationBinding;
  deadline: string;
  preparedAtMs: number;
  expiresAtMs: number;
  userAuthorizationRequired: true;
  serverSubmissionEnabled: false;
};

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const planSchema = z.object({
  planId: z.string().uuid(), sourceQuoteRequestId: z.string().uuid(), sourceVerificationId: z.string().uuid(),
  provider: z.enum(["uniswap-v3", "up-v2", "up-cl"]), kind: z.enum(["erc20_approval", "swap"]), chainId: z.literal(4_663),
  target: z.string(), data: z.string().regex(/^0x[0-9a-fA-F]+$/), value: atomic, gasLimit: atomic,
  payloadHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), inputAsset: z.string(), outputAsset: z.string(),
  inputAmountAtomic: atomic, protectedOutputAtomic: atomic, recipient: z.string(), router: z.string(), deadline: atomic,
  settlementMode: z.enum([VNEXT_DIRECT_NO_RMT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE]),
  directNoRmtFee: z.unknown().optional(), directAuthorization: z.unknown().optional(),
  netEconomics: z.unknown().optional(), feeExecution: z.unknown().nullable().optional(),
  feeV2Economics: z.unknown().optional(), feeV2Authorization: z.unknown().optional(),
  preparedAtMs: z.number().int().positive(), expiresAtMs: z.number().int().positive(),
  userAuthorizationRequired: z.literal(true), serverSubmissionEnabled: z.literal(false)
});

const authorizationBundleSchema = z.object({ evidence: z.unknown(), plan: z.unknown() });

export function authorizationPayloadHash(plan: Pick<VNextAuthorizationPlan, "chainId" | "target" | "value" | "data">) {
  return keccak256(encodePacked(
    ["uint256", "address", "uint256", "bytes"],
    [BigInt(plan.chainId), getAddress(plan.target), BigInt(plan.value), plan.data]
  ));
}

export function parseVNextAuthorizationPlan(value: unknown, evidence: VNextPreSignEvidence, nowMs: number): VNextAuthorizationPlan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new Error("RMT rejected a malformed authorization plan.");
  const plan = parsed.data as VNextAuthorizationPlan;
  if (
    plan.sourceQuoteRequestId !== evidence.sourceQuoteRequestId
    || plan.sourceVerificationId !== evidence.verificationId
    || !isAddress(plan.target) || !isAddress(plan.inputAsset) || !isAddress(plan.outputAsset)
    || !isAddress(plan.recipient) || !isAddress(plan.router)
    || getAddress(plan.inputAsset) !== getAddress(evidence.inputAsset)
    || getAddress(plan.outputAsset) !== getAddress(evidence.outputAsset)
    || getAddress(plan.recipient) !== getAddress(evidence.recipient)
    || plan.provider !== evidence.provider
    || getAddress(plan.router) !== getAddress(evidence.provider === "uniswap-v3" ? ROBINHOOD_SWAP_ROUTER_02 : evidence.provider === "up-v2" ? UP_V2_EXECUTION_ROUTER : UP_CL_EXECUTION_ROUTER)
    || plan.inputAmountAtomic !== evidence.inputAmountAtomic
    || plan.protectedOutputAtomic !== evidence.protectedOutputAtomic
    || plan.value !== evidence.transactionValueAtomic
    || plan.deadline !== evidence.deadline
    || plan.settlementMode !== evidence.settlementMode
    || plan.gasLimit !== evidence.gasLimitUnits
    || Boolean(plan.feeExecution) !== evidence.rmtFeeEnabled
    || (evidence.rmtFeeEnabled && (
      plan.feeExecution?.executionId !== evidence.feeExecution?.executionId
      || plan.feeExecution?.policyHash !== evidence.feeExecution?.policyHash
      || plan.feeExecution?.routeIdentity !== evidence.feeExecution?.routeIdentity
    ))
    || plan.payloadHash !== authorizationPayloadHash(plan)
    || plan.preparedAtMs > nowMs + MAX_CLOCK_SKEW_MS || plan.expiresAtMs <= nowMs
    || plan.expiresAtMs - plan.preparedAtMs > 60_000
    || plan.expiresAtMs > Number(BigInt(plan.deadline) * 1_000n)
  ) throw new Error("RMT rejected an inconsistent authorization plan.");

  if (evidence.rmtFeeEnabled || evidence.feeExecution != null || plan.feeExecution != null) {
    throw new Error("RMT_EXECUTION_V1 evidence is historical and cannot authorize a universal V2 wallet trade.");
  }
  let validatedV2Authorization: VNextAtomicFeeAuthorizationBinding | null = null;
  let validatedV2Settlement: VNextAtomicFeeSettlementProof | null = null;
  if (plan.settlementMode === VNEXT_DIRECT_NO_RMT_FEE) {
    assertVNextDirectNoRmtFeeSettlement(plan.directNoRmtFee, plan.inputAmountAtomic);
    assertVNextDirectNoRmtFeeSettlement(evidence.directNoRmtFee, evidence.inputAmountAtomic);
    assertVNextDirectExecutionBinding({
      binding: plan.directAuthorization,
      provider: plan.provider,
      kind: plan.kind,
      chainId: plan.chainId,
      inputAsset: plan.inputAsset,
      outputAsset: plan.outputAsset,
      inputAmountAtomic: plan.inputAmountAtomic,
      protectedOutputAtomic: plan.protectedOutputAtomic,
      recipient: plan.recipient,
      providerTarget: plan.router,
      executionTarget: plan.target,
      approvalSpender: evidence.approvalSpender,
      data: plan.data,
      valueAtomic: plan.value,
      deadline: plan.deadline
    });
    if (
      plan.feeV2Economics !== undefined
      || plan.feeV2Authorization !== undefined
      || evidence.feeV2Economics !== undefined
      || evidence.feeV2Settlement !== undefined
    ) throw new Error("RMT rejected hidden V2 authority in DIRECT_NO_RMT_FEE mode.");
  } else {
    if (
      !plan.feeV2Economics
      || !plan.feeV2Authorization
      || !evidence.feeV2Economics
      || !evidence.feeV2Settlement
    ) throw new Error("RMT rejected a wallet plan without complete V2 fee authority.");
    if (plan.directAuthorization !== undefined) {
      throw new Error("RMT rejected fee-free execution authority in a fee-bearing mode.");
    }
    assertRmtExecutionFeeV2Economics(plan.feeV2Economics);
    assertRmtExecutionFeeV2Economics(evidence.feeV2Economics);
    assertVNextAtomicFeeAuthorizationBinding(plan.feeV2Authorization, plan.feeV2Economics, evidence.feeV2Settlement);
    const v2Fields: (keyof RmtExecutionFeeV2Economics)[] = [
      "state", "inputAsset", "outputAsset", "userGrossInputAtomic", "feeBasisAtomic", "feeBps", "expectedFeeAtomic", "maximumFeeAtomic",
      "feeAsset", "feeSide", "providerInputAtomic", "providerGrossExpectedOutputAtomic", "providerProtectedOutputAtomic",
      "expectedUserNetOutputAtomic", "protectedUserNetOutputAtomic", "treasury", "policyId", "policyVersion",
      "policyHash", "roundingMode", "settlementMode", "executionOrigin"
    ];
    for (const field of v2Fields) {
      if (plan.feeV2Economics[field] !== evidence.feeV2Economics[field]) {
        throw new Error(`RMT rejected changed V2 fee field ${field}.`);
      }
    }
    if (
      plan.feeV2Authorization.provider !== plan.provider
      || getAddress(plan.feeV2Authorization.recipient) !== getAddress(plan.recipient)
      || getAddress(plan.feeV2Authorization.providerTarget) !== getAddress(plan.router)
      || plan.feeV2Authorization.deadline !== plan.deadline
    ) throw new Error("RMT rejected changed V2 provider, recipient, or deadline authority.");
    validatedV2Authorization = plan.feeV2Authorization;
    validatedV2Settlement = evidence.feeV2Settlement;
  }

  if (plan.kind === "erc20_approval") {
    if (plan.value !== "0" || evidence.status !== "approval_required" || getAddress(plan.target) !== getAddress(evidence.inputAsset) || keccak256(plan.data) !== evidence.nextActionCalldataHash) {
      throw new Error("RMT rejected an approval plan that does not match strict evidence.");
    }
    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
    if (decoded.functionName !== "approve") throw new Error("RMT rejected a non-approval token call.");
    const [spender, amount] = decoded.args;
    const requiredSpender = plan.settlementMode === VNEXT_DIRECT_NO_RMT_FEE
      ? evidence.router
      : validatedV2Settlement!.executionTarget;
    if (
      getAddress(spender) !== getAddress(evidence.approvalSpender)
      || getAddress(spender) !== getAddress(requiredSpender)
      || amount !== BigInt(evidence.inputAmountAtomic)
    ) {
      throw new Error("RMT rejected broadened approval authority.");
    }
    return plan;
  }

  if (plan.settlementMode === VNEXT_DIRECT_NO_RMT_FEE) {
    if (
      evidence.status !== "verified"
      || getAddress(plan.target) !== getAddress(evidence.router)
      || keccak256(plan.data) !== evidence.calldataHash
    ) throw new Error("RMT rejected a fee-free swap plan that does not match strict evidence.");
    return plan;
  }

  if (
    evidence.status !== "verified"
    || getAddress(plan.target) !== getAddress(validatedV2Settlement!.executionTarget)
    || getAddress(validatedV2Authorization!.executionTarget) !== getAddress(validatedV2Settlement!.executionTarget)
    || keccak256(plan.data) !== evidence.calldataHash
    || keccak256(plan.data).toLowerCase() !== validatedV2Authorization!.calldataHash.toLowerCase()
  ) {
    throw new Error("RMT rejected a swap plan that does not match strict evidence.");
  }
  return plan;

}

export function parseVNextAuthorizationBundle(value: unknown, priorEvidence: VNextPreSignEvidence, expected: {
  quoteRequestId: string;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  recipient: string;
}, nowMs: number) {
  const parsed = authorizationBundleSchema.safeParse(value);
  if (!parsed.success) throw new Error("RMT rejected a malformed authorization bundle.");
  const evidence = parseVNextPreSignEvidence(parsed.data.evidence, {
    ...expected,
    provider: priorEvidence.provider,
    protectedOutputFloorAtomic: priorEvidence.indicativeProtectedOutputFloorAtomic
  }, nowMs);
  if (
    evidence.verificationId !== priorEvidence.verificationId
    || evidence.provider !== priorEvidence.provider
    || evidence.status !== priorEvidence.status
    || evidence.deadline !== priorEvidence.deadline
    || evidence.rmtFeeEnabled !== priorEvidence.rmtFeeEnabled
    || evidence.settlementMode !== priorEvidence.settlementMode
    || evidence.directNoRmtFee?.userGrossInputAtomic !== priorEvidence.directNoRmtFee?.userGrossInputAtomic
    || evidence.directNoRmtFee?.providerInputAtomic !== priorEvidence.directNoRmtFee?.providerInputAtomic
    || evidence.feeV2Economics?.policyHash !== priorEvidence.feeV2Economics?.policyHash
    || evidence.feeV2Economics?.expectedFeeAtomic !== priorEvidence.feeV2Economics?.expectedFeeAtomic
    || evidence.feeV2Economics?.maximumFeeAtomic !== priorEvidence.feeV2Economics?.maximumFeeAtomic
    || evidence.feeV2Settlement?.executionId !== priorEvidence.feeV2Settlement?.executionId
    || evidence.feeV2Settlement?.calldataHash !== priorEvidence.feeV2Settlement?.calldataHash
    || (priorEvidence.rmtFeeEnabled && (
      evidence.feeExecution?.executionId !== priorEvidence.feeExecution?.executionId
      || evidence.feeExecution?.policyHash !== priorEvidence.feeExecution?.policyHash
      || evidence.feeExecution?.treasury !== priorEvidence.feeExecution?.treasury
      || evidence.feeExecution?.feeBps !== priorEvidence.feeExecution?.feeBps
      || evidence.feeExecution?.feeSide !== priorEvidence.feeExecution?.feeSide
      || evidence.feeExecution?.maximumFeeAtomic !== priorEvidence.feeExecution?.maximumFeeAtomic
    ))
    || BigInt(evidence.protectedOutputAtomic) < BigInt(priorEvidence.protectedOutputAtomic)
  ) throw new Error("RMT rejected changed authorization authority or weakened protection.");
  const plan = parseVNextAuthorizationPlan(parsed.data.plan, evidence, nowMs);
  return { evidence, plan };
}
