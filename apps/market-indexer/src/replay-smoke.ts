import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  stringToHex
} from "viem";
import type { RawMarketLog } from "./decoder.js";
import { findReorgAncestor, replayMarketLogs } from "./replay.js";
import { marketSources } from "./sources.js";

const source = marketSources.find((candidate) => candidate.id === "uniswap-v3")!;
const token0 = getAddress("0x0000000000000000000000000000000000000001");
const token1 = getAddress("0x0000000000000000000000000000000000000002");
const pool = getAddress("0x0000000000000000000000000000000000000003");
const encodedTopics = encodeEventTopics({
  abi: [source.event],
  eventName: "PoolCreated",
  args: { token0, token1, fee: 3_000 }
});
if (encodedTopics.some((topic) => typeof topic !== "string")) {
  throw new Error("test event topics must be concrete");
}
const topics = encodedTopics as readonly `0x${string}`[];
const data = encodeAbiParameters(
  [{ type: "int24" }, { type: "address" }],
  [60, pool]
);
const log: RawMarketLog = {
  address: source.contract,
  topics,
  data,
  blockNumber: source.startBlock + 10n,
  blockHash: keccak256(stringToHex("block-10")),
  transactionHash: keccak256(stringToHex("tx-10")),
  transactionIndex: 2,
  logIndex: 3
};

const replayed = replayMarketLogs(source, [log, log]);
assert.equal(replayed.length, 1, "exact duplicate must be idempotent");

assert.throws(
  () =>
    replayMarketLogs(source, [
      log,
      { ...log, blockHash: keccak256(stringToHex("conflict")) }
    ]),
  /conflicting duplicate/
);

const points = [
  { blockNumber: 12n, blockHash: keccak256(stringToHex("orphan-12")) },
  { blockNumber: 11n, blockHash: keccak256(stringToHex("canonical-11")) },
  { blockNumber: 10n, blockHash: keccak256(stringToHex("canonical-10")) }
];
const ancestor = await findReorgAncestor(points, async (blockNumber) =>
  blockNumber === 11n
    ? keccak256(stringToHex("canonical-11"))
    : keccak256(stringToHex(`other-${blockNumber}`))
);
assert.equal(ancestor, 11n);

await assert.rejects(
  findReorgAncestor(points, async () => keccak256(stringToHex("unknown"))),
  /exceeds retained checkpoint history/
);

console.info("market replay and reorg smoke passed");
