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
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_SWAP_ROUTER_02,
  ROBINHOOD_UNIVERSAL_ROUTER,
  permit2Abi
} from "../uniswap-v4";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { UP_CL_EXECUTION_ROUTER, UP_V2_EXECUTION_ROUTER } from "./up-authorization-codec";
import { ROBINHOOD_UNISWAP_V2_ROUTER } from "./uniswap-v2-authorization-codec";
import { assertRmtNetExecutionEconomics, type RmtNetExecutionEconomics } from "./execution-fee-policy";
import { assertRmtExecutionFeeV2Economics, type RmtExecutionFeeV2Economics } from "./execution-fee-policy-v2";
import {
  assertVNextAtomicFeeAuthorizationBinding,
  type VNextAtomicFeeAuthorizationBinding,
  type VNextAtomicFeeSettlementProof
} from "./provider-fee-settlement";
import {
  assertRmtUniswapV3FeeExecution,
  encodeRmtUniswapV3FeeExecution,
  type RmtUniswapV3FeeExecution
} from "./uniswap-v3-fee-executor";
import type { VNextUniswapV4ExecutionEvidence } from "../server/vnext-uniswap-v4-execution";
import {
  assertVNextDirectNoRmtFeeSettlement,
  assertVNextDirectExecutionBinding,
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_LEGACY_V1_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE,
  type VNextDirectNoRmtFeeSettlement,
  type VNextDirectExecutionBinding,
  type VNextWalletSettlementMode
} from "./execution-settlement";

const MAX_CLOCK_SKEW_MS = 5_000;
export const VNEXT_PLAN_MAX_AGE_MS = 60_000;
export const VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS = 180_000;

export type VNextAuthorizationPlan = {
  planId: string;
  sourceQuoteRequestId: string;
  sourceVerificationId: string;
  provider: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "up-v2" | "up-cl";
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
  v4Execution?: VNextUniswapV4ExecutionEvidence;
  deadline: string;
  preparedAtMs: number;
  expiresAtMs: number;
  userAuthorizationRequired: true;
  serverSubmissionEnabled: false;
};

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const planSchema = z.object({
  planId: z.string().uuid(), sourceQuoteRequestId: z.string().uuid(), sourceVerificationId: z.string().uuid(),
  provider: z.enum(["uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"]), kind: z.enum(["erc20_approval", "swap"]), chainId: z.literal(4_663),
  target: z.string(), data: z.string().regex(/^0x[0-9a-fA-F]+$/), value: atomic, gasLimit: atomic,
  payloadHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), inputAsset: z.string(), outputAsset: z.string(),
  inputAmountAtomic: atomic, protectedOutputAtomic: atomic, recipient: z.string(), router: z.string(), deadline: atomic,
  settlementMode: z.enum([VNEXT_DIRECT_NO_RMT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE, VNEXT_LEGACY_V1_FEE]),
  directNoRmtFee: z.unknown().optional(), directAuthorization: z.unknown().optional(),
  netEconomics: z.unknown().optional(), feeExecution: z.unknown().nullable().optional(),
  feeV2Economics: z.unknown().optional(), feeV2Authorization: z.unknown().optional(),
  v4Execution: z.unknown().optional(),
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
    || getAddress(plan.router) !== getAddress(evidence.provider === "uniswap-v2" ? ROBINHOOD_UNISWAP_V2_ROUTER : evidence.provider === "uniswap-v3" ? ROBINHOOD_SWAP_ROUTER_02 : evidence.provider === "uniswap-v4" ? ROBINHOOD_UNIVERSAL_ROUTER : evidence.provider === "up-v2" ? UP_V2_EXECUTION_ROUTER : UP_CL_EXECUTION_ROUTER)
    || plan.inputAmountAtomic !== evidence.inputAmountAtomic
    || plan.protectedOutputAtomic !== evidence.protectedOutputAtomic
    || plan.value !== evidence.transactionValueAtomic
    || plan.deadline !== evidence.deadline
    || plan.settlementMode !== evidence.settlementMode
    || plan.gasLimit !== evidence.gasLimitUnits
    || Boolean(plan.feeExecution) !== evidence.rmtFeeEnabled
    || (plan.provider === "uniswap-v4" && plan.v4Execution?.poolId !== evidence.v4Execution?.poolId)
    || (plan.provider !== "uniswap-v4" && plan.v4Execution !== undefined)
    || (evidence.rmtFeeEnabled && (
      plan.feeExecution?.executionId !== evidence.feeExecution?.executionId
      || plan.feeExecution?.policyHash !== evidence.feeExecution?.policyHash
      || plan.feeExecution?.routeIdentity !== evidence.feeExecution?.routeIdentity
    ))
    || plan.payloadHash !== authorizationPayloadHash(plan)
    || plan.preparedAtMs > nowMs + MAX_CLOCK_SKEW_MS || plan.expiresAtMs <= nowMs
    || plan.expiresAtMs - plan.preparedAtMs > VNEXT_PLAN_MAX_AGE_MS
    || plan.expiresAtMs > Number(BigInt(plan.deadline) * 1_000n) - VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS
  ) throw new Error("RMT rejected an inconsistent authorization plan.");

  if (plan.provider === "uniswap-v4") {
    const planned = plan.v4Execution;
    const verified = evidence.v4Execution;
    if (!planned || !verified
      || planned.poolId !== verified.poolId
      || getAddress(planned.poolKey.currency0) !== getAddress(verified.poolKey.currency0)
      || getAddress(planned.poolKey.currency1) !== getAddress(verified.poolKey.currency1)
      || planned.poolKey.fee !== verified.poolKey.fee
      || planned.poolKey.tickSpacing !== verified.poolKey.tickSpacing
      || getAddress(planned.poolKey.hooks) !== getAddress(verified.poolKey.hooks)
      || getAddress(planned.poolManager) !== getAddress(verified.poolManager)
      || getAddress(planned.quoter) !== getAddress(verified.quoter)
      || getAddress(planned.universalRouter) !== getAddress(verified.universalRouter)
      || getAddress(planned.permit2) !== getAddress(verified.permit2)
      || planned.commands !== verified.commands
      || planned.hookData !== "0x"
      || planned.quoteObservedBlockHash !== verified.quoteObservedBlockHash
      || planned.simulationBlockHash !== verified.simulationBlockHash
      || planned.rmtFeeAtomic !== "0"
      || planned.treasuryTransferAtomic !== "0"
    ) throw new Error("RMT rejected changed V4 execution authority.");
  }

  let validatedV1Execution: RmtUniswapV3FeeExecution | null = null;
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
  } else if (plan.settlementMode === VNEXT_LEGACY_V1_FEE) {
    if (
      plan.provider !== "uniswap-v3"
      || evidence.provider !== "uniswap-v3"
      || evidence.settlementMode !== VNEXT_LEGACY_V1_FEE
      || !evidence.rmtFeeEnabled
      || !plan.netEconomics
      || !evidence.netEconomics
      || plan.netEconomics.rmtFee.state !== "planned"
      || evidence.netEconomics.rmtFee.state !== "planned"
      || !plan.feeExecution
      || !evidence.feeExecution
      || plan.directAuthorization !== undefined
      || plan.directNoRmtFee !== undefined
      || plan.feeV2Economics !== undefined
      || plan.feeV2Authorization !== undefined
      || evidence.feeV2Economics !== undefined
      || evidence.feeV2Settlement !== undefined
    ) throw new Error("RMT rejected a wallet plan without complete V1 fee authority.");
    assertRmtNetExecutionEconomics(plan.netEconomics);
    assertRmtNetExecutionEconomics(evidence.netEconomics);
    assertRmtUniswapV3FeeExecution(plan.feeExecution, plan.netEconomics);
    assertRmtUniswapV3FeeExecution(evidence.feeExecution, evidence.netEconomics);
    if (
      encodeRmtUniswapV3FeeExecution(plan.feeExecution).toLowerCase()
        !== encodeRmtUniswapV3FeeExecution(evidence.feeExecution).toLowerCase()
      || plan.netEconomics.userGrossInputAtomic !== evidence.netEconomics.userGrossInputAtomic
      || plan.netEconomics.providerInputAtomic !== evidence.netEconomics.providerInputAtomic
      || plan.netEconomics.expectedUserNetOutputAtomic !== evidence.netEconomics.expectedUserNetOutputAtomic
      || plan.netEconomics.protectedUserNetOutputAtomic !== evidence.netEconomics.protectedUserNetOutputAtomic
      || plan.netEconomics.rmtFee.feePolicyHash !== evidence.netEconomics.rmtFee.feePolicyHash
      || plan.netEconomics.rmtFee.expectedFeeAtomic !== evidence.netEconomics.rmtFee.expectedFeeAtomic
      || plan.netEconomics.rmtFee.maximumFeeAtomic !== evidence.netEconomics.rmtFee.maximumFeeAtomic
    ) throw new Error("RMT rejected changed V1 fee authority.");
    validatedV1Execution = plan.feeExecution;
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
    if (plan.value !== "0" || evidence.status !== "approval_required" || keccak256(plan.data) !== evidence.nextActionCalldataHash) {
      throw new Error("RMT rejected an approval plan that does not match strict evidence.");
    }
    if (plan.provider === "uniswap-v4" && evidence.approvalKind === "permit2_to_router") {
      if (getAddress(plan.target) !== getAddress(PERMIT2_ADDRESS)) throw new Error("RMT rejected changed Permit2 approval target.");
      const decoded = decodeFunctionData({ abi: permit2Abi, data: plan.data });
      if (decoded.functionName !== "approve") throw new Error("RMT rejected a non-approval Permit2 call.");
      const [token, spender, amount, expiration] = decoded.args;
      if (
        getAddress(token) !== getAddress(evidence.inputAsset)
        || getAddress(spender) !== getAddress(ROBINHOOD_UNIVERSAL_ROUTER)
        || getAddress(evidence.approvalSpender) !== getAddress(ROBINHOOD_UNIVERSAL_ROUTER)
        || amount !== BigInt(evidence.inputAmountAtomic)
        || BigInt(expiration) !== BigInt(evidence.deadline)
      ) throw new Error("RMT rejected broadened Permit2 authority.");
      return plan;
    }
    if (getAddress(plan.target) !== getAddress(evidence.inputAsset)) {
      throw new Error("RMT rejected changed ERC20 approval target.");
    }
    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
    if (decoded.functionName !== "approve") throw new Error("RMT rejected a non-approval token call.");
    const [spender, amount] = decoded.args;
    const requiredSpender = plan.settlementMode === VNEXT_DIRECT_NO_RMT_FEE
      ? plan.provider === "uniswap-v4" ? PERMIT2_ADDRESS : evidence.router
      : plan.settlementMode === VNEXT_LEGACY_V1_FEE
        ? validatedV1Execution!.executor
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

  if (plan.settlementMode === VNEXT_LEGACY_V1_FEE) {
    if (
      evidence.status !== "verified"
      || getAddress(plan.target) !== getAddress(validatedV1Execution!.executor)
      || keccak256(plan.data) !== evidence.calldataHash
      || plan.data.toLowerCase() !== encodeRmtUniswapV3FeeExecution(validatedV1Execution!).toLowerCase()
    ) throw new Error("RMT rejected a V1 fee-bearing swap plan that does not match strict evidence.");
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
    || evidence.rmtFeeEnabled !== priorEvidence.rmtFeeEnabled
    || evidence.settlementMode !== priorEvidence.settlementMode
    || evidence.v2VerificationCommitment !== priorEvidence.v2VerificationCommitment
    || evidence.directNoRmtFee?.userGrossInputAtomic !== priorEvidence.directNoRmtFee?.userGrossInputAtomic
    || evidence.directNoRmtFee?.providerInputAtomic !== priorEvidence.directNoRmtFee?.providerInputAtomic
    || evidence.feeV2Economics?.policyHash !== priorEvidence.feeV2Economics?.policyHash
    || evidence.feeV2Economics?.expectedFeeAtomic !== priorEvidence.feeV2Economics?.expectedFeeAtomic
    || evidence.feeV2Economics?.maximumFeeAtomic !== priorEvidence.feeV2Economics?.maximumFeeAtomic
    || evidence.feeV2Settlement?.executionId !== priorEvidence.feeV2Settlement?.executionId
    || evidence.feeV2Settlement?.calldataHash !== priorEvidence.feeV2Settlement?.calldataHash
    || evidence.v4Execution?.poolId !== priorEvidence.v4Execution?.poolId
    || evidence.v4Execution?.commands !== priorEvidence.v4Execution?.commands
    || evidence.v4Execution?.simulationBlockHash !== priorEvidence.v4Execution?.simulationBlockHash
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
