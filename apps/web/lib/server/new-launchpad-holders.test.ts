import assert from "node:assert/strict";
import { test } from "node:test";
import { toHex, zeroAddress, type Address, type PublicClient } from "viem";
import type { NewLaunchRecord } from "../launchpad/launch-record";
import { readLaunchHolderTrend } from "./new-launchpad-holders";

const address = (value: number) => toHex(value, { size: 20 });
const hash = (value: number) => toHex(value, { size: 32 });
const opening = { number: 12n, hash: hash(12), timestamp: 100n };
const head = { number: 16n, hash: hash(16), timestamp: 108n };
const launch = {
  token: address(1), factory: address(2), transactionHash: hash(42), blockNumber: "12",
  blockHash: opening.hash, logIndex: 8, totalSupply: "100",
} as NewLaunchRecord;

function transfer(from: Address, to: Address, value: bigint, logIndex: number, block = opening) {
  return {
    address: launch.token, blockNumber: block.number, blockHash: block.hash, logIndex, removed: false,
    transactionHash: block === opening ? launch.transactionHash : hash(43), args: { from, to, value },
  };
}

const logs = [
  transfer(zeroAddress, launch.factory, 100n, 1),
  transfer(launch.factory, address(3), 70n, 5),
  transfer(launch.factory, address(4), 30n, 6),
  transfer(address(4), address(5), 12n, 1, head),
  transfer(address(5), address(5), 12n, 2, head),
  transfer(address(6), address(7), 0n, 3, head),
];

function client(entries = logs, end = head) {
  return {
    async getLogs(query: { address: Address; fromBlock: bigint; toBlock: bigint }) {
      assert.equal(query.address, launch.token);
      assert.equal(query.fromBlock, opening.number);
      assert.equal(query.toBlock, head.number);
      return entries;
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) { return blockNumber === opening.number ? opening : end; },
  } as unknown as PublicClient;
}

test("reconstructs two canonical holder counts without counting zero balances or duplicate self transfers", async () => {
  const trend = await readLaunchHolderTrend(client(), launch, head);
  assert.equal(trend.status, "observed");
  if (trend.status !== "observed") return;
  assert.deepEqual([trend.from.holders, trend.to.holders], [2, 3]);
  assert.equal(trend.from.blockHash, opening.hash);
  assert.equal(trend.to.blockHash, head.hash);
});

test("rejects missing mint provenance, duplicate or overspent logs, and reorged evidence", async () => {
  for (const fixture of [
    client(logs.slice(1)), client([...logs, logs.at(-1)!]),
    client([...logs, transfer(address(5), address(7), 13n, 4, head)]),
    client(logs, { ...head, hash: hash(99) }),
  ]) assert.equal((await readLaunchHolderTrend(fixture, launch, head)).status, "unknown");
});

test("avoids provider work when the evidence range is too short or outside the bounded window", async () => {
  const unused = {} as PublicClient;
  for (const number of [13n, 60n]) {
    const trend = await readLaunchHolderTrend(unused, launch, { ...head, number });
    assert.equal(trend.status, "unknown");
    assert.match(trend.reason, /bounded launch window/);
  }
});
