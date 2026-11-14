import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters, decodeFunctionData, parseAbi, parseAbiItem } from "viem";
import { encodeLifecycleCalldata, isLifecycleSlippage, isTestLifecycleRequest, lifecycleCalldataMatches, type TestLifecycleRequest } from "../test-lifecycle";
import { testPermit2Lifetime, testV4PermitSignature, testV4Pins, testV4PoolId, testV4RouterSignature, type TestV4Binding } from "../test-v4";

const token = "0x1000000000000000000000000000000000000000";
const curve = "0x2000000000000000000000000000000000000000";
const factory = "0x3000000000000000000000000000000000000000";
const from = "0x4000000000000000000000000000000000000000";
const engine = "0x5000000000000000000000000000000000000000";
const ledger = "0x6000000000000000000000000000000000000000";
const poolKey = { currency0: "0x0000000000000000000000000000000000000000", currency1: token,
  fee: 3000, tickSpacing: 60, hooks: "0x7000000000000000000000000000000000002000" } as const;
const blockHash = `0x${"1".repeat(64)}` as const;
const reviewBlockHash = `0x${"2".repeat(64)}` as const;

async function binding(): Promise<TestV4Binding> {
  return { poolKey, poolId: await testV4PoolId(poolKey), ledger, engine };
}

test("v4 quote calldata uses exact single-hop amount, minimum, deadline and guarded PoolKey", async () => {
  const v4 = await binding();
  const deadline = 1000n;
  const amount = 200n;
  const minimum = 400n;
  const data = await encodeLifecycleCalldata("v4-buy", token, curve, amount, minimum, deadline, v4);
  const request = { operation: "v4-buy", token, curve, factory, from, to: testV4Pins.router.address, data, value: "0xc8", chainId: "0x7a69",
    nonce: "0x1", blockNumber: "0x2", blockHash, reviewBlockNumber: "0x3", reviewBlockHash, deadline: "1000",
    amountWei: "200", minimumOutputWei: "400", slippageBps: 100, v4 } as const satisfies TestLifecycleRequest;
  assert.equal(isTestLifecycleRequest(request), true);
  assert.equal(await lifecycleCalldataMatches(request), true);
  assert.equal(isTestLifecycleRequest({ ...request, to: v4.ledger }), false);
  assert.equal(await lifecycleCalldataMatches({ ...request, v4: { ...v4, poolId: blockHash } }), false);
  assert.equal(await lifecycleCalldataMatches({ ...request, v4: { ...v4, poolKey: { ...poolKey, fee: 500 } } }), false);
  assert.ok(!isLifecycleSlippage("v4-buy", 9) && !isLifecycleSlippage("v4-sell", 501));

  const { args: [command, inputs, expiry] } = decodeFunctionData({ abi: parseAbi([testV4RouterSignature]), data });
  assert.equal(command, "0x10");
  assert.equal(expiry, deadline);
  assert.equal(inputs.length, 1);
  const [actions, [swap, settle, take]] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
  assert.equal(actions, "0x060b0f");
  const swapType = parseAbiItem("function single(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) args)").inputs[0];
  const [swapValues] = decodeAbiParameters([swapType], swap);
  assert.deepEqual(swapValues, { poolKey, zeroForOne: true, amountIn: amount, amountOutMinimum: minimum,
    minHopPriceX36: 2n * 10n ** 36n, hookData: "0x" });
  assert.deepEqual(decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], settle), [poolKey.currency0, amount, true]);
  assert.deepEqual(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], take), [poolKey.currency1, minimum]);
});

test("Permit2 approval is exact and the claim encodes no destination override", async () => {
  const v4 = await binding();
  const expiry = 1000n;
  const data = await encodeLifecycleCalldata("v4-permit2-approve", token, curve, 42n, 0n, expiry, v4);
  const { args } = decodeFunctionData({ abi: parseAbi([testV4PermitSignature]), data });
  assert.equal(args[0], token);
  assert.equal(args[1].toLowerCase(), testV4Pins.router.address);
  assert.equal(args[2], 42n);
  assert.equal(args[3], Number(expiry + testPermit2Lifetime));

  const claim = await encodeLifecycleCalldata("lp-claim", token, curve, 0n, 0n, expiry, v4);
  assert.match(claim, /^0x[0-9a-f]{8}$/);
  assert.equal(isTestLifecycleRequest({ operation: "lp-claim", token, curve, factory, from, to: ledger, data: claim,
    value: "0x0", chainId: "0x7a69", nonce: "0x1", blockNumber: "0x2", blockHash, reviewBlockNumber: "0x3", reviewBlockHash,
    deadline: expiry.toString(), amountWei: "0", minimumOutputWei: "0", slippageBps: 0, v4 }), true);
});
