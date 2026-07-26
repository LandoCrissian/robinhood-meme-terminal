import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  type Hex
} from "viem";
import { decodeMarketLog, type RawMarketLog } from "./decoder.js";
import { marketSources, type MarketSource } from "./sources.js";

const token0 = getAddress("0x0000000000000000000000000000000000000001");
const token1 = getAddress("0x0000000000000000000000000000000000000002");
const pool = getAddress("0x0000000000000000000000000000000000000003");
const hooks = getAddress("0x0000000000000000000000000000000000000004");
const blockHash = keccak256(stringToHex("block"));
const transactionHash = keccak256(stringToHex("transaction"));

function source(id: string) {
  const value = marketSources.find((candidate) => candidate.id === id);
  assert(value);
  return value;
}

function raw(
  marketSource: MarketSource,
  topics: readonly Hex[],
  data: Hex,
  overrides: Partial<RawMarketLog> = {}
): RawMarketLog {
  return {
    address: marketSource.contract,
    topics,
    data,
    blockNumber: marketSource.startBlock,
    blockHash,
    transactionHash,
    transactionIndex: 1,
    logIndex: 2,
    ...overrides
  };
}

function concreteTopics(value: readonly unknown[]): readonly Hex[] {
  if (value.some((topic) => typeof topic !== "string")) {
    throw new Error("test event topics must be concrete");
  }
  return value as readonly Hex[];
}

const v2 = source("sushiswap-v2");
const v2Log = raw(
  v2,
  concreteTopics(encodeEventTopics({
    abi: [v2.event],
    eventName: "PairCreated",
    args: { token0, token1 }
  })),
  encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [pool, 1n]
  )
);
const decodedV2 = decodeMarketLog(v2, v2Log);
assert.equal(decodedV2?.poolAddress, pool.toLowerCase());
assert.equal(decodedV2?.fee, null);

const v3 = source("uniswap-v3");
const v3Log = raw(
  v3,
  concreteTopics(encodeEventTopics({
    abi: [v3.event],
    eventName: "PoolCreated",
    args: { token0, token1, fee: 3_000 }
  })),
  encodeAbiParameters(
    [{ type: "int24" }, { type: "address" }],
    [60, pool]
  )
);
const decodedV3 = decodeMarketLog(v3, v3Log);
assert.equal(decodedV3?.fee, 3_000);
assert.equal(decodedV3?.tickSpacing, 60);

const v4 = source("uniswap-v4");
const poolId = keccak256(stringToHex("pool-id"));
const v4Log = raw(
  v4,
  concreteTopics(encodeEventTopics({
    abi: [v4.event],
    eventName: "Initialize",
    args: { id: poolId, currency0: zeroAddress, currency1: token1 }
  })),
  encodeAbiParameters(
    [
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
      { type: "uint160" },
      { type: "int24" }
    ],
    [10_000, 200, hooks, 2n ** 96n, 0]
  )
);
const decodedV4 = decodeMarketLog(v4, v4Log);
assert.equal(decodedV4?.poolKey, poolId);
assert.equal(decodedV4?.poolAddress, null);
assert.equal(decodedV4?.hooks, hooks.toLowerCase());

assert.throws(
  () => decodeMarketLog(v3, { ...v3Log, data: "0x12" }),
  /malformed uniswap-v3/
);
assert.throws(
  () => decodeMarketLog(v3, { ...v3Log, removed: true }),
  /removed logs/
);
assert.throws(
  () =>
    decodeMarketLog(v3, {
      ...v3Log,
      address: getAddress("0x0000000000000000000000000000000000000009")
    }),
  /does not match/
);
assert.throws(
  () =>
    decodeMarketLog(
      v3,
      raw(
        v3,
        concreteTopics(encodeEventTopics({
          abi: [v3.event],
          eventName: "PoolCreated",
          args: { token0: token1, token1: token0, fee: 3_000 }
        })),
        v3Log.data
      )
    ),
  /canonically ordered/
);

console.info("market event decoder smoke passed");
