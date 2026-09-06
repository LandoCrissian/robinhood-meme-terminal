import { decodeFunctionData, erc20Abi, getAddress, isAddress, isHash, keccak256, type Hex } from "viem";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import { assertRmtNetExecutionEconomics } from "./execution-fee-policy";
import { assertRmtExecutionFeeV2Economics } from "./execution-fee-policy-v2";
import { assertVNextAtomicFeeAuthorizationBinding } from "./provider-fee-settlement";
import { assertVNextDirectExecutionBinding, assertVNextDirectNoRmtFeeSettlement, VNEXT_DIRECT_NO_RMT_FEE, VNEXT_LEGACY_V1_FEE } from "./execution-settlement";
import { assertRmtUniswapV3FeeExecution, encodeRmtUniswapV3FeeExecution } from "./uniswap-v3-fee-executor";
import { PERMIT2_ADDRESS, ROBINHOOD_UNIVERSAL_ROUTER, permit2Abi } from "../uniswap-v4";
import { assertVNextZeroXPlanBinding } from "./zero-x-settlement";

const PRIVY_RESOURCE_ID = /^[A-Za-z0-9_-]{8,160}$/;
const SELECTOR = /^0x[0-9a-fA-F]{8}$/;

export type VNextExecutionPurpose = "spot_trade" | "position_guard_exit";

export type VNextExecutionInstruction = {
  purpose: VNextExecutionPurpose;
  chainId: number;
  account: string;
  target: string;
  data: Hex;
  valueAtomic: string;
  payloadHash: Hex;
  expiresAtMs: number;
};

export type VNextExecutionAuthority =
  | {
      mode: "interactive_wallet";
      chainId: number;
      account: string;
    }
  | {
      mode: "bounded_privy_delegate";
      chainId: number;
      account: string;
      executor: string;
      functionSelector: Hex;
      signerId: string;
      policyId: string;
      expiresAtMs: number;
      purpose: "position_guard_exit";
    };

export type VNextExecutionAuthorityDecision =
  | { status: "wallet_confirmation_required"; account: string }
  | { status: "delegated_submission_ready"; account: string; signerId: string; policyId: string }
  | {
      status: "blocked";
      reason:
        | "invalid_instruction"
        | "invalid_authority"
        | "account_mismatch"
        | "chain_mismatch"
        | "instruction_expired"
        | "delegation_expired"
        | "purpose_not_delegated"
        | "executor_mismatch"
        | "function_not_delegated"
        | "native_value_not_delegated";
    };

function blocked(reason: Extract<VNextExecutionAuthorityDecision, { status: "blocked" }> ["reason"]): VNextExecutionAuthorityDecision {
  return { status: "blocked", reason };
}

function validInstruction(instruction: VNextExecutionInstruction) {
  return Number.isSafeInteger(instruction.chainId)
    && instruction.chainId > 0
    && isAddress(instruction.account, { strict: false })
    && isAddress(instruction.target, { strict: false })
    && /^0x[0-9a-fA-F]{8,}$/.test(instruction.data)
    && /^(0|[1-9][0-9]*)$/.test(instruction.valueAtomic)
    && isHash(instruction.payloadHash)
    && Number.isSafeInteger(instruction.expiresAtMs)
    && instruction.expiresAtMs > 0;
}

/**
 * Selects who may submit an already verified instruction.
 *
 * This function does not verify route economics or calldata. Those checks must
 * happen first. Its only job is to prevent a user-approved Position Guard
 * delegation from becoming generic spot-trading or arbitrary-call authority.
 */
export function decideVNextExecutionAuthority(input: {
  authority: VNextExecutionAuthority;
  instruction: VNextExecutionInstruction;
  nowMs: number;
}): VNextExecutionAuthorityDecision {
  const { authority, instruction, nowMs } = input;
  if (!validInstruction(instruction) || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    return blocked("invalid_instruction");
  }
  if (
    !Number.isSafeInteger(authority.chainId)
    || authority.chainId <= 0
    || !isAddress(authority.account, { strict: false })
  ) return blocked("invalid_authority");
  if (getAddress(authority.account) !== getAddress(instruction.account)) return blocked("account_mismatch");
  if (authority.chainId !== instruction.chainId) return blocked("chain_mismatch");
  if (instruction.expiresAtMs <= nowMs) return blocked("instruction_expired");

  if (authority.mode === "interactive_wallet") {
    return { status: "wallet_confirmation_required", account: getAddress(authority.account) };
  }

  if (
    !isAddress(authority.executor, { strict: false })
    || !SELECTOR.test(authority.functionSelector)
    || !PRIVY_RESOURCE_ID.test(authority.signerId)
    || !PRIVY_RESOURCE_ID.test(authority.policyId)
    || !Number.isSafeInteger(authority.expiresAtMs)
    || authority.expiresAtMs <= 0
  ) return blocked("invalid_authority");
  if (authority.expiresAtMs <= nowMs || instruction.expiresAtMs > authority.expiresAtMs) {
    return blocked("delegation_expired");
  }
  if (instruction.purpose !== "position_guard_exit" || authority.purpose !== "position_guard_exit") {
    return blocked("purpose_not_delegated");
  }
  if (getAddress(authority.executor) !== getAddress(instruction.target)) return blocked("executor_mismatch");
  if (instruction.data.slice(0, 10).toLowerCase() !== authority.functionSelector.toLowerCase()) {
    return blocked("function_not_delegated");
  }
  if (instruction.valueAtomic !== "0") return blocked("native_value_not_delegated");
  return {
    status: "delegated_submission_ready",
    account: getAddress(authority.account),
    signerId: authority.signerId,
    policyId: authority.policyId
  };
}

export function vnextSpotTradeInstruction(plan: VNextAuthorizationPlan): VNextExecutionInstruction {
  if (!plan.userAuthorizationRequired || plan.serverSubmissionEnabled) {
    throw new Error("RMT rejected a spot plan that bypasses wallet authorization.");
  }
  if (plan.settlementMode === VNEXT_DIRECT_NO_RMT_FEE) {
    if (plan.provider === "zero-x-swap") throw new Error("RMT rejected 0x under fee-free direct settlement.");
    const approvalSpender = plan.directAuthorization?.approvalSpender ?? plan.router;
    assertVNextDirectNoRmtFeeSettlement(plan.directNoRmtFee, plan.inputAmountAtomic);
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
      approvalSpender,
      data: plan.data,
      valueAtomic: plan.value,
      deadline: plan.deadline
    });
    if (
      plan.feeV2Economics !== undefined
      || plan.feeV2Authorization !== undefined
      || (plan.kind === "swap" && getAddress(plan.target) !== getAddress(plan.router))
      || plan.payloadHash.toLowerCase() !== authorizationPayloadHash(plan).toLowerCase()
    ) throw new Error("RMT rejected changed fee-free spot execution authority.");
    if (plan.kind === "erc20_approval") {
      if (plan.provider === "uniswap-v4" && getAddress(plan.target) === getAddress(PERMIT2_ADDRESS)) {
        const decoded = decodeFunctionData({ abi: permit2Abi, data: plan.data });
        if (decoded.functionName !== "approve") throw new Error("RMT rejected non-approval Permit2 authority.");
        const [token, spender, amount, expiration] = decoded.args;
        if (
          getAddress(token) !== getAddress(plan.inputAsset)
          || getAddress(spender) !== getAddress(ROBINHOOD_UNIVERSAL_ROUTER)
          || amount !== BigInt(plan.inputAmountAtomic)
          || BigInt(expiration) !== BigInt(plan.deadline)
        ) throw new Error("RMT rejected broadened Permit2 authority.");
      } else {
        if (getAddress(plan.target) !== getAddress(plan.inputAsset)) throw new Error("RMT rejected changed approval target.");
        const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
        if (decoded.functionName !== "approve") throw new Error("RMT rejected non-approval token authority.");
        const [spender, amount] = decoded.args;
        const requiredSpender = plan.provider === "uniswap-v4" ? PERMIT2_ADDRESS : plan.router;
        if (getAddress(spender) !== getAddress(requiredSpender) || amount !== BigInt(plan.inputAmountAtomic)) {
          throw new Error("RMT rejected broadened token approval authority.");
        }
      }
    }
  } else if (plan.settlementMode === VNEXT_LEGACY_V1_FEE) {
    if (
      plan.provider !== "uniswap-v3"
      || !plan.netEconomics
      || plan.netEconomics.rmtFee.state !== "planned"
      || !plan.feeExecution
      || plan.directAuthorization !== undefined
      || plan.directNoRmtFee !== undefined
      || plan.feeV2Economics !== undefined
      || plan.feeV2Authorization !== undefined
    ) throw new Error("RMT rejected spot execution authority without complete V1 fee settlement.");
    assertRmtNetExecutionEconomics(plan.netEconomics);
    assertRmtUniswapV3FeeExecution(plan.feeExecution, plan.netEconomics);
    if (plan.payloadHash.toLowerCase() !== authorizationPayloadHash(plan).toLowerCase()) {
      throw new Error("RMT rejected changed V1 spot execution payload.");
    }
    if (plan.kind === "erc20_approval") {
      if (getAddress(plan.target) !== getAddress(plan.inputAsset) || plan.value !== "0") {
        throw new Error("RMT rejected changed V1 approval target or value.");
      }
      const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
      if (decoded.functionName !== "approve") throw new Error("RMT rejected non-approval V1 token authority.");
      const [spender, amount] = decoded.args;
      if (getAddress(spender) !== getAddress(plan.feeExecution.executor) || amount !== BigInt(plan.inputAmountAtomic)) {
        throw new Error("RMT rejected broadened V1 token approval authority.");
      }
    } else if (
      getAddress(plan.target) !== getAddress(plan.feeExecution.executor)
      || plan.data.toLowerCase() !== encodeRmtUniswapV3FeeExecution(plan.feeExecution).toLowerCase()
    ) {
      throw new Error("RMT rejected changed V1 fee-executor swap authority.");
    }
  } else if (plan.settlementMode === "PROVIDER_NATIVE_INPUT_FEE") {
    assertVNextZeroXPlanBinding(plan);
    if (plan.payloadHash !== authorizationPayloadHash(plan)) throw new Error("RMT rejected changed 0x spot execution payload.");
  } else {
    if (!plan.feeV2Economics || !plan.feeV2Authorization) {
      throw new Error("RMT rejected spot execution authority without complete V2 fee settlement.");
    }
    assertRmtExecutionFeeV2Economics(plan.feeV2Economics);
    assertVNextAtomicFeeAuthorizationBinding(
      plan.feeV2Authorization,
      plan.feeV2Economics,
      plan.feeV2Authorization
    );
    if (
      getAddress(plan.feeV2Authorization.recipient) !== getAddress(plan.recipient)
      || getAddress(plan.feeV2Authorization.executionTarget) !== getAddress(plan.target)
      || plan.feeV2Authorization.calldataHash.toLowerCase() !== keccak256(plan.data).toLowerCase()
      || plan.feeV2Authorization.deadline !== plan.deadline
      || plan.feeV2Economics.userGrossInputAtomic !== plan.inputAmountAtomic
      || plan.feeV2Economics.protectedUserNetOutputAtomic !== plan.protectedOutputAtomic
    ) throw new Error("RMT rejected changed V2 spot execution authority.");
  }
  return {
    purpose: "spot_trade",
    chainId: plan.chainId,
    account: plan.recipient,
    target: plan.target,
    data: plan.data,
    valueAtomic: plan.value,
    payloadHash: plan.payloadHash,
    expiresAtMs: plan.expiresAtMs
  };
}
