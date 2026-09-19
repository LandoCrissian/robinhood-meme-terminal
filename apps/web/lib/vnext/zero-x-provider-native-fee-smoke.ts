import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress, type Hex } from "viem";
import { verifyZeroXEncodedFee, ZERO_X_PPM_SETTLER_RUNTIME_HASH } from "../server/vnext-zero-x-execution-decoder";
import { requireZeroXDeployment } from "../server/vnext-zero-x-deployment-authority";
import { TradeExecutionFailure } from "./trade-failure";
import { RMT_ZERO_X_FEE_TREASURY, ZERO_X_NATIVE_TOKEN } from "./zero-x-settlement";
const require = createRequire(import.meta.url);
const fixture = require("../../../../.github/scripts/zerox-execution-fixture.cjs");
export const ppmRuntime = require("../../../../.github/scripts/fixtures/zerox-ppm-settler-runtime.json").runtime as Hex;
const holder = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
const usdg = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const weth = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const other = getAddress("0x0000000000000000000000000000000000023456");
const outer = parseAbi(["function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)"]);
const inner = parseAbi(["function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag) payable returns(bool)"]);
const basic = parseAbi(["function BASIC(address token,uint256 proportion,address pool,uint256 offset,bytes data)"]);
const transfer = parseAbi(["function transfer(address recipient,uint256 amount) returns(bool)"]);

export function mutateZeroXActions(data: Hex, mutate: (actions: Hex[]) => void): Hex {
  const holderCall = data.startsWith("0x2213bc0b") ? decodeFunctionData({ abi: outer, data }) : null;
  const decoded = decodeFunctionData({ abi: inner, data: holderCall ? holderCall.args[4] : data });
  const actions = [...decoded.args[1]]; mutate(actions);
  const nested = encodeFunctionData({ abi: inner, functionName: "execute", args: [decoded.args[0], actions, decoded.args[2]] });
  return holderCall ? encodeFunctionData({ abi: outer, functionName: "exec", args: [...holderCall.args.slice(0, 4), nested] as any }) : nested;
}
function changeFee(actions: Hex[], change: (args: any[]) => void) {
  const args = [...decodeFunctionData({ abi: basic, data: actions[1] }).args]; change(args);
  actions[1] = encodeFunctionData({ abi: basic, functionName: "BASIC", args: args as any });
}
function changeRecipient(args: any[], destination: string) {
  if (args[4] === "0x") args[2] = destination;
  else args[4] = encodeFunctionData({ abi: transfer, functionName: "transfer", args: [getAddress(destination), 0n] });
}
export const feeMutations: [string, (actions: Hex[]) => void][] = [
  ["wrong treasury", a => changeFee(a, x => changeRecipient(x, other))],
  ["zero treasury", a => changeFee(a, x => changeRecipient(x, zeroAddress))],
  ["wrong token/native-WETH confusion", a => changeFee(a, x => { x[0] = weth; })],
  ["wrong native representation", a => changeFee(a, x => { x[0] = zeroAddress; })],
  ["zero rate", a => changeFee(a, x => { x[1] = 0n; })],
  ["low rate", a => changeFee(a, x => { x[1] -= 1n; })],
  ["high rate", a => changeFee(a, x => { x[1] += 1n; })],
  ["wrong call target", a => changeFee(a, x => { x[2] = other; })],
  ["malformed fee", a => { a[1] = "0x38c9c147"; }],
  ["missing fee", a => { a.splice(1, 1); }],
  ["duplicate fee", a => { a.splice(2, 0, a[1]); }],
  ["split fee", a => { changeFee(a, x => { x[1] /= 2n; }); a.splice(2, 0, a[1]); }],
  ["noncanonical fee bytes", a => { a[1] = `${a[1]}00`; }],
  ["extra treasury transfer", a => { a.push(a[1]); }],
  ["competing integrator", a => { const copy = [...a]; changeFee(copy, x => changeRecipient(x, other)); a.splice(2, 0, copy[1]); }],
  ["unsafe ordering", a => { [a[0], a[1]] = [a[1], a[0]]; }],
  ["unknown action", a => { a.push("0xdeadbeef"); }],
  ["early slippage", a => { a.splice(2, 0, encodeFunctionData({ abi: parseAbi(["function CHECK_SLIPPAGE(bool exact)"]), functionName: "CHECK_SLIPPAGE", args: [false] })); }],
  ["wrong amount patch", a => changeFee(a, x => { x[3] = 4n; })]
];
export async function runZeroXProviderNativeFeeSmoke() {
  let positives = 0, negatives = 0;
  assert.equal(keccak256(ppmRuntime), ZERO_X_PPM_SETTLER_RUNTIME_HASH);
  for (const [runtime, basis] of [[fixture.runtime, 10_000n], [ppmRuntime, 1_000_000n]] as const) {
    for (const [sell, buy] of [[zeroAddress, usdg], [usdg, zeroAddress], [usdg, weth]] as const) {
      const body = { sellToken: sell === zeroAddress ? ZERO_X_NATIVE_TOKEN : sell, buyToken: buy === zeroAddress ? ZERO_X_NATIVE_TOKEN : buy,
        sellAmount: "5000200", minBuyAmount: "990000", actionBasisForTest: basis, transaction: { to: holder } };
      const input = { target: holder, data: fixture.encodeQuote(body, recipient) as Hex, inputAsset: sell, outputAsset: buy,
        inputAmountAtomic: body.sellAmount, recipient, valueAtomic: sell === zeroAddress ? body.sellAmount : "0",
        runtimeHash: keccak256(runtime), expectedOutputAtomic: "1000000", providerFeeAsset: null, providerFeeAtomic: null };
      const fee = verifyZeroXEncodedFee(input);
      assert.equal(fee.rateBps, 25); assert.equal(fee.token, sell); assert.equal(fee.recipient, RMT_ZERO_X_FEE_TREASURY); positives++;
      // Accepted arithmetic model, not funded settlement: fixed user input plus donation.
      const gross = BigInt(input.inputAmountAtomic);
      const withoutDonation = gross * BigInt(fee.numerator) / BigInt(fee.denominator);
      const withDonation = (gross + 400n) * BigInt(fee.numerator) / BigInt(fee.denominator);
      assert.equal(withDonation - withoutDonation, 1n); assert.equal(withoutDonation, 12500n);
      assert.equal(decodeFunctionData({ abi: outer, data: input.data }).args[2], gross);
      assert.equal(BigInt(input.valueAtomic), sell === zeroAddress ? gross : 0n);
      for (const feeAsset of [sell, buy]) {
        const feeToken = feeAsset === zeroAddress ? ZERO_X_NATIVE_TOKEN : feeAsset;
        const bodyWithFee = { ...body, fees: { zeroExFee: { token: feeToken, amount: feeAsset === sell ? "7500" : "1500" } } };
        const withProvider = { ...input, data: fixture.encodeQuote(bodyWithFee, recipient), providerFeeAsset: feeAsset,
          providerFeeAtomic: bodyWithFee.fees.zeroExFee.amount };
        assert.equal(verifyZeroXEncodedFee(withProvider).recipient, RMT_ZERO_X_FEE_TREASURY); positives++;
        const surplusAbi = parseAbi(["function POSITIVE_SLIPPAGE(address recipient,address token,uint256 expected,uint256 cap)"]);
        const surplusData = encodeFunctionData({ abi: surplusAbi, functionName: "POSITIVE_SLIPPAGE",
          args: [other, body.buyToken, 1_000_000n, basis] });
        const withSurplus = mutateZeroXActions(withProvider.data, a => { a.splice(a.length - (feeAsset === buy ? 1 : 0), 0, surplusData); });
        assert.equal(verifyZeroXEncodedFee({ ...withProvider, data: withSurplus }).count, 1); positives++;
        assert.throws(() => verifyZeroXEncodedFee({ ...withProvider, providerFeeAsset: null, providerFeeAtomic: null })); negatives++;
        assert.throws(() => verifyZeroXEncodedFee({ ...withProvider, data: mutateZeroXActions(withProvider.data, a => {
          const providerIndex = feeAsset === sell ? 2 : a.length - 1;
          const x = [...decodeFunctionData({ abi: basic, data: a[providerIndex] }).args];
          changeRecipient(x, RMT_ZERO_X_FEE_TREASURY);
          a[providerIndex] = encodeFunctionData({ abi: basic, functionName: "BASIC", args: x as any });
        }) })); negatives++;
      }
      if (basis === 1_000_000n && sell !== zeroAddress) {
        const pancakeAbi = parseAbi(["function PANCAKE_INFINITY(address recipient,address sellToken,uint256 proportion,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 amountOutMin)"]);
        const fills = ("0x0f4240" + "0".repeat(40) + "01" + weth.slice(2) + "0".repeat(40) + "00" + "000bb8" + "0".repeat(64) + "000000") as Hex;
        const pancake = (hooks: boolean) => encodeFunctionData({ abi: pancakeAbi, functionName: "PANCAKE_INFINITY",
          args: [getAddress(fixture.settler), sell, basis, false, 1n, 8n,
            hooks ? (fills.slice(0, 90) + other.slice(2) + fills.slice(130)) as Hex : fills, 0n] });
        const pancakeData = mutateZeroXActions(input.data, a => { a[2] = pancake(false); });
        assert.equal(verifyZeroXEncodedFee({ ...input, data: pancakeData }).count, 1); positives++;
        assert.throws(() => verifyZeroXEncodedFee({ ...input, data: mutateZeroXActions(input.data, a => { a[2] = pancake(true); }) })); negatives++;
      }
      for (const [label, mutate] of feeMutations) {
        assert.throws(() => verifyZeroXEncodedFee({ ...input, data: mutateZeroXActions(input.data, mutate) }),
          error => error instanceof TradeExecutionFailure && error.code === "EXECUTION_ENVELOPE_REJECTED", label); negatives++;
      }
      for (const patch of [{ runtimeHash: keccak256("0x6000") }, { recipient: other }, { outputAsset: other }, { target: other }, { valueAtomic: "1" }]) {
        assert.throws(() => verifyZeroXEncodedFee({ ...input, ...patch })); negatives++;
      }
    }
    for (const mode of ["current", "previous", "paused", "unregistered", "wrong-chain", "wrong-runtime"] as const) {
      let registryReads = 0;
      const rpc = async (method: string, params: unknown[]) => {
        if (method === "eth_chainId") return mode === "wrong-chain" ? "0x1" : "0x1237";
        if (method === "eth_blockNumber") return "0x1234";
        assert.equal(params[1], "0x1234");
        if (method === "eth_getCode") return mode === "wrong-runtime" ? "0x6000" : runtime;
        const previous = ++registryReads > 1;
        if (mode === "paused") throw new Error("registry paused");
        const address = mode === "unregistered" || (mode === "previous" && !previous) ? other : fixture.settler;
        return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
      };
      if (mode === "current" || mode === "previous") await requireZeroXDeployment(getAddress(fixture.settler), rpc);
      else await assert.rejects(() => requireZeroXDeployment(getAddress(fixture.settler), rpc));
      if (mode === "paused") assert.equal(registryReads, 1);
    }
  }
  console.log(`Provider-native fee decoder: ${positives} positive, ${negatives} negative; both explicit runtimes/registry gates PASS (mocked).`);
}
