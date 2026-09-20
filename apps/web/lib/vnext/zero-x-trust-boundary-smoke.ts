import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { decodeZeroXExecutableMinimum, inspectZeroXRoute, verifyZeroXEncodedFee, ZERO_X_PPM_SETTLER_RUNTIME_HASH } from "../server/vnext-zero-x-execution-decoder";
import { ExecutionEnvelopeFailure } from "./trade-failure";
import { feeMutations, mutateZeroXActions } from "./zero-x-provider-native-fee-smoke";
import { ZERO_X_NATIVE_TOKEN } from "./zero-x-settlement";

const fixture = createRequire(import.meta.url)("../../../../.github/scripts/zerox-execution-fixture.cjs");
const holder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const user = getAddress("0x0000000000000000000000000000000000010000");
const other = getAddress("0x0000000000000000000000000000000000023456");
const usdg = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const canna = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92");
const settler = getAddress(fixture.settler);
const inner = parseAbi(["function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag) payable returns(bool)"]);
const basic = parseAbi(["function BASIC(address sellToken,uint256 proportion,address pool,uint256 offset,bytes data)"]);
const pancake = parseAbi(["function PANCAKE_INFINITY(address recipient,address sellToken,uint256 proportion,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 amountOutMin)"]);
const v2 = parseAbi(["function UNISWAPV2(address recipient,address sellToken,uint256 proportion,address pool,uint24 swapInfo,uint256 amountOutMin)"]);

export type InternalRouteKind = "PANCAKE_HOOK" | "UNKNOWN_TO_RMT_V2" | "OPAQUE_BASIC";
/** Source-derived synthetic actions, not a reconstruction of missing production
 * packed bytes and not a live liquidity/simulation proof. UNISWAPV2 exists in
 * the pinned runtime but deliberately has no RMT semantic route parser.
 */
export function internalRouteActions(body: { sellToken: Address; buyToken: Address; [key: string]: unknown }, recipient: Address, kind: InternalRouteKind): Hex[] {
  const calldata = fixture.encodeQuote({ ...body, actionBasisForTest: 1_000_000n }, recipient) as Hex;
  let actions: Hex[] = [], outputFee: Hex[] = [];
  const providerToken = (body.fees as { zeroExFee?: { token?: string } } | undefined)?.zeroExFee?.token;
  mutateZeroXActions(calldata, current => {
    actions = current.slice(0, providerToken?.toLowerCase() === body.sellToken.toLowerCase() ? 3 : 2);
    if (providerToken?.toLowerCase() === body.buyToken.toLowerCase()) outputFee = current.slice(-1);
  });
  if (kind === "PANCAKE_HOOK") {
    // Current ppm encoding: sell proportion, reserved address, key, buy token,
    // hook, manager id, fee, parameters, hook-data length and data.
    const fills = ("0x0f4240" + "00".repeat(20) + "01" + body.buyToken.slice(2)
      + other.slice(2) + "00" + "000bb8" + "00".repeat(32) + "000003abcdef") as Hex;
    actions.push(encodeFunctionData({ abi: pancake, functionName: "PANCAKE_INFINITY",
      args: [settler, body.sellToken, 1_000_000n, false, 1n, 17n, fills, 0n] }));
  } else if (kind === "UNKNOWN_TO_RMT_V2") {
    actions.push(encodeFunctionData({ abi: v2, functionName: "UNISWAPV2",
      args: [settler, body.sellToken, 1_000_000n, other, 0, 0n] }));
  } else {
    actions.push(encodeFunctionData({ abi: basic, functionName: "BASIC",
      args: [body.sellToken, 1_000_000n, other, 4n, ("0x12345678" + "00".repeat(32)) as Hex] }));
  }
  return [...actions, ...outputFee];
}

export function runZeroXTrustBoundarySmoke() {
  let positives = 0, negatives = 0;
  for (const [sell, buy] of [[zeroAddress, usdg], [usdg, zeroAddress], [usdg, canna]] as const) {
    for (const kind of ["PANCAKE_HOOK", "UNKNOWN_TO_RMT_V2", "OPAQUE_BASIC"] as const) {
      const body = { sellToken: sell === zeroAddress ? ZERO_X_NATIVE_TOKEN : sell,
        buyToken: buy === zeroAddress ? ZERO_X_NATIVE_TOKEN : buy, sellAmount: "1000000", minBuyAmount: "990100",
        actionBasisForTest: 1_000_000n, transaction: { to: holder } };
      const data = fixture.encodeQuote({ ...body, actionsForTest: internalRouteActions(body, user, kind) }, user) as Hex;
      const input = { target: holder, data, inputAsset: sell, outputAsset: buy, inputAmountAtomic: "1000000",
        recipient: user, valueAtomic: sell === zeroAddress ? "1000000" : "0", runtimeHash: ZERO_X_PPM_SETTLER_RUNTIME_HASH,
        expectedOutputAtomic: "1000000", providerFeeAsset: null, providerFeeAtomic: null };
      assert.equal(verifyZeroXEncodedFee(input).count, 1);
      assert.equal(decodeZeroXExecutableMinimum(input).minimumAtomic, "990100");
      const inspection = inspectZeroXRoute(input);
      assert.equal(inspection.status, "ROUTE_INTROSPECTION_PARTIAL");
      assert.equal(inspection.diagnostic?.envelopeReason, kind === "PANCAKE_HOOK" ? "UNSUPPORTED_HOOK" : kind === "OPAQUE_BASIC" ? "UNSUPPORTED_ROUTE" : "UNSUPPORTED_ACTION");
      assert.equal(inspection.diagnostic?.actionIndex, 2); positives++;
      for (const [label, change] of feeMutations) {
        assert.throws(() => verifyZeroXEncodedFee({ ...input, data: mutateZeroXActions(data, change) }), ExecutionEnvelopeFailure, label); negatives++;
      }
      for (const patch of [{ recipient: other }, { inputAsset: other }, { outputAsset: other },
        { inputAmountAtomic: "1000001" }, { valueAtomic: "1" }, { target: other }, { runtimeHash: "0x" + "00".repeat(32) }]) {
        assert.throws(() => verifyZeroXEncodedFee({ ...input, ...patch })); negatives++;
      }
      // Unknown routing cannot hide another input action or consume/zero the
      // outer final check. These stay mandatory regardless of introspection.
      for (const change of [
        (a: Hex[]) => { a.push(a[0]); },
        (a: Hex[]) => { a.push(encodeFunctionData({ abi: parseAbi(["function CHECK_SLIPPAGE(bool exact)"]), functionName: "CHECK_SLIPPAGE", args: [false] })); },
        (a: Hex[]) => { const check = encodeFunctionData({ abi: parseAbi(["function CHECK_SLIPPAGE(bool exact)"]), functionName: "CHECK_SLIPPAGE", args: [true] }); a.push(("0x" + check.slice(2).toUpperCase()) as Hex); },
        (a: Hex[]) => { a.push(encodeFunctionData({ abi: basic, functionName: "BASIC", args: [body.sellToken, 1_000_000n, holder, 4n, "0x12345678"] })); }
      ]) {
        assert.throws(() => verifyZeroXEncodedFee({ ...input, data: mutateZeroXActions(data, change) }), ExecutionEnvelopeFailure); negatives++;
      }
      // Assert that the final tuple, not a quote-JSON number or route-local
      // minimum, remains authority even for a parser-unknown route.
      mutateZeroXActions(data, a => { assert.equal(a.length, 3); });
      const outer = parseAbi(["function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)"]);
      const envelope = decodeFunctionData({ abi: outer, data });
      const tupleMinimum = decodeFunctionData({ abi: inner, data: envelope.args[4] }).args[0].minAmountOut;
      assert.equal(tupleMinimum, 990100n);
    }
  }
  console.log(`Trust boundary: ${positives} route/direction positives, ${negatives} hard-invariant negatives; UNIT only.`);
}
