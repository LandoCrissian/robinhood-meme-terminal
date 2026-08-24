import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData, encodePacked, getAddress, keccak256, zeroAddress } from "viem";
import {
  assertUpSwapCalldata,
  UP_CL_EXECUTION_ROUTER,
  UP_CL_EXECUTION_ROUTER_RUNTIME_HASH,
  UP_CL_FACTORY_ADDRESS,
  UP_V2_EXECUTION_ROUTER,
  UP_V2_FACTORY_ADDRESS,
  upClExecutionAbi,
  upV2ExecutionAbi,
  type UpAuthorizationEvidence
} from "./up-authorization-codec";
import { ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { authorizationPayloadHash, parseVNextAuthorizationPlan, type VNextAuthorizationPlan } from "./authorization-plan";

const input = getAddress("0x1111111111111111111111111111111111111111");
const output = getAddress("0x2222222222222222222222222222222222222222");
const recipient = getAddress("0x3333333333333333333333333333333333333333");
const pools = [getAddress("0x4444444444444444444444444444444444444444"), getAddress("0x5555555555555555555555555555555555555555")];
const deadline = 1_786_000_300n;

const v2Evidence: UpAuthorizationEvidence = {
  provider: "up-v2", inputAsset: input, outputAsset: output, inputAmountAtomic: "1000000",
  protectedOutputAtomic: "990", recipient, deadline: deadline.toString(), transactionValueAtomic: "0",
  route: "weth_hop", pools, fees: [20, 30], stableFlags: [false, true]
};
const v2Routes = [
  { from: input, to: ROBINHOOD_WETH_ADDRESS, stable: false, factory: UP_V2_FACTORY_ADDRESS },
  { from: ROBINHOOD_WETH_ADDRESS, to: output, stable: true, factory: UP_V2_FACTORY_ADDRESS }
] as const;
const v2Data = encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [1_000_000n, 990n, v2Routes, recipient, deadline] });
assert.doesNotThrow(() => assertUpSwapCalldata(v2Data, v2Evidence));
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [999_999n, 990n, v2Routes, recipient, deadline] }), v2Evidence), /economics/);
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [1_000_000n, 989n, v2Routes, recipient, deadline] }), v2Evidence), /economics/);
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [1_000_000n, 990n, v2Routes, output, deadline] }), v2Evidence), /economics/);
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [1_000_000n, 990n, v2Routes, recipient, deadline - 1n] }), v2Evidence), /economics/);
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [1_000_000n, 990n, [{ ...v2Routes[0], stable: true }, v2Routes[1]], recipient, deadline] }), v2Evidence), /route legs/);
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upV2ExecutionAbi, functionName: "swapExactTokensForTokens", args: [1_000_000n, 990n, [{ ...v2Routes[0], factory: UP_CL_FACTORY_ADDRESS }, v2Routes[1]], recipient, deadline] }), v2Evidence), /route legs/);
assert.throws(() => assertUpSwapCalldata(`${v2Data}00`, v2Evidence), /trailing/);

const now = 1_786_000_000_000;
const completeV2Evidence: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  ...v2Evidence, status: "verified", chainId: 4_663,
  indicativeProtectedOutputFloorAtomic: "980", expectedOutputAtomic: "1000",
  router: UP_V2_EXECUTION_ROUTER, approvalSpender: UP_V2_EXECUTION_ROUTER,
  approvalRequired: false, sufficientBalance: true, allowanceAtomic: "1000000", balanceAtomic: "2000000",
  quoteBlock: "34716350", quoteBlockHash: `0x${"a".repeat(64)}`,
  calldataHash: `0x${"b".repeat(64)}`, nextAction: "swap", nextActionTarget: UP_V2_EXECUTION_ROUTER,
  nextActionCalldataHash: `0x${"b".repeat(64)}`, nativeBalanceWei: "1000000000000000",
  gasPriceWei: "1000000000", feeCeilingWei: "3000000000", estimatedGasUnits: "100000", gasLimitUnits: "120000",
  estimatedNetworkCostWei: "360000000000000", estimatedNetworkCostUsdgAtomic: null, networkCostValuationSource: null,
  networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null, gasState: "sufficient",
  routerRuntimeHash: `0x${"c".repeat(64)}`, factoryRuntimeHash: `0x${"d".repeat(64)}`, quoterRuntimeHash: `0x${"e".repeat(64)}`,
  exactSimulationPassed: true, userPaysGas: true, rmtFeeEnabled: false,
  verifiedAtMs: now, expiresAtMs: now + 300_000, authorizationReady: false
};
const expectedV2 = {
  quoteRequestId: completeV2Evidence.sourceQuoteRequestId, inputAsset: input, outputAsset: output,
  inputAmountAtomic: "1000000", provider: "up-v2" as const, protectedOutputFloorAtomic: "980", recipient
};
assert.equal(parseVNextPreSignEvidence(completeV2Evidence, expectedV2, now).provider, "up-v2");
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, chainId: 1 }, expectedV2, now));
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, router: UP_CL_EXECUTION_ROUTER }, expectedV2, now));
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, approvalSpender: UP_CL_EXECUTION_ROUTER }, expectedV2, now));
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, inputAsset: output }, expectedV2, now));
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, outputAsset: input }, expectedV2, now));
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, protectedOutputAtomic: "979" }, expectedV2, now));
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, stableFlags: [false] }, expectedV2, now));
assert.throws(() => parseVNextPreSignEvidence({ ...completeV2Evidence, tickSpacings: [60] }, expectedV2, now));
assert.equal(parseVNextPreSignEvidence({
  ...completeV2Evidence, status: "approval_simulation_failed", approvalRequired: true, allowanceAtomic: "0",
  exactSimulationPassed: false, nextAction: "approval", nextActionTarget: input,
  gasState: "not_checked", estimatedGasUnits: null, gasLimitUnits: null, estimatedNetworkCostWei: null
}, expectedV2, now).status, "approval_simulation_failed");

const unsignedV2Plan: Omit<VNextAuthorizationPlan, "payloadHash"> = {
  planId: "33333333-3333-4333-8333-333333333333", sourceQuoteRequestId: completeV2Evidence.sourceQuoteRequestId,
  sourceVerificationId: completeV2Evidence.verificationId, provider: "up-v2", kind: "swap", chainId: 4_663,
  target: UP_V2_EXECUTION_ROUTER, data: v2Data, value: "0", gasLimit: "120000", inputAsset: input, outputAsset: output,
  inputAmountAtomic: "1000000", protectedOutputAtomic: "990", recipient, router: UP_V2_EXECUTION_ROUTER,
  deadline: deadline.toString(), preparedAtMs: now, expiresAtMs: now + 60_000,
  userAuthorizationRequired: true, serverSubmissionEnabled: false
};
const v2Plan: VNextAuthorizationPlan = { ...unsignedV2Plan, payloadHash: authorizationPayloadHash(unsignedV2Plan) };
const planEvidence = { ...completeV2Evidence, calldataHash: keccak256(v2Data), nextActionCalldataHash: keccak256(v2Data) };
assert.throws(
  () => parseVNextAuthorizationPlan(v2Plan, planEvidence, now + 1),
  /without complete V2 fee authority/,
  "audited UP calldata remains quote-verifiable but cannot authorize a fee-free direct router transaction"
);
assert.throws(() => parseVNextAuthorizationPlan({ ...v2Plan, provider: "up-cl" }, planEvidence, now + 1));
assert.throws(() => parseVNextAuthorizationPlan({ ...v2Plan, router: UP_CL_EXECUTION_ROUTER }, planEvidence, now + 1));

const clEvidence: UpAuthorizationEvidence = {
  provider: "up-cl", inputAsset: input, outputAsset: output, inputAmountAtomic: "1000000",
  protectedOutputAtomic: "990", recipient, deadline: deadline.toString(), transactionValueAtomic: "0",
  route: "weth_hop", pools, fees: [500, 300], tickSpacings: [60, 1]
};
const clPath = encodePacked(["address", "int24", "address", "int24", "address"], [input, 60, ROBINHOOD_WETH_ADDRESS, 1, output]);
const clData = encodeFunctionData({ abi: upClExecutionAbi, functionName: "exactInput", args: [{
  path: clPath, recipient, deadline, amountIn: 1_000_000n, amountOutMinimum: 990n
}] });
assert.doesNotThrow(() => assertUpSwapCalldata(clData, clEvidence));
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upClExecutionAbi, functionName: "exactInput", args: [{
  path: encodePacked(["address", "int24", "address", "int24", "address"], [input, 1, ROBINHOOD_WETH_ADDRESS, 60, output]),
  recipient, deadline, amountIn: 1_000_000n, amountOutMinimum: 990n
}] }), clEvidence), /multihop economics/);
assert.throws(() => assertUpSwapCalldata(encodeFunctionData({ abi: upClExecutionAbi, functionName: "exactInput", args: [{
  path: encodePacked(["address", "int24", "address", "int24", "address"], [output, 60, ROBINHOOD_WETH_ADDRESS, 1, input]),
  recipient, deadline, amountIn: 1_000_000n, amountOutMinimum: 990n
}] }), clEvidence), /multihop economics/);
assert.throws(() => assertUpSwapCalldata(`${clData}00`, clEvidence), /trailing/);
assert.throws(() => assertUpSwapCalldata(v2Data, { ...clEvidence, provider: "up-cl" }));
assert.throws(() => assertUpSwapCalldata(clData, { ...v2Evidence, provider: "up-v2" }));

const nativeOutputEvidence: UpAuthorizationEvidence = {
  ...clEvidence, outputAsset: zeroAddress, route: "direct", pools: [pools[0]], fees: [500], tickSpacings: [60]
};
const nativeSwap = encodeFunctionData({ abi: upClExecutionAbi, functionName: "exactInputSingle", args: [{
  tokenIn: input, tokenOut: ROBINHOOD_WETH_ADDRESS, tickSpacing: 60, recipient: zeroAddress,
  deadline, amountIn: 1_000_000n, amountOutMinimum: 990n, sqrtPriceLimitX96: 0n
}] });
const nativeData = encodeFunctionData({ abi: upClExecutionAbi, functionName: "multicall", args: [[
  nativeSwap,
  encodeFunctionData({ abi: upClExecutionAbi, functionName: "unwrapWETH9", args: [990n, recipient] })
]] });
assert.doesNotThrow(() => assertUpSwapCalldata(nativeData, nativeOutputEvidence));
assert.throws(() => assertUpSwapCalldata(nativeSwap, nativeOutputEvidence), /native-output unwrap/);

assert.equal(UP_V2_EXECUTION_ROUTER, getAddress("0xf5198743240fAC98db71868F34c70139b1eb0474"));
assert.equal(UP_CL_EXECUTION_ROUTER, getAddress("0xC062b870E813fcA720f1e002c234369Ab3aB9415"));
assert.equal(UP_CL_EXECUTION_ROUTER_RUNTIME_HASH, "0x11ea7d3599ef56eda32c0ce7ca26e9aae71bec13bfcbd3ad0e83826c1a2defe4");

const executionSource = readFileSync(new URL("../server/vnext-up-execution.ts", import.meta.url), "utf8");
assert.match(executionSource, /quote block was reorganized/);
assert.match(executionSource, /pool identity, stable flag, or live fee changed/);
assert.match(executionSource, /pool identity, tick spacing, or live fee changed/);
assert.match(executionSource, /client\.call/);
assert.match(executionSource, /client\.estimateGas/);
assert.match(executionSource, /functionName: "allowance"/);
assert.match(executionSource, /functionName: "approve"/);
assert.match(executionSource, /args: \[router, input\.amountIn\]/);
assert.match(executionSource, /runtime bytecode is not approved/);
assert.doesNotMatch(executionSource, /sendTransaction|writeContract|signTypedData|privateKey/);

console.log("RMT VNext up strict authorization and adversarial calldata checks passed.");
