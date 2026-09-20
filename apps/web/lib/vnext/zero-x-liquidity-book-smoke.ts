import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, zeroAddress, type Hex } from "viem";
import { decodeZeroXExecutableMinimum, verifyZeroXEncodedFee, ZERO_X_PPM_SETTLER_RUNTIME_HASH } from "../server/vnext-zero-x-execution-decoder";
import { cannacatRouteActions, routeTokens } from "./zero-x-robinhood-route-smoke";
import { feeMutations, mutateZeroXActions } from "./zero-x-provider-native-fee-smoke";
import { ExecutionEnvelopeFailure } from "./trade-failure";
import { ZERO_X_NATIVE_TOKEN } from "./zero-x-settlement";
const fixture = createRequire(import.meta.url)("../../../../.github/scripts/zerox-execution-fixture.cjs");
const router = getAddress("0x4463c6f5BaDE414eC5E34D94245ec0F55C4d8B51");
const settler = getAddress(fixture.settler);
const holder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const user = getAddress("0x0000000000000000000000000000000000010000");
const other = getAddress("0x0000000000000000000000000000000000023456");
const basicAbi = parseAbi(["function BASIC(address token,uint256 proportion,address target,uint256 offset,bytes data)"]);
const routerAbi = parseAbi(["function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,uint256[] pairBinSteps,address[] tokenPath,address to,uint256 deadline) returns(uint256)"]);
const nested = (args: readonly unknown[]) => encodeFunctionData({ abi: routerAbi, functionName: "swapExactTokensForTokens", args } as any);
const basic = (args: readonly unknown[]) => encodeFunctionData({ abi: basicAbi, functionName: "BASIC", args } as any);

/** Observed seven-action kinds/target/selector/offset/rate, with source-derived
 * synthetic nested arguments. NOT the discarded production calldata/path.
 */
export function liquidityBookRouteActions(body: any, recipient = user): Hex[] {
  const previous = cannacatRouteActions(body, recipient);
  return [...previous.slice(0, 3), basic([routeTokens.usdg, 1_000_000n, router, 4n,
    nested([0n, 0n, [20n], [routeTokens.usdg, routeTokens.weth], settler, 2n ** 64n])]), ...previous.slice(5)];
}

export function runZeroXLiquidityBookSmoke() {
  const body = { sellToken: routeTokens.usdg, buyToken: routeTokens.canna, sellAmount: "1000000",
    buyAmount: "31281759107382449535190", minBuyAmount: "30971939696219283184792",
    fees: { zeroExFee: { token: routeTokens.usdg, amount: "1500" } }, transaction: { to: holder } };
  const data = fixture.encodeQuote({ ...body, actionsForTest: liquidityBookRouteActions(body) }, user) as Hex;
  const input = { target: holder, data, inputAsset: routeTokens.usdg, outputAsset: routeTokens.canna,
    inputAmountAtomic: "1000000", recipient: user, valueAtomic: "0", runtimeHash: ZERO_X_PPM_SETTLER_RUNTIME_HASH,
    expectedOutputAtomic: body.buyAmount, providerFeeAsset: routeTokens.usdg, providerFeeAtomic: "1500" };
  assert.equal(verifyZeroXEncodedFee(input).count, 1);
  assert.equal(decodeZeroXExecutableMinimum(input).minimumAtomic, body.minBuyAmount);
  assert.equal(decodeZeroXExecutableMinimum(input).actions.length, 7);
  let negatives = 0, positives = 1;
  const mutate = (change: (args: any[]) => void) => mutateZeroXActions(data, actions => {
    const decoded = decodeFunctionData({ abi: basicAbi, data: actions[3] });
    const args = [...decoded.args]; change(args); actions[3] = basic(args);
  });
  const changeNested = (change: (args: any[]) => void) => mutate(a => {
    const args = [...decodeFunctionData({ abi: routerAbi, data: a[4] }).args]; change(args); a[4] = nested(args);
  });
  const reject = (changed: Hex, label: string) => {
    assert.throws(() => verifyZeroXEncodedFee({ ...input, data: changed }), error => error instanceof ExecutionEnvelopeFailure, label); negatives++;
  };
  for (const [label, mutation] of feeMutations) reject(mutateZeroXActions(data, mutation), label);
  for (const [arg, value] of [[0, other], [0, ZERO_X_NATIVE_TOKEN], [0, zeroAddress], [1, 0n], [1, 1_000_001n],
    [2, other], [2, routeTokens.weth], [3, 0n], [3, 36n], [3, 4n + 32n * 4n]] as const) {
    reject(mutate(a => { a[arg] = value; }), `BASIC binding ${arg}/${value}`);
  }
  for (const [arg, value] of [[2, []], [2, [20n, 30n]], [2, [65_536n]], [3, [other, routeTokens.weth]],
    [3, [routeTokens.usdg, other]], [3, [routeTokens.usdg, routeTokens.usdg]], [3, [routeTokens.usdg, zeroAddress]],
    [3, [routeTokens.usdg, ZERO_X_NATIVE_TOKEN]], [4, user], [4, other], [4, zeroAddress], [5, 0n]] as const) {
    reject(changeNested(a => { a[arg] = value; }), `nested binding ${arg}`);
  }
  reject(mutate(a => { a[4] = "0xdeadbeef" + a[4].slice(10); }), "unknown selector");
  reject(mutate(a => { a[4] += "00"; }), "trailing byte");
  const encoded = decodeFunctionData({ abi: basicAbi, data: liquidityBookRouteActions(body)[3] }).args[4];
  assert.equal((encoded.length - 2) / 2, 356, "same nested length as retained structural evidence");
  for (let end = 2; end < encoded.length; end += 2) reject(mutate(a => { a[4] = encoded.slice(0, end); }), "truncated call");
  reject(changeNested(a => { a[2] = Array(17).fill(20n); a[3] = Array.from({ length: 18 }, (_, i) => i % 2 ? routeTokens.weth : routeTokens.usdg); }), "hop overflow");
  reject(mutateZeroXActions(data, a => { a.splice(4, 0, a[0]); }), "second user withdrawal");
  reject(mutateZeroXActions(data, a => { a.splice(4, 0, "0xdeadbeef"); }), "unknown action");
  assert.throws(() => verifyZeroXEncodedFee({ ...input, valueAtomic: "1" }), ExecutionEnvelopeFailure); negatives++;
  assert.throws(() => verifyZeroXEncodedFee({ ...input, recipient: other }), ExecutionEnvelopeFailure); negatives++;
  // Entire first uint is overwritten; a literal cannot create extra input authority.
  for (const amount of [0n, 1n, 2n ** 256n - 1n]) {
    assert.equal(verifyZeroXEncodedFee({ ...input, data: changeNested(a => { a[0] = amount; }) }).count, 1); positives++;
  }
  for (const proportion of [1n, 500_000n, 1_000_000n]) {
    assert.equal(verifyZeroXEncodedFee({ ...input, data: mutate(a => { a[1] = proportion; }) }).count, 1); positives++;
  }
  // Family support: factory-resolved multi-hop and legacy factory paths, not one pool.
  for (const steps of [[0n], [25n], [65_535n]]) {
    assert.equal(verifyZeroXEncodedFee({ ...input, data: changeNested(a => { a[2] = steps; }) }).count, 1); positives++;
  }
  assert.equal(verifyZeroXEncodedFee({ ...input, data: changeNested(a => {
    a[2] = [20n, 25n]; a[3] = [routeTokens.usdg, other, routeTokens.weth];
  }) }).count, 1); positives++;
  console.log(`Liquidity Book BASIC: ${positives} positives / ${negatives} negatives; synthetic observed 7-action envelope PASS.`);
}
