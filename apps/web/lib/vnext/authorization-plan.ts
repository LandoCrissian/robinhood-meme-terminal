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
  name: "multicall",
  stateMutability: "payable",
  inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }],
  outputs: [{ name: "results", type: "bytes[]" }]
}] as const;

export type VNextAuthorizationPlan = {
  planId: string;
  sourceQuoteRequestId: string;
  sourceVerificationId: string;
  provider: "uniswap-v3";
  kind: "erc20_approval" | "swap";
  chainId: 4_663;
  target: string;
  data: Hex;
  value: "0";
  gasLimit: string;
  payloadHash: Hex;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  router: string;
  deadline: string;
  preparedAtMs: number;
  expiresAtMs: number;
  userAuthorizationRequired: true;
  serverSubmissionEnabled: false;
};

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const planSchema = z.object({
  planId: z.string().uuid(), sourceQuoteRequestId: z.string().uuid(), sourceVerificationId: z.string().uuid(),
  provider: z.literal("uniswap-v3"), kind: z.enum(["erc20_approval", "swap"]), chainId: z.literal(4_663),
  target: z.string(), data: z.string().regex(/^0x[0-9a-fA-F]+$/), value: z.literal("0"), gasLimit: atomic,
  payloadHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), inputAsset: z.string(), outputAsset: z.string(),
  inputAmountAtomic: atomic, protectedOutputAtomic: atomic, recipient: z.string(), router: z.string(), deadline: atomic,
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
    || getAddress(plan.router) !== getAddress(ROBINHOOD_SWAP_ROUTER_02)
    || plan.inputAmountAtomic !== evidence.inputAmountAtomic
    || plan.protectedOutputAtomic !== evidence.protectedOutputAtomic
    || plan.deadline !== evidence.deadline
    || plan.gasLimit !== evidence.gasLimitUnits
    || plan.payloadHash !== authorizationPayloadHash(plan)
    || plan.preparedAtMs > nowMs + MAX_CLOCK_SKEW_MS || plan.expiresAtMs <= nowMs
    || plan.expiresAtMs - plan.preparedAtMs > 60_000
    || plan.expiresAtMs > Number(BigInt(plan.deadline) * 1_000n)
  ) throw new Error("RMT rejected an inconsistent authorization plan.");

  if (plan.kind === "erc20_approval") {
    if (evidence.status !== "approval_required" || getAddress(plan.target) !== getAddress(evidence.inputAsset) || keccak256(plan.data) !== evidence.nextActionCalldataHash) {
      throw new Error("RMT rejected an approval plan that does not match strict evidence.");
    }
    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
    if (decoded.functionName !== "approve") throw new Error("RMT rejected a non-approval token call.");
    const [spender, amount] = decoded.args;
    if (getAddress(spender) !== getAddress(ROBINHOOD_SWAP_ROUTER_02) || amount !== BigInt(evidence.inputAmountAtomic)) {
      throw new Error("RMT rejected broadened approval authority.");
    }
    return plan;
  }

  if (evidence.status !== "verified" || getAddress(plan.target) !== getAddress(ROBINHOOD_SWAP_ROUTER_02) || keccak256(plan.data) !== evidence.calldataHash) {
    throw new Error("RMT rejected a swap plan that does not match strict evidence.");
  }
  const outer = decodeFunctionData({ abi: routerAbi, data: plan.data });
  if (outer.functionName !== "multicall") throw new Error("RMT rejected a swap outside the verified multicall boundary.");
  const [deadline, calls] = outer.args;
  if (deadline !== BigInt(evidence.deadline) || calls.length !== 1) throw new Error("RMT rejected changed deadline or call count.");
  const inner = decodeFunctionData({ abi: routerAbi, data: calls[0] });
  if (evidence.route === "direct") {
    if (inner.functionName !== "exactInputSingle") throw new Error("RMT rejected a changed direct-swap function.");
    const params = inner.args[0];
    if (
      getAddress(params.tokenIn) !== getAddress(evidence.inputAsset)
      || getAddress(params.tokenOut) !== getAddress(evidence.outputAsset)
      || getAddress(params.recipient) !== getAddress(evidence.recipient)
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
      getAddress(path.tokenIn) !== getAddress(evidence.inputAsset)
      || getAddress(path.intermediate) !== getAddress(ROBINHOOD_WETH)
      || getAddress(path.tokenOut) !== getAddress(evidence.outputAsset)
      || path.fee0 !== evidence.fees[0] || path.fee1 !== evidence.fees[1]
      || getAddress(params.recipient) !== getAddress(evidence.recipient)
      || params.amountIn !== BigInt(evidence.inputAmountAtomic)
      || params.amountOutMinimum !== BigInt(evidence.protectedOutputAtomic)
    ) throw new Error("RMT rejected changed multihop-swap economics.");
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
    || BigInt(evidence.protectedOutputAtomic) < BigInt(priorEvidence.protectedOutputAtomic)
  ) throw new Error("RMT rejected changed authorization authority or weakened protection.");
  const plan = parseVNextAuthorizationPlan(parsed.data.plan, evidence, nowMs);
  return { evidence, plan };
}
