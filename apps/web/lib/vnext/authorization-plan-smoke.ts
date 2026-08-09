import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData, erc20Abi, keccak256, type Hex } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { authorizationPayloadHash, parseVNextAuthorizationBundle, parseVNextAuthorizationPlan, type VNextAuthorizationPlan } from "./authorization-plan";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";

const routerAbi = [{
  type: "function", name: "exactInputSingle", stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }], outputs: [{ name: "amountOut", type: "uint256" }]
}, {
  type: "function", name: "multicall", stateMutability: "payable",
  inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }],
  outputs: [{ name: "results", type: "bytes[]" }]
}] as const;

const now = 1_786_000_000_000;
const inputAsset = "0x1111111111111111111111111111111111111111";
const outputAsset = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const approvalData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROBINHOOD_SWAP_ROUTER_02, 1_000_000n] });
const baseEvidence: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v3", status: "approval_required", chainId: 4_663,
  inputAsset, outputAsset, inputAmountAtomic: "1000000", indicativeProtectedOutputFloorAtomic: "980", expectedOutputAtomic: "1000",
  protectedOutputAtomic: "990", recipient, router: ROBINHOOD_SWAP_ROUTER_02,
  approvalSpender: ROBINHOOD_SWAP_ROUTER_02, approvalRequired: true, sufficientBalance: true,
  allowanceAtomic: "0", balanceAtomic: "2000000", route: "direct", fees: [3_000],
  pools: ["0x4444444444444444444444444444444444444444"], deadline: "1786000300",
  calldataHash: `0x${"1".repeat(64)}`, nextAction: "approval", nextActionTarget: inputAsset,
  nextActionCalldataHash: keccak256(approvalData), nativeBalanceWei: "1000000000000000",
  gasPriceWei: "1000000000", feeCeilingWei: "3000000000", estimatedGasUnits: "50000", gasLimitUnits: "60000",
  estimatedNetworkCostWei: "180000000000000", gasState: "sufficient",
  estimatedNetworkCostUsdgAtomic: null, networkCostValuationSource: null,
  networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null,
  routerRuntimeHash: `0x${"2".repeat(64)}`, factoryRuntimeHash: `0x${"3".repeat(64)}`,
  quoterRuntimeHash: `0x${"4".repeat(64)}`, exactSimulationPassed: false, userPaysGas: true,
  rmtFeeEnabled: false, verifiedAtMs: now - 1_000, expiresAtMs: now + 300_000, authorizationReady: false
};

function planWithHash(plan: Omit<VNextAuthorizationPlan, "payloadHash">): VNextAuthorizationPlan {
  return { ...plan, payloadHash: authorizationPayloadHash(plan) };
}

const approvalPlan = planWithHash({
  planId: "33333333-3333-4333-8333-333333333333",
  sourceQuoteRequestId: baseEvidence.sourceQuoteRequestId,
  sourceVerificationId: baseEvidence.verificationId,
  provider: "uniswap-v3", kind: "erc20_approval", chainId: 4_663,
  target: inputAsset, data: approvalData, value: "0", gasLimit: "60000",
  inputAsset, outputAsset, inputAmountAtomic: "1000000", protectedOutputAtomic: "990",
  recipient, router: ROBINHOOD_SWAP_ROUTER_02, deadline: baseEvidence.deadline,
  preparedAtMs: now, expiresAtMs: now + 60_000,
  userAuthorizationRequired: true, serverSubmissionEnabled: false
});
assert.equal(parseVNextAuthorizationPlan(approvalPlan, baseEvidence, now + 1).kind, "erc20_approval");
assert.equal(parseVNextAuthorizationPlan({ ...approvalPlan, preparedAtMs: now + 5_001 }, baseEvidence, now + 1).kind, "erc20_approval");
assert.throws(() => parseVNextAuthorizationPlan({ ...approvalPlan, preparedAtMs: now + 5_002 }, baseEvidence, now + 1), /inconsistent/);
const broadenedApproval = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROBINHOOD_SWAP_ROUTER_02, 2_000_000n] });
assert.throws(() => parseVNextAuthorizationPlan(planWithHash({ ...approvalPlan, data: broadenedApproval } as Omit<VNextAuthorizationPlan, "payloadHash">), baseEvidence, now + 1));
assert.throws(() => parseVNextAuthorizationPlan({ ...approvalPlan, target: outputAsset }, baseEvidence, now + 1));
assert.throws(() => parseVNextAuthorizationPlan({ ...approvalPlan, expiresAtMs: now + 60_001 }, baseEvidence, now + 1));
assert.throws(() => parseVNextAuthorizationPlan({ ...approvalPlan, sourceVerificationId: "44444444-4444-4444-8444-444444444444" }, baseEvidence, now + 1));

const swapCall = encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{
  tokenIn: inputAsset, tokenOut: outputAsset, fee: 3_000, recipient,
  amountIn: 1_000_000n, amountOutMinimum: 990n, sqrtPriceLimitX96: 0n
}] });
const swapData = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [1_786_000_300n, [swapCall]] });
const verifiedEvidence: VNextPreSignEvidence = {
  ...baseEvidence, status: "verified", approvalRequired: false, allowanceAtomic: "1000000",
  nextAction: "swap", nextActionTarget: ROBINHOOD_SWAP_ROUTER_02,
  nextActionCalldataHash: keccak256(swapData), calldataHash: keccak256(swapData),
  estimatedGasUnits: "100000", gasLimitUnits: "120000", estimatedNetworkCostWei: "360000000000000",
  exactSimulationPassed: true
};
const swapPlan = planWithHash({
  ...approvalPlan, planId: "55555555-5555-4555-8555-555555555555", kind: "swap",
  target: ROBINHOOD_SWAP_ROUTER_02, data: swapData, gasLimit: "120000"
});
assert.equal(parseVNextAuthorizationPlan(swapPlan, verifiedEvidence, now + 1).kind, "swap");
const bundleEvidence = { ...verifiedEvidence, verifiedAtMs: now, expiresAtMs: now + 300_000 };
const changedMinimum = encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{
  tokenIn: inputAsset, tokenOut: outputAsset, fee: 3_000, recipient,
  amountIn: 1_000_000n, amountOutMinimum: 989n, sqrtPriceLimitX96: 0n
}] });
const changedSwap = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [1_786_000_300n, [changedMinimum]] });
assert.throws(() => parseVNextAuthorizationPlan(planWithHash({ ...swapPlan, data: changedSwap } as Omit<VNextAuthorizationPlan, "payloadHash">), verifiedEvidence, now + 1));
assert.equal(parseVNextAuthorizationBundle({ evidence: bundleEvidence, plan: swapPlan }, bundleEvidence, {
  quoteRequestId: verifiedEvidence.sourceQuoteRequestId,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "1000000",
  recipient
}, now + 1).plan.kind, "swap");
assert.throws(() => parseVNextAuthorizationBundle({
  evidence: { ...bundleEvidence, protectedOutputAtomic: "989" },
  plan: { ...swapPlan, protectedOutputAtomic: "989" }
}, bundleEvidence, {
  quoteRequestId: verifiedEvidence.sourceQuoteRequestId,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "1000000",
  recipient
}, now + 1), /weakened protection/);

const endpoint = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const parser = readFileSync(new URL("./authorization-plan.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(endpoint, /RMT_VNEXT_AUTHORIZATION_ENABLED !== "true"/);
assert.match(endpoint, /requireAuthenticatedTradeWallet/);
assert.match(endpoint, /readRobinhoodTokenIdentity/);
assert.match(endpoint, /prepareRobinhoodVNextAuthorization/);
assert.doesNotMatch(endpoint, /prepareVNextUniswapAuthorization/);
assert.match(endpoint, /Route evidence changed/);
assert.match(endpoint, /expectedProtectedOutputAtomic/);
assert.match(endpoint, /indicativeProtectedOutputFloorAtomic/);
assert.match(endpoint, /Invalid VNext quote-continuity floor/);
assert.match(endpoint, /protectedOutputFloorAtomic/);
assert.match(endpoint, /evidence:/);
assert.match(endpoint, /serverSubmissionEnabled: false/);
assert.match(readFileSync(new URL("../server/vnext-uniswap-quote.ts", import.meta.url), "utf8"), /wallet authorization \(\$\{evidence\.status\}\)/);
assert.match(parser, /decodeFunctionData/);
assert.match(composer, /NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED === "true"/);
assert.match(composer, /parseVNextAuthorizationBundle/);
assert.match(composer, /opening the exact request in your wallet automatically/);
assert.match(composer, /requestAuthorizationPlan/);
assert.match(composer, /Wallet-review plan expired/);
assert.doesNotMatch(endpoint, /writeContract|sendTransaction|signTypedData|database|firestore/);
assert.doesNotMatch(parser, /writeContract|sendTransaction|signTypedData/);
assert.doesNotMatch(composer, /writeContract|sendTransaction|signTypedData|useSendTransaction/);

console.log("RMT VNext authorization-plan boundary smoke checks passed.");
