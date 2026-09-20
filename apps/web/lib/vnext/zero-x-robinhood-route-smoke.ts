import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, zeroAddress, type Hex } from "viem";
import { decodeZeroXExecutableMinimum, verifyZeroXEncodedFee, ZERO_X_PPM_SETTLER_RUNTIME_HASH } from "../server/vnext-zero-x-execution-decoder";
import { decodeZeroXPackedRoute } from "../server/vnext-zero-x-packed-route";
import { ZERO_X_NATIVE_TOKEN } from "./zero-x-settlement";
import { mutateZeroXActions, feeMutations } from "./zero-x-provider-native-fee-smoke";
import { ExecutionEnvelopeFailure } from "./trade-failure";
const fixture = createRequire(import.meta.url)("../../../../.github/scripts/zerox-execution-fixture.cjs");
export const routeTokens = {
  usdg: getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  canna: getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92"),
  weth: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")
};
const settler = getAddress(fixture.settler), holder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const user = getAddress("0x0000000000000000000000000000000000010000");
const other = getAddress("0x0000000000000000000000000000000000023456");
const abi = parseAbi([
  "function EKUBOV3(address recipient,address token,uint256 ppm,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 minimum)",
  "function UNISWAPV4(address recipient,address token,uint256 ppm,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 minimum)",
  "function BASIC(address token,uint256 ppm,address target,uint256 offset,bytes data)",
  "function POSITIVE_SLIPPAGE(address recipient,address token,uint256 expected,uint256 cap)"
]);
const hex = (value: bigint | number, bytes: number) => BigInt(value).toString(16).padStart(bytes * 2, "0");
export const ekuboFill = (buy = ZERO_X_NATIVE_TOKEN) => ("0x" + hex(1_000_000, 3) + hex(4611797791050542631n, 12) + "01" + buy.slice(2) + "00".repeat(32)) as Hex;
export const v4Fill = (buy = routeTokens.canna, hook = getAddress("0x0000000000000000000000000000000000000088"), data: Hex = "0x1234") =>
  ("0x" + hex(1_000_000, 3) + hex(4295128740n, 20) + "01" + buy.slice(2) + hex(3000, 3) + hex(60, 3) + hook.slice(2) + hex((data.length - 2) / 2, 3) + data.slice(2)) as Hex;
const action = (functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi, functionName, args } as any);

/** Synthetic packed values from official encoding, NOT recovered live calldata.
 * Retained proof establishes only this eight-action shape and final minimum.
 */
export function cannacatRouteActions(body: any, recipient = user): Hex[] {
  const base = fixture.encodeQuote({ ...body, actionBasisForTest: 1_000_000n }, recipient);
  const first = decodeZeroXExecutableMinimum({ target: holder, data: base, inputAsset: routeTokens.usdg,
    outputAsset: routeTokens.canna, inputAmountAtomic: body.sellAmount, recipient, valueAtomic: "0" }).actions.slice(0, 3);
  return [...first,
    action("EKUBOV3", [settler, routeTokens.usdg, 1_000_000n, false, 1n, 17n, ekuboFill(), 0n]),
    action("BASIC", [ZERO_X_NATIVE_TOKEN, 1_000_000n, routeTokens.weth, 4n, "0xd0e30db0" + "00".repeat(32)]),
    action("BASIC", [routeTokens.weth, 1_000_000n, routeTokens.weth, 4n, "0x2e1a7d4d" + "00".repeat(32)]),
    action("UNISWAPV4", [settler, ZERO_X_NATIVE_TOKEN, 1_000_000n, false, 1n, 17n, v4Fill(), 0n]),
    action("POSITIVE_SLIPPAGE", [other, routeTokens.canna, BigInt(body.buyAmount), 1_000_000n])];
}

export function runZeroXRobinhoodRouteSmoke() {
  const body = { sellToken: routeTokens.usdg, buyToken: routeTokens.canna, sellAmount: "1000000",
    buyAmount: "31471405219129672632217", minBuyAmount: "31009640941863753285133",
    fees: { zeroExFee: { token: routeTokens.usdg, amount: "1500" } }, transaction: { to: holder } };
  const data = fixture.encodeQuote({ ...body, actionsForTest: cannacatRouteActions(body) }, user) as Hex;
  const input = { target: holder, data, inputAsset: routeTokens.usdg, outputAsset: routeTokens.canna,
    inputAmountAtomic: "1000000", recipient: user, valueAtomic: "0", runtimeHash: ZERO_X_PPM_SETTLER_RUNTIME_HASH,
    expectedOutputAtomic: body.buyAmount, providerFeeAsset: routeTokens.usdg, providerFeeAtomic: "1500" };
  assert.equal(verifyZeroXEncodedFee(input).count, 1);
  assert.equal(decodeZeroXExecutableMinimum(input).minimumAtomic, body.minBuyAmount);
  assert.equal(decodeZeroXExecutableMinimum(input).actions.length, 8);
  let negatives = 0, positives = 1;
  const mutate = (index: number, change: (args: any[]) => void) => mutateZeroXActions(data, actions => {
    const decoded = decodeFunctionData({ abi, data: actions[index] });
    const args = [...decoded.args]; change(args); actions[index] = action(decoded.functionName, args);
  });
  const rejects = (changed: Hex, label: string) => {
    assert.throws(() => verifyZeroXEncodedFee({ ...input, data: changed }), e => e instanceof ExecutionEnvelopeFailure, label); negatives++;
  };
  for (const [label, change] of feeMutations) rejects(mutateZeroXActions(data, change), label);
  for (const index of [3, 6]) {
    for (const [arg, value] of [[0, other], [1, other], [2, 0n], [2, 1_000_001n], [4, 2n ** 128n], [5, 0n], [7, 2n ** 128n]] as const) {
      rejects(mutate(index, args => { args[arg] = value; }), `route ${index} binding ${arg}`);
    }
    const original = index === 3 ? ekuboFill() : v4Fill();
    // Every possible one-byte truncation rejects, not just the empty encoding.
    for (let n = 2; n < original.length; n += 2) rejects(mutate(index, args => { args[6] = original.slice(0, n); }), `truncation ${index}/${n}`);
    for (const rate of [0, 1_000_001, 0x400000]) rejects(mutate(index, args => { args[6] = "0x" + hex(rate, 3) + original.slice(8); }), "invalid ppm");
    rejects(mutate(index, args => { args[6] = original + "00"; }), "trailing byte");
    rejects(mutate(index, args => { args[6] = "0x" + Array(17).fill(original.slice(2)).join(""); }), "fill overflow");
  }
  rejects(mutate(3, a => { a[6] = ekuboFill(routeTokens.usdg); }), "Ekubo self swap");
  rejects(mutate(3, a => { a[6] = "0x" + hex(0x800000 + 1_000_000, 3) + ekuboFill().slice(8); }), "unknown forwarding extension");
  rejects(mutate(3, a => { a[6] = ekuboFill().slice(0, -64) + other.slice(2) + "00".repeat(12); }), "unknown extension");
  rejects(mutate(3, a => { a[6] = ekuboFill().slice(0, -8) + "80000000"; }), "bad Ekubo pool config");
  rejects(mutate(6, a => { a[6] = v4Fill(routeTokens.canna, getAddress("0x0000000000000000000000000000000000000008")); }), "delta without callback");
  rejects(mutate(6, a => { a[6] = v4Fill(routeTokens.canna, user); }), "hook with no permission");
  rejects(mutate(6, a => { a[6] = v4Fill(other); }), "wrong final currency");
  rejects(mutate(6, a => { a[6] = v4Fill(ZERO_X_NATIVE_TOKEN); }), "V4 self swap");
  const fill = v4Fill();
  const tickOffset = 2 + (3 + 20 + 1 + 20 + 3) * 2;
  rejects(mutate(6, a => { a[6] = fill.slice(0, tickOffset) + "000000" + fill.slice(tickOffset + 6); }), "invalid tick spacing");
  rejects(mutate(6, a => { a[6] = v4Fill(routeTokens.canna, zeroAddress, ("0x" + "00".repeat(8193)) as Hex); }), "hook data limit");
  for (const index of [4, 5]) for (const [arg, value] of [[0, other], [1, 1n], [2, other], [3, 36n], [4, "0xdeadbeef"], [4, "0x2e1a7d4d" + hex(1, 32)]] as const) {
    rejects(mutate(index, a => { a[arg] = value; }), "wrap/unwrap binding");
  }
  rejects(mutateZeroXActions(data, a => { a.splice(4, 0, a[0]); }), "second withdrawal");
  for (const [label, change] of [["swapped routing", (a: Hex[]) => { [a[3], a[6]] = [a[6], a[3]]; }],
    ["duplicate fee", (a: Hex[]) => { a.splice(4, 0, a[1]); }]] as const) rejects(mutateZeroXActions(data, change), label);
  // Valid hook data is not a new Settler call or recipient. Delta-enabled hooks
  // and opaque data remain behind the fixed manager/debit/final-minimum checks.
  for (const hook of [zeroAddress, getAddress("0x0000000000000000000000000000000000000080"), getAddress("0x00000000000000000000000000000000000000cc")]) {
    assert.equal(verifyZeroXEncodedFee({ ...input, data: mutate(6, a => { a[6] = v4Fill(routeTokens.canna, hook, "0xabcdef"); }) }).count, 1); positives++;
  }
  const rejectPacked = (reason: string): never => { throw new Error(reason); };
  // Packed keys 0/1/2/3, including branching known-token paths, preserve order.
  const hop = v4Fill(routeTokens.weth, zeroAddress, "0x");
  const second = v4Fill(routeTokens.canna, zeroAddress, "0x");
  const keyOffset = 2 + 23 * 2;
  for (const key of [1, 2, 3]) {
    const tail = second.slice(2, keyOffset) + hex(key, 1) + (key === 3 ? ZERO_X_NATIVE_TOKEN.slice(2) : "") + second.slice(keyOffset + 2);
    const packed = decodeZeroXPackedRoute({ kind: "UNISWAPV4", token: ZERO_X_NATIVE_TOKEN, fills: (hop + tail) as Hex, hashMul: 1n, hashMod: 17n, minimum: 0n }, rejectPacked);
    assert.equal(packed.output, routeTokens.canna); positives++;
  }
  for (const kind of ["EKUBOV3", "UNISWAPV4"] as const) {
    for (const [sell, buy] of [[ZERO_X_NATIVE_TOKEN, routeTokens.usdg], [routeTokens.usdg, ZERO_X_NATIVE_TOKEN], [routeTokens.usdg, routeTokens.canna]] as const) {
      const testBody = { sellToken: sell, buyToken: buy, sellAmount: "1000000", minBuyAmount: "990100", actionBasisForTest: 1_000_000n, transaction: { to: holder } };
      const sample = { ...input, inputAsset: sell === ZERO_X_NATIVE_TOKEN ? zeroAddress : sell,
        outputAsset: buy === ZERO_X_NATIVE_TOKEN ? zeroAddress : buy, expectedOutputAtomic: "1000000",
        valueAtomic: sell === ZERO_X_NATIVE_TOKEN ? "1000000" : "0", providerFeeAsset: null, providerFeeAtomic: null,
        data: mutateZeroXActions(fixture.encodeQuote(testBody, user), a => {
          a.splice(2, a.length - 2, action(kind, [settler, sell, 1_000_000n, false, 1n, 17n,
            kind === "EKUBOV3" ? ekuboFill(buy) : v4Fill(buy), 0n]));
        }) };
      assert.equal(verifyZeroXEncodedFee(sample).count, 1); positives++;
    }
  }
  console.log(`Robinhood route grammar: ${positives} positives / ${negatives} negatives; synthetic CANNACAT 8-action envelope PASS.`);
}
