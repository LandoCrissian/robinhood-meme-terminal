import assert from "node:assert/strict";
import { encodeAbiParameters, encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { fixtureSwapInput } from "./curve-fixture-post-graduation.js";
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

export function testFixturePostGraduation() {
  assert.deepEqual(fixtureSwapInput(encode()), { buy: false, poolId: poolIdentity(key), amountIn: 100n, amountOutMinimum: 99n, deadline: 123n });
  assert.equal(fixtureSwapInput(encode({ allowRevert: true })), undefined);
  assert.equal(fixtureSwapInput(encode({ payerIsUser: false })), undefined);
  assert.equal(fixtureSwapInput(encode({ takeMinimum: 98n })), undefined);
  assert.equal(fixtureSwapInput(encode({ extraStep: true })), undefined);
  assert.equal(fixtureSwapInput(encode({ hopFloor: 1n })), undefined);
  assert.notEqual(fixtureSwapInput(encode({ poolKey: { ...key, fee: 500 } }))?.poolId, poolIdentity(key));
}
