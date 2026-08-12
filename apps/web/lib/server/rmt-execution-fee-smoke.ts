import assert from "node:assert/strict";
import { calculateRmtExecutionFee, parseRmtExecutionFeeConfig } from "./rmt-execution-fee";

const treasury = "0x2222222222222222222222222222222222222222";

assert.deepEqual(parseRmtExecutionFeeConfig({}), {
  enabled: false,
  feeBps: null,
  treasury: null
});
assert.deepEqual(parseRmtExecutionFeeConfig({ feeBps: "25", treasury }), {
  enabled: false,
  feeBps: null,
  treasury: null
});
assert.deepEqual(parseRmtExecutionFeeConfig({ enabled: "true", feeBps: "25", treasury }), {
  enabled: true,
  feeBps: 25,
  treasury
});
assert.deepEqual(calculateRmtExecutionFee(1_000_000n, 25), {
  grossOutput: 1_000_000n,
  fee: 2_500n,
  netOutput: 997_500n
});
assert.throws(() => parseRmtExecutionFeeConfig({ enabled: "true", feeBps: "25" }), /treasury address/);
assert.throws(() => parseRmtExecutionFeeConfig({ enabled: "true", treasury }), /explicitly approved basis-point value/);
assert.throws(() => parseRmtExecutionFeeConfig({ enabled: "true", feeBps: "0", treasury }), /zero basis points/);
assert.throws(() => parseRmtExecutionFeeConfig({ enabled: "true", feeBps: "101", treasury }), /between 0 and 100/);
assert.throws(() => parseRmtExecutionFeeConfig({ enabled: "true", feeBps: "25", treasury: "0x0000000000000000000000000000000000000000" }), /zero address/);
assert.throws(() => parseRmtExecutionFeeConfig({ enabled: "true", feeBps: "25", treasury: "0x0000000000000000000000000000000000000001" }), /sentinel address/);
assert.throws(() => parseRmtExecutionFeeConfig({ enabled: "true", feeBps: "25", treasury: "0x0000000000000000000000000000000000000002" }), /sentinel address/);

console.log("RMT execution-fee configuration is server-only, bounded, and fail-closed.");
