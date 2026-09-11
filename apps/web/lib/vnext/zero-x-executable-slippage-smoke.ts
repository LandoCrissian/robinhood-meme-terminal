import { TradeExecutionFailure } from "./trade-failure";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress, type Hex } from "viem";
import { decodeZeroXExecutableMinimum, ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH } from "../server/vnext-zero-x-execution-decoder";
import { RMT_ZERO_X_MAX_SLIPPAGE_PPM, RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM, ZERO_X_NATIVE_TOKEN, zeroXMinimumRespectsSlippage } from "./zero-x-settlement";

const fixture = createRequire(import.meta.url)("../../../../.github/scripts/zerox-execution-fixture.cjs");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
const output = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const target = getAddress(fixture.settler);
assert.equal(keccak256(fixture.runtime), ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH);
assert.equal(RMT_ZERO_X_MAX_SLIPPAGE_PPM, 10000);
assert.equal(RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM, 9900);
for (const [expected, reported, encoded, valid] of [
  ["2500750", "2476000", "2476000", true],
  ["1000000", "989999", "990000", true],
  ["1000000", "999000", "990000", true],
  ["1000000", "990000", "990000", true],
  ["1000000", "990000", "989999", false],
  ["1000000", "900000", "900000", false],
  ["1000000", "990000", "1", false]
] as const) {
  const data = fixture.encodeQuote({ sellToken: ZERO_X_NATIVE_TOKEN, buyToken: output,
    sellAmount: "1000000", minBuyAmount: reported, executableMinimumForTest: encoded, transaction: { to: target } }, recipient);
  const input = { target, data, inputAsset: zeroAddress, outputAsset: output,
    inputAmountAtomic: "1000000", recipient, valueAtomic: "1000000" };
  const decoded = decodeZeroXExecutableMinimum(input);
  assert.equal(decoded.minimumAtomic, encoded);
  assert.equal(zeroXMinimumRespectsSlippage(expected, decoded.minimumAtomic), valid);
  assert.throws(() => decodeZeroXExecutableMinimum({ ...input, recipient: zeroAddress }), (error: unknown) => error instanceof TradeExecutionFailure && error.code === "EXECUTION_ENVELOPE_REJECTED" && !error.retryable);
  assert.throws(() => decodeZeroXExecutableMinimum({ ...input, outputAsset: zeroAddress }), (error: unknown) => error instanceof TradeExecutionFailure && error.code === "EXECUTION_ENVELOPE_REJECTED" && !error.retryable);
  assert.throws(() => decodeZeroXExecutableMinimum({ ...input, valueAtomic: "999999" }), (error: unknown) => error instanceof TradeExecutionFailure && error.code === "EXECUTION_ENVELOPE_REJECTED" && !error.retryable);
  assert.throws(() => decodeZeroXExecutableMinimum({ ...input, data: "0x12345678" }), (error: unknown) => error instanceof TradeExecutionFailure && error.code === "EXECUTION_ENVELOPE_REJECTED" && !error.retryable);
}
const abi = parseAbi(["function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag) payable returns(bool)"]);
const early = encodeFunctionData({ abi: parseAbi(["function CHECK_SLIPPAGE(bool transferExactLimit)"]), functionName: "CHECK_SLIPPAGE", args: [false] });
const data: Hex = encodeFunctionData({ abi, functionName: "execute", args: [{ recipient, buyToken: output, minAmountOut: 990000n }, [early], `0x${"0".repeat(64)}`] });
assert.throws(() => decodeZeroXExecutableMinimum({ target, data, inputAsset: zeroAddress, outputAsset: output,
  inputAmountAtomic: "1000000", recipient, valueAtomic: "1000000" }), (error: unknown) => error instanceof TradeExecutionFailure && error.code === "EXECUTION_ENVELOPE_REJECTED" && !error.retryable);
