import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { toHex, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { launchPoolId, type LaunchPoolKey, type NewLaunchRecord } from "../launchpad/launch-record";
import { readLaunchpadRuntime } from "./new-launchpad-config";
import { launchpadFinalityEvidence, readLaunchpadBlock } from "./new-launchpad-finality";
import { launchpadPublicOperations, readLaunchpadPublicData, type LaunchpadPublicOperation } from "./new-launchpad-public-data";
import { LaunchpadStore } from "./new-launchpad-store";

const address = (n: number): Address => toHex(n, { size: 20 });
const hash = (n: number | bigint): Hash => toHex(n, { size: 32 });
const timestamp = 1_800_000_000n;
const factory = address(1);
const token = address(2);
const poolKey: LaunchPoolKey = { currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: address(0x2000) };
const l1Unverified = { status: "unverified", reason: "independent_l1_verifier_unconfigured" };

function evidenceOf(result: Awaited<ReturnType<typeof readLaunchpadPublicData>>) {
  return (result.data as { evidence?: ReturnType<typeof launchpadFinalityEvidence> } | undefined)?.evidence ?? result.evidence;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rmt-l2-observation-"));
  const config = readLaunchpadRuntime({
    RMT_LAUNCHPAD_ENABLED: "true",
    RMT_LAUNCHPAD_CHAIN_ID: "31337",
    RMT_LAUNCHPAD_ENGINE_VERSION: "2",
    RMT_LAUNCHPAD_FACTORY_ADDRESS: factory,
    RMT_LAUNCHPAD_FACTORY_RUNTIME_HASH: hash(81),
    RMT_LAUNCHPAD_FACTORY_START_BLOCK: "10",
    RMT_LAUNCHPAD_GUARD_ADDRESS: poolKey.hooks,
    RMT_LAUNCHPAD_GUARD_RUNTIME_HASH: hash(82),
    RMT_LAUNCHPAD_DATABASE_PATH: join(directory, "launches.sqlite"),
    RMT_LAUNCHPAD_RPC_URL: "http://127.0.0.1:8545",
  });
  assert.ok(config);
  const creator = address(3);
  const feePolicy = { creator, treasury: zeroAddress, reserve: zeroAddress, creatorBps: 10_000, treasuryBps: 0, reserveBps: 0 };
  const launch: NewLaunchRecord = {
    engineVersion: 2, feePolicy, chainId: 31337, factory, token, creator,
    poolManager: config.deployment.poolManager, poolKey, poolId: launchPoolId(poolKey),
    intentId: hash(83), positionTokenId: "42", sqrtPriceX96: (2n ** 96n).toString(), tickLower: -887220,
    tickUpper: 887220, liquidity: "20", amount0: "10", amount1: "10", totalSupply: "20", name: "Fixture",
    symbol: "FIX", projectURI: "", transactionHash: hash(84), blockNumber: "11", blockHash: hash(11),
    blockTimestamp: timestamp.toString(), logIndex: 2, indexing: "indexed",
  };
  const store = new LaunchpadStore(config.databasePath, config.scope);
  store.advance(undefined, { number: 12n, hash: hash(12) }, [launch]);
  store.markHealth(true);

  const chain = {
    id: 31337, head: 12n, down: false, inconsistentAfter: undefined as bigint | undefined,
    oldLaunchHash: hash(11), timestampOffset: 0n, wrongPool: false, duplicate: true, contradictLog: false, overflowLogs: false,
    rejectCanonicalCalls: false, rejectFeeCalls: false,
  };
  const reads = new Map<bigint, number>();
  const rpc = {
    async getChainId() { return chain.id; },
    async getBlockNumber() {
      if (chain.down) throw new Error("Fixture RPC unavailable");
      return chain.head;
    },
    async getBlock({ blockNumber, blockTag }: { blockNumber: bigint; blockTag?: string }) {
      assert.equal(blockTag, undefined, "L2 block tags must never supply L1 finality");
      reads.set(blockNumber, (reads.get(blockNumber) ?? 0) + 1);
      const changed = blockNumber === chain.inconsistentAfter && reads.get(blockNumber)! > 1;
      return { number: blockNumber, hash: changed ? hash(999) : blockNumber === 11n ? chain.oldLaunchHash : hash(blockNumber),
        timestamp: timestamp + (blockNumber - 11n) + chain.timestampOffset };
    },
    async getLogs({ address: emitter }: { address: Address }) {
      if (emitter !== launch.poolManager) return [];
      const swap = { address: launch.poolManager, removed: false, blockNumber: 12n, blockHash: hash(12),
        transactionHash: hash(85), logIndex: 1, args: { id: chain.wrongPool ? hash(1) : launch.poolId, amount0: 1n,
          amount1: -1n, sqrtPriceX96: 2n ** 96n, tick: 0, fee: 3000 } };
      if (chain.overflowLogs) return Array.from({ length: 1_025 }, () => swap);
      if (chain.contradictLog) return [swap, { ...swap, args: { ...swap.args, amount0: 2n } }];
      return chain.duplicate ? [swap, { ...swap }] : [swap];
    },
    async readContract({ functionName, args, blockHash, requireCanonical }: {
      functionName: string; args?: readonly unknown[]; blockHash: Hash; requireCanonical: boolean;
    }) {
      assert.equal(blockHash, hash(chain.head));
      assert.equal(requireCanonical, true);
      if (chain.rejectCanonicalCalls || (chain.rejectFeeCalls && functionName.startsWith("fee"))) {
        throw new Error("Fixture RPC does not support this canonical block call");
      }
      switch (functionName) {
        case "getSlot0": return [2n ** 96n, 0, 0, 3000];
        case "ownerOf": return factory;
        case "feePolicy": return [creator, zeroAddress, zeroAddress, 10_000, 0, 0];
        case "feeTotals": return [0n, 0n, 0n, 0n];
        case "feeBucket": return [args?.[1] === 0 ? creator : zeroAddress, 0n, 0n, 0n, 0n];
        default: return 20n;
      }
    },
  } as unknown as PublicClient;
  return {
    chain, rpc, reads,
    read(operation: LaunchpadPublicOperation, requestedToken = token) {
      return readLaunchpadPublicData({ operation, chainId: 31337, ...(operation === "list_launches" ? {} : { token: requestedToken }) },
        { config: () => config, rpc: async () => rpc });
    },
    close() {
      store.close();
      assert.equal(dirname(directory), tmpdir());
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("all five public reads expose exact L2 anchors and leave independent L1 finality unverified", async () => {
  const f = fixture();
  try {
    for (const operation of launchpadPublicOperations) {
      const result = await f.read(operation);
      assert.equal(result.status, "ready", operation);
      const height = operation === "get_launch" ? 11 : 12;
      const evidence = evidenceOf(result);
      assert.equal(evidence?.finality, "local_chain_observed", operation);
      assert.deepEqual(evidence?.l2Observation, { status: "observed", blockNumber: `${height}`, blockHash: hash(height) }, operation);
      assert.deepEqual(evidence?.l1Finality, l1Unverified, operation);
    }
    const activity = await f.read("get_launch_activity");
    assert.equal((activity.data as { activity: unknown[] }).activity.length, 1);
    const unknown = await f.read("get_launch", address(99));
    assert.equal(unknown.status, "not_found");
    assert.equal(unknown.evidence?.l2Observation.status, "observed");
    assert.deepEqual(unknown.evidence?.l1Finality, l1Unverified);
  } finally { f.close(); }
});

test("provider unavailability, a wrong chain, and a provider behind the launch fail closed", async () => {
  const f = fixture();
  try {
    for (const fault of [{ down: true }, { down: false, id: 4663 }, { id: 31337, head: 10n }]) {
      Object.assign(f.chain, fault);
      for (const operation of launchpadPublicOperations) {
        const result = await f.read(operation);
        assert.equal(result.status, "delayed", operation);
        assert.equal(evidenceOf(result)?.l2Observation.status, "unavailable", operation);
        assert.deepEqual(evidenceOf(result)?.l1Finality, l1Unverified, operation);
        if (operation === "get_launch_checks") {
          assert.ok((result.data as { checks: { status: string }[] }).checks.every((check) => check.status === "unknown"));
        } else assert.equal(result.data, undefined, operation);
      }
    }
    f.chain.head = 13n;
    const behind = await f.read("list_launches");
    assert.equal(behind.status, "delayed");
    assert.equal((behind.data as { evidence: { freshness: string } }).evidence.freshness, "delayed");
    assert.equal(evidenceOf(behind)?.l2Observation.blockNumber, "12");
    const missing = await f.read("get_launch", address(99));
    assert.equal(missing.status, "delayed", "a stale checkpoint cannot prove absence");
  } finally { f.close(); }
});

test("conflicting canonical anchors, timestamps and activity logs never become observed results", async () => {
  const f = fixture();
  try {
    f.chain.oldLaunchHash = hash(999);
    for (const operation of launchpadPublicOperations) assert.equal((await f.read(operation)).status, "delayed", operation);
    f.chain.oldLaunchHash = hash(11);
    f.chain.timestampOffset = 1n;
    assert.equal((await f.read("list_launches")).status, "delayed");
    f.chain.timestampOffset = 0n;
    f.chain.inconsistentAfter = 11n;
    for (const operation of launchpadPublicOperations) {
      f.reads.clear();
      const result = await f.read(operation);
      assert.equal(result.status, "delayed", operation);
      assert.equal(evidenceOf(result)?.l2Observation.status, "unavailable", operation);
    }
    f.chain.inconsistentAfter = undefined;
    for (const fault of [{ contradictLog: true }, { contradictLog: false, wrongPool: true }, { wrongPool: false, overflowLogs: true }]) {
      Object.assign(f.chain, fault);
      assert.equal((await f.read("get_launch_activity")).status, "delayed");
    }
  } finally { f.close(); }
});

test("block observations require the exact number, a full hash and a usable timestamp", async () => {
  for (const block of [{ number: 9n, hash: hash(10), timestamp }, { number: 10n, hash: "0x01", timestamp },
    { number: 10n, hash: hash(10), timestamp: -1n }, { number: 10n, hash: hash(10) }]) {
    const rpc = { async getBlock() { return block; } } as unknown as PublicClient;
    await assert.rejects(readLaunchpadBlock(rpc, 10n, 11n), /Canonical launch block unavailable/);
    await assert.rejects(readLaunchpadBlock(rpc, 12n, 11n), /behind/);
  }
});

test("pool and launch-health claims fail closed when hash-pinned state cannot be read", async () => {
  const f = fixture();
  try {
    f.chain.rejectCanonicalCalls = true;
    assert.equal((await f.read("get_pool_state")).status, "delayed");
    assert.equal((await f.read("get_launch_checks")).status, "delayed");
    assert.equal((await f.read("get_launch")).status, "ready");
    f.chain.rejectCanonicalCalls = false;
    f.chain.rejectFeeCalls = true;
    const checks = await f.read("get_launch_checks");
    assert.equal(checks.status, "ready");
    assert.equal((checks.data as { health: { fees: { status: string } } }).health.fees.status, "unknown");
    assert.equal(evidenceOf(checks)?.l2Observation.status, "observed");
    assert.deepEqual(evidenceOf(checks)?.l1Finality, l1Unverified);
  } finally { f.close(); }
});
