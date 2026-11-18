import assert from "node:assert/strict";
import { encodeAbiParameters, encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { fixtureExternalClaim, fixtureExternalFeeCall, fixtureSwapInput } from "./curve-fixture-post-graduation.js";
import { poolIdentity, type PoolKey } from "./curve-fixture-lifecycle.js";

const router = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const swapAbi = [{ type: "tuple", components: [
  { name: "poolKey", type: "tuple", components: [
    { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
  ] },
  { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" },
  { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" },
] }] as const;
const key: PoolKey = { currency0: zeroAddress, currency1: "0x1111111111111111111111111111111111111111",
  fee: 3000, tickSpacing: 60, hooks: "0x2222222222222222222222222222222222222222" };
const input = { poolKey: key, zeroForOne: false, amountIn: 100n, amountOutMinimum: 99n, minHopPriceX36: 99n * 10n ** 34n, hookData: "0x" } as const;

function encode(options: {
  allowRevert?: boolean; payerIsUser?: boolean; takeMinimum?: bigint; extraStep?: boolean; hopFloor?: bigint; poolKey?: PoolKey;
} = {}) {
  const swap = { ...input, poolKey: options.poolKey ?? key, minHopPriceX36: options.hopFloor ?? input.minHopPriceX36 };
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [zeroAddress, options.takeMinimum ?? 99n]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [key.currency1, 100n, options.payerIsUser ?? true]);
  const parameters = [encodeAbiParameters(swapAbi, [swap]), settle, take];
  const actions = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }],
    options.extraStep ? ["0x060b0f0f", [...parameters, take]] : ["0x060b0f", parameters]);
  return encodeFunctionData({ abi: router, functionName: "execute", args: [options.allowRevert ? "0x90" : "0x10", [actions], 123n] });
}

const safe = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)",
]);
const claimAbi = parseAbi(["function claimAsset(bool native)"]);
const claim = encodeFunctionData({ abi: claimAbi, functionName: "claimAsset", args: [false] });
const external = (data = claim, operation = 0, fee = 0n) => encodeFunctionData({ abi: safe, functionName: "execTransaction",
  args: [key.currency1, 0n, data, operation, 0n, 0n, fee, zeroAddress, zeroAddress, "0x"] });
export function testFixturePostGraduation() {
  assert.deepEqual(fixtureSwapInput(encode()), { buy: false, poolId: poolIdentity(key), amountIn: 100n, amountOutMinimum: 99n, deadline: 123n });
  assert.equal(fixtureSwapInput(encode({ allowRevert: true })), undefined);
  assert.equal(fixtureSwapInput(encode({ payerIsUser: false })), undefined);
  assert.equal(fixtureSwapInput(encode({ takeMinimum: 98n })), undefined);
  assert.equal(fixtureSwapInput(encode({ extraStep: true })), undefined);
  assert.equal(fixtureSwapInput(encode({ hopFloor: 1n })), undefined);
  assert.notEqual(fixtureSwapInput(encode({ poolKey: { ...key, fee: 500 } }))?.poolId, poolIdentity(key));
  assert.deepEqual(fixtureExternalClaim(external()), { ledger: key.currency1, calldata: claim });
  assert.equal(fixtureExternalClaim(external("0x")), undefined);
  assert.equal(fixtureExternalClaim(external(claim, 1)), undefined);
  assert.equal(fixtureExternalClaim(external(claim, 0, 1n)), undefined);
  const feeAbi = parseAbi(["function collectLpFees(address,uint256)", "function claimCreationFees()"]);
  for (const calldata of [encodeFunctionData({ abi: feeAbi, functionName: "collectLpFees", args: [key.currency1, 123n] }),
    encodeFunctionData({ abi: feeAbi, functionName: "claimCreationFees" })]) {
    assert.equal(fixtureExternalFeeCall(external(calldata))?.calldata, calldata);
    assert.equal(fixtureExternalFeeCall(external(calldata, 1)), undefined);
    assert.equal(fixtureExternalFeeCall(external(calldata, 0, 1n)), undefined);
    assert.equal(fixtureExternalFeeCall(external((calldata + "00") as `0x${string}`)), undefined);
  }
  assert.equal(fixtureExternalFeeCall(external(claim)), undefined, "The extension admits only the two permissionless fee methods");
}
