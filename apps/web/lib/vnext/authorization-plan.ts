import {
  decodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { isRobinhoodNativeAsset } from "./robinhood-assets";
import { assertUpSwapCalldata, UP_CL_EXECUTION_ROUTER, UP_V2_EXECUTION_ROUTER, type UpAuthorizationEvidence } from "./up-authorization-codec";
import type { RmtNetExecutionEconomics } from "./execution-fee-policy";
import { assertRmtUniswapV3FeeCalldata, type RmtUniswapV3FeeExecution } from "./uniswap-v3-fee-executor";
import { SUSHI_RED_SNWAPPER } from "../sushi";
import { assertSushiSwapCalldata } from "./sushi-authorization-codec";

const MAX_CLOCK_SKEW_MS = 5_000;

const routerAbi = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function",
  name: "exactInput",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "path", type: "bytes" }, { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function",
  name: "unwrapWETH9",
  stateMutability: "payable",
  inputs: [{ name: "amountMinimum", type: "uint256" }, { name: "recipient", type: "address" }],
  outputs: []
}, {
  type: "function",
  name: "multicall",
  stateMutability: "payable",
  inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }],
  outputs: [{ name: "results", type: "bytes[]" }]
}] as const;

export type VNextAuthorizationPlan = {
  planId: string;
  sourceQuoteRequestId: string;
  sourceVerificationId: string;
  provider: "sushi" | "uniswap-v3" | "up-v2" | "up-cl";
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
  netEconomics?: RmtNetExecutionEconomics;
  feeExecution?: RmtUniswapV3FeeExecution | null;
  deadline: string;
  preparedAtMs: number;
  expiresAtMs: number;
  userAuthorizationRequired: true;
  serverSubmissionEnabled: false;
};

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const planSchema = z.object({
  planId: z.string().uuid(), sourceQuoteRequestId: z.string().uuid(), sourceVerificationId: z.string().uuid(),
  provider: z.enum(["sushi", "uniswap-v3", "up-v2", "up-cl"]), kind: z.enum(["erc20_approval", "swap"]), chainId: z.literal(4_663),
  target: z.string(), data: z.string().regex(/^0x[0-9a-fA-F]+$/), value: atomic, gasLimit: atomic,
  payloadHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), inputAsset: z.string(), outputAsset: z.string(),
  inputAmountAtomic: atomic, protectedOutputAtomic: atomic, recipient: z.string(), router: z.string(), deadline: atomic,
  netEconomics: z.unknown().optional(), feeExecution: z.unknown().nullable().optional(),
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

function decodeTwoHopPath(path: Hex) {
  const body = path.slice(2);
  if (body.length !== 132) throw new Error("RMT rejected an unexpected Uniswap path length.");
  return {
    tokenIn: getAddress(`0x${body.slice(0, 40)}`),
    fee0: Number.parseInt(body.slice(40, 46), 16),
    intermediate: getAddress(`0x${body.slice(46, 86)}`),
    fee1: Number.parseInt(body.slice(86, 92), 16),
    tokenOut: getAddress(`0x${body.slice(92, 132)}`)
  };
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
    || getAddress(plan.router) !== getAddress(evidence.provider === "sushi" ? SUSHI_RED_SNWAPPER : evidence.provider === "uniswap-v3" ? ROBINHOOD_SWAP_ROUTER_02 : evidence.provider === "up-v2" ? UP_V2_EXECUTION_ROUTER : UP_CL_EXECUTION_ROUTER)
    || plan.inputAmountAtomic !== evidence.inputAmountAtomic
    || plan.protectedOutputAtomic !== evidence.protectedOutputAtomic
    || plan.value !== evidence.transactionValueAtomic
    || plan.deadline !== evidence.deadline
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

  if (plan.kind === "erc20_approval") {
    if (plan.value !== "0" || evidence.status !== "approval_required" || getAddress(plan.target) !== getAddress(evidence.inputAsset) || keccak256(plan.data) !== evidence.nextActionCalldataHash) {
      throw new Error("RMT rejected an approval plan that does not match strict evidence.");
    }
    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
    if (decoded.functionName !== "approve") throw new Error("RMT rejected a non-approval token call.");
    const [spender, amount] = decoded.args;
    if (getAddress(spender) !== getAddress(evidence.approvalSpender) || amount !== BigInt(evidence.inputAmountAtomic)) {
      throw new Error("RMT rejected broadened approval authority.");
    }
    return plan;
  }

  const expectedSwapTarget = evidence.rmtFeeEnabled ? evidence.feeExecution!.executor : evidence.router;
  if (evidence.status !== "verified" || getAddress(plan.target) !== getAddress(expectedSwapTarget) || keccak256(plan.data) !== evidence.calldataHash) {
    throw new Error("RMT rejected a swap plan that does not match strict evidence.");
  }
  if (evidence.provider === "up-v2" || evidence.provider === "up-cl") {
    assertUpSwapCalldata(plan.data, evidence as UpAuthorizationEvidence);
    return plan;
  }
  if (evidence.provider === "sushi") {
    assertSushiSwapCalldata(plan.data, {
      inputAsset: evidence.inputAsset,
      outputAsset: evidence.outputAsset,
      inputAmountAtomic: evidence.inputAmountAtomic,
      protectedOutputAtomic: evidence.protectedOutputAtomic,
      recipient: evidence.recipient,
      transactionValueAtomic: plan.value
    });
    return plan;
  }
  if (evidence.rmtFeeEnabled) {
    if (!plan.netEconomics || !plan.feeExecution || !evidence.netEconomics || !evidence.feeExecution) {
      throw new Error("RMT rejected incomplete fee-executor wallet authority.");
    }
    assertRmtUniswapV3FeeCalldata(plan.data, plan.feeExecution, plan.netEconomics);
    return plan;
  }
  const outer = decodeFunctionData({ abi: routerAbi, data: plan.data });
  if (outer.functionName !== "multicall") throw new Error("RMT rejected a swap outside the verified multicall boundary.");
  const [deadline, calls] = outer.args;
  const nativeOutput = isRobinhoodNativeAsset(evidence.outputAsset);
  if (deadline !== BigInt(evidence.deadline) || calls.length !== (nativeOutput ? 2 : 1)) {
    throw new Error("RMT rejected changed deadline or call count.");
  }
  const inner = decodeFunctionData({ abi: routerAbi, data: calls[0] });
  const expectedSwapInput = isRobinhoodNativeAsset(evidence.inputAsset) ? ROBINHOOD_WETH : getAddress(evidence.inputAsset);
  const expectedSwapOutput = nativeOutput ? getAddress(ROBINHOOD_WETH) : getAddress(evidence.outputAsset);
  const expectedSwapRecipient = nativeOutput ? getAddress(ROBINHOOD_SWAP_ROUTER_02) : getAddress(evidence.recipient);
  if (plan.value !== (isRobinhoodNativeAsset(evidence.inputAsset) ? evidence.inputAmountAtomic : "0")) {
    throw new Error("RMT rejected changed native swap value.");
  }
  if (evidence.route === "direct") {
    if (inner.functionName !== "exactInputSingle") throw new Error("RMT rejected a changed direct-swap function.");
    const params = inner.args[0];
    if (
      getAddress(params.tokenIn) !== expectedSwapInput
      || getAddress(params.tokenOut) !== expectedSwapOutput
      || getAddress(params.recipient) !== expectedSwapRecipient
      || params.amountIn !== BigInt(evidence.inputAmountAtomic)
      || params.amountOutMinimum !== BigInt(evidence.protectedOutputAtomic)
      || params.fee !== evidence.fees[0]
      || params.sqrtPriceLimitX96 !== 0n
    ) throw new Error("RMT rejected changed direct-swap economics.");
  } else {
    if (inner.functionName !== "exactInput") throw new Error("RMT rejected a changed multihop-swap function.");
    const params = inner.args[0];
    const path = decodeTwoHopPath(params.path);
    if (
      getAddress(path.tokenIn) !== expectedSwapInput
      || getAddress(path.intermediate) !== getAddress(ROBINHOOD_WETH)
      || getAddress(path.tokenOut) !== expectedSwapOutput
      || path.fee0 !== evidence.fees[0] || path.fee1 !== evidence.fees[1]
      || getAddress(params.recipient) !== expectedSwapRecipient
      || params.amountIn !== BigInt(evidence.inputAmountAtomic)
      || params.amountOutMinimum !== BigInt(evidence.protectedOutputAtomic)
    ) throw new Error("RMT rejected changed multihop-swap economics.");
  }
  if (nativeOutput) {
    const unwrap = decodeFunctionData({ abi: routerAbi, data: calls[1] });
    if (unwrap.functionName !== "unwrapWETH9") throw new Error("RMT rejected missing native-output unwrap.");
    const [amountMinimum, unwrapRecipient] = unwrap.args;
    if (
      amountMinimum !== BigInt(evidence.protectedOutputAtomic)
      || getAddress(unwrapRecipient) !== getAddress(evidence.recipient)
    ) throw new Error("RMT rejected changed native-output unwrap economics.");
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
