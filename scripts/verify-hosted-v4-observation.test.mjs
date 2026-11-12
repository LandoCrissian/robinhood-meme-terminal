import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { verifyHostedV4Observation } from "./verify-hosted-v4-observation.mjs";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiItem, zeroAddress } = requireWeb("viem");
const keyType = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const keyTuple = parseAbiItem(`function key(${keyType} poolKey)`).inputs[0];
const swapTuple = parseAbiItem(`function params((${keyType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap)`).inputs[0];
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const time = Date.parse("2026-11-12T16:00:00Z");
const observedAt = new Date(time).toISOString();
const poolKey = {
  currency0: zeroAddress, currency1: "0x0000000000000000000000000000000000000001",
  fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000002000",
};
const expected = {
  chainId: 84532, poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
  poolId: keccak256(encodeAbiParameters([keyTuple], [poolKey])), poolKey,
};
const types = (values) => values.map((type) => ({ type }));
const poolInfo = { observedAt, response: { pools: [{
  poolReferenceIdentifier: expected.poolId, poolProtocol: "V4", chainId: expected.chainId,
  tokenAddressA: poolKey.currency0, tokenAddressB: poolKey.currency1,
  tickSpacing: 60, fee: "3000", hookAddress: poolKey.hooks,
}] } };

function quote(buy, { key = poolKey, hopPrice = 1n, actions = "0x060b0f", chainId = expected.chainId } = {}) {
  const input = buy ? key.currency0 : key.currency1;
  const output = buy ? key.currency1 : key.currency0;
  const parameters = [
    encodeAbiParameters([swapTuple], [{ poolKey: key, zeroForOne: buy, amountIn: 100n,
      amountOutMinimum: 90n, minHopPriceX36: hopPrice, hookData: "0x" }]),
    encodeAbiParameters(types(["address", "uint256", "bool"]), [input, 100n, true]),
    encodeAbiParameters(types(["address", "uint256"]), [output, 90n]),
  ];
  const data = encodeFunctionData({ abi: routerAbi, functionName: "execute", args: ["0x10",
    [encodeAbiParameters(types(["bytes", "bytes[]"]), [actions, parameters])], BigInt(time / 1000 + 180)] });
  return { observedAt, response: { routing: "CLASSIC", swapTransaction: {
    chainId, to: "0x8702463e73f74d0b6765aBceb314Ef07aCb92650", value: buy ? "100" : "0", data,
  } } };
}

test("validates both exact guarded quote directions and hosted pool payload separately", () => {
  const result = verifyHostedV4Observation({ expected, buy: quote(true), sell: quote(false), poolInfo }, time);
  assert.equal(result.buy.status, "payload_matches");
  assert.equal(result.sell.status, "payload_matches");
  assert.equal(result.uniswapPoolData.status, "payload_matches");
  assert.equal(result.independentHostedIndexing.status, "unknown");
  assert.equal(result.provenance, "offline_payload_validation_only");
});

test("leaves stale, cross-chain, unprotected or different pool captures unknown", () => {
  const bad = [
    quote(false), quote(true, { chainId: 31337 }), quote(true, { hopPrice: 0n }),
    quote(true, { key: { ...poolKey, hooks: zeroAddress } }), quote(true, { actions: "0x06060f" }),
    { ...quote(true), observedAt: "2026-11-12T15:49:00Z" },
  ];
  for (const buy of bad) assert.equal(verifyHostedV4Observation({ expected, buy }, time).buy.status, "unknown");
  const otherPool = { ...poolInfo.response.pools[0], hookAddress: zeroAddress };
  assert.equal(verifyHostedV4Observation({ expected, poolInfo: { observedAt, response: { pools: [otherPool] } } }, time)
    .uniswapPoolData.status, "unknown");
  assert.throws(() => verifyHostedV4Observation({ expected: { ...expected, chainId: 31337 } }, time), /exact guarded Base Sepolia pool/);
});
