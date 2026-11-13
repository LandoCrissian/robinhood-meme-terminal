import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, parseAbiItem, toHex, zeroAddress, type AbiEvent, type Address, type Hash, type Log, type PublicClient, type TransactionReceipt } from "viem";
import { launchCreatedEvent, launchPoolId, longevityPolicyCommittedEvent, type LaunchFeePolicy, type LaunchPoolKey, type NewLaunchRecord } from "../launchpad/launch-record";
import { readLaunchpadRuntime, verifyLaunchpadRuntime } from "./new-launchpad-config";
import { makeLaunchHealth, readLaunchHealth } from "./new-launchpad-health";
import { syncNewLaunchpadRange } from "./new-launchpad-indexer";
import { readLaunchpadPublicData } from "./new-launchpad-public-data";
import { InvalidLaunchReceipt, projectLaunchReceipt, verifyLaunchReceipt } from "./new-launchpad-receipt";
import { LaunchpadStore } from "./new-launchpad-store";
import { LaunchpadSettlementStore } from "./new-launchpad-settlement-store";

const hash = (value: number): Hash => toHex(value, { size: 32 });
const address = (value: number): Address => toHex(value, { size: 20 });
const factory = address(1);
const creator = address(2);
const token = address(3);
const env = {
  RMT_LAUNCHPAD_ENABLED: "true",
  RMT_LAUNCHPAD_CHAIN_ID: "31337",
  RMT_LAUNCHPAD_FACTORY_ADDRESS: factory,
  RMT_LAUNCHPAD_FACTORY_RUNTIME_HASH: keccak256("0x1234"),
  RMT_LAUNCHPAD_FACTORY_START_BLOCK: "10",
  RMT_LAUNCHPAD_DATABASE_PATH: join(tmpdir(), "unused-launchpad.sqlite"),
  RMT_LAUNCHPAD_RPC_URL: "http://127.0.0.1:8545",
};
const config = readLaunchpadRuntime(env)!;
const { deployment } = config;
const { poolManager, positionManager } = deployment;
const guard = address(0x2000);
const guardEnv = {
  ...env,
  RMT_LAUNCHPAD_ENGINE_VERSION: "2",
  RMT_LAUNCHPAD_GUARD_ADDRESS: guard,
  RMT_LAUNCHPAD_GUARD_RUNTIME_HASH: keccak256("0x2345"),
};
const guardedConfig = readLaunchpadRuntime(guardEnv)!;
const guardedPolicy: LaunchFeePolicy = {
  creator, treasury: getAddress(address(10)), reserve: getAddress(address(11)), creatorBps: 5000, treasuryBps: 3000, reserveBps: 2000,
};
const tx = hash(400);
const blockHash = hash(11);
const intentId = hash(66);
const key: LaunchPoolKey = { currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: zeroAddress };
const guardedKey = { ...key, hooks: guard };
const poolId = launchPoolId(key);
const tickLower = -887220;
const tickUpper = 887220;
const sqrtPrice = 2n ** 96n;
const liquidity = 125n;
const positionId = 42n;
const supply = 200n;
const fundedToken = 110n;
const fundedNative = 100n;

const tokenTransfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const positionTransfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const initialize = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");
const modify = parseAbiItem("event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)");

function log(event: AbiEvent, emitter: Address, index: number, indexed: Record<string, unknown>, args: unknown[]): Log<bigint, number, false> {
  return {
    address: emitter,
    blockHash,
    blockNumber: 11n,
    transactionHash: tx,
    transactionIndex: 0,
    logIndex: index,
    removed: false,
    topics: encodeEventTopics({ abi: [event], eventName: event.name, args: indexed }) as Log["topics"],
    data: encodeAbiParameters(event.inputs.filter((input) => !input.indexed), args),
  };
}

function launchLog(id = poolId, amount0 = fundedNative, poolKey = key, index = 6) {
  return log(launchCreatedEvent, factory, index, { creator, token, poolId: id }, [
    intentId, positionId, poolKey, sqrtPrice, tickLower, tickUpper, liquidity, amount0, fundedToken, supply,
    "Fixture", "FIX", "https://example.com/project",
  ]);
}

function makeReceipt(poolKey = key, policy?: LaunchFeePolicy): TransactionReceipt {
  const id = launchPoolId(poolKey);
  const logs = [
    log(tokenTransfer, token, 1, { from: zeroAddress, to: factory }, [supply]),
    log(initialize, poolManager, 2, { id, currency0: zeroAddress, currency1: token }, [3000, 60, poolKey.hooks, sqrtPrice, 0]),
    log(positionTransfer, positionManager, 3, { from: zeroAddress, to: factory, tokenId: positionId }, []),
    log(modify, poolManager, 4, { id, sender: positionManager }, [tickLower, tickUpper, liquidity, toHex(positionId, { size: 32 })]),
    log(tokenTransfer, token, 5, { from: factory, to: poolManager }, [fundedToken]),
  ];
  if (policy) {
    logs.push(log(tokenTransfer, token, 6, { from: factory, to: creator }, [supply - fundedToken]));
    logs.push(log(longevityPolicyCommittedEvent, factory, 7, { token, creator: policy.creator }, [
      policy.treasury, policy.reserve, policy.creatorBps, policy.treasuryBps, policy.reserveBps,
    ]));
  }
  logs.push(launchLog(id, fundedNative, poolKey, logs.length + 1));
  return {
    blockHash, blockNumber: 11n, contractAddress: null, cumulativeGasUsed: 1n, effectiveGasPrice: 1n,
    from: creator, gasUsed: 1n, logs, logsBloom: "0x", status: "success", to: factory, transactionHash: tx,
    transactionIndex: 0, type: "eip1559",
  };
}

function fixtureRpc(receipt = makeReceipt()) {
  const chain = { head: 10n, providerDown: false, orphaned: false, wrongBlockNumber: false, wrongOwner: false,
    wrongPolicy: false, logQueryCount: 0, conflictingLog: false, omitLaunch: false };
  const rpc = {
    async getChainId() { return 31337; },
    async getBlockNumber() { return chain.head; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { number: chain.wrongBlockNumber ? blockNumber + 1n : blockNumber,
        hash: hash(Number(blockNumber) + (chain.orphaned && blockNumber > 10n ? 1000 : 0)),
        timestamp: 1_800_000_000n };
    },
    async getLogs({ address: emitter, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) {
      assert.equal(emitter, factory);
      assert.ok(toBlock - fromBlock < 256n);
      chain.logQueryCount++;
      if (chain.providerDown) throw new Error("RPC unavailable");
      const event = receipt.logs.at(-1)!;
      return !chain.omitLaunch && !chain.orphaned && fromBlock <= 11n && toBlock >= 11n
        ? [event, chain.conflictingLog ? { ...event, data: "0x" } : event] : [];
    },
    async getTransactionReceipt({ hash: wanted }: { hash: Hash }) { assert.equal(wanted, tx); return receipt; },
    async readContract({ functionName, blockHash: wanted, requireCanonical }: { functionName: string; blockHash: Hash; requireCanonical: boolean }) {
      assert.equal(wanted, receipt.blockHash);
      assert.equal(requireCanonical, true);
      if (functionName === "feePolicy") return [creator, guardedPolicy.treasury, guardedPolicy.reserve,
        chain.wrongPolicy ? 4999 : 5000, 3000, 2000];
      return functionName === "ownerOf" ? (chain.wrongOwner ? creator : factory) : liquidity;
    },
  } as unknown as PublicClient;
  return { chain, rpc, receipt };
}

test("validates exact factory, intent, v4 pool, custody and both deposited amounts", async () => {
  const { chain, rpc, receipt } = fixtureRpc();
  const launch = await verifyLaunchReceipt(rpc, deployment, tx, { creator, intentId });
  assert.equal(launch.poolId, poolId);
  assert.equal(launch.poolManager, poolManager);
  assert.equal(launch.amount0, fundedNative.toString());
  assert.equal(launch.amount1, fundedToken.toString());
  assert.equal(launch.indexing, "pending");
  const cases = [
    { ...receipt, status: "reverted" } as TransactionReceipt,
    { ...receipt, logs: receipt.logs.slice(0, -2).concat(launchLog()) },
    { ...receipt, logs: receipt.logs.slice(0, -1).concat(launchLog(hash(12))) },
    { ...receipt, logs: receipt.logs.slice(0, -1).concat(launchLog(poolId, 0n)) },
    { ...receipt, logs: receipt.logs.slice(0, -1).concat({ ...launchLog(), address: creator }) },
  ];
  for (const invalid of cases) assert.throws(() => projectLaunchReceipt(deployment, invalid, tx), InvalidLaunchReceipt);
  assert.throws(() => projectLaunchReceipt(deployment, receipt, tx, { creator: address(4), intentId }), InvalidLaunchReceipt);
  assert.throws(() => projectLaunchReceipt(deployment, receipt, tx, { creator, intentId: hash(13) }), InvalidLaunchReceipt);
  chain.wrongOwner = true;
  await assert.rejects(() => verifyLaunchReceipt(rpc, deployment, tx), InvalidLaunchReceipt);
  chain.wrongOwner = false;
  chain.orphaned = true;
  await assert.rejects(() => verifyLaunchReceipt(rpc, deployment, tx), /no longer canonical/);
});

test("verifies the exact guarded PoolKey, committed fee policy and creator allocation at the receipt block", async () => {
  const receipt = makeReceipt(guardedKey, guardedPolicy);
  const { chain, rpc } = fixtureRpc(receipt);
  const launch = await verifyLaunchReceipt(rpc, guardedConfig.deployment, tx, { creator, intentId });
  assert.equal(launch.engineVersion, 2);
  assert.deepEqual(launch.feePolicy, guardedPolicy);
  assert.equal(launch.poolKey.hooks, guard);
  assert.equal(launch.poolId, launchPoolId(guardedKey));
  assert.notEqual(launch.poolId, poolId);
  assert.throws(() => projectLaunchReceipt(deployment, receipt, tx), /supported funded pool terms/);
  for (const invalid of [
    makeReceipt({ ...guardedKey, hooks: address(0x6000) }, guardedPolicy),
    makeReceipt(guardedKey),
    makeReceipt(guardedKey, { ...guardedPolicy, treasuryBps: 3001 }),
    makeReceipt(guardedKey, { ...guardedPolicy, reserve: guardedPolicy.treasury }),
    makeReceipt(guardedKey, { ...guardedPolicy, treasury: factory }),
    { ...receipt, logs: receipt.logs.map((event) => event.logIndex === 7 ? { ...event, address: creator } : event) },
    { ...receipt, logs: receipt.logs.filter((event) => event.logIndex !== 6) },
  ]) assert.throws(() => projectLaunchReceipt(guardedConfig.deployment, invalid, tx), InvalidLaunchReceipt);
  chain.wrongPolicy = true;
  await assert.rejects(() => verifyLaunchReceipt(rpc, guardedConfig.deployment, tx), /commitments do not match/);
});

test("publishes a receipt immediately, reconciles duplicate logs after restart, and rewinds an orphan", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-index-"));
  const path = join(directory, "launches.sqlite");
  const { chain, rpc, receipt } = fixtureRpc();
  let store = new LaunchpadStore(path, config.scope);
  try {
    await syncNewLaunchpadRange(store, rpc, config);
    assert.equal(store.checkpoint()?.number, 10n);
    assert.equal(store.status(), "ready");
    const launch = projectLaunchReceipt(deployment, receipt, tx);
    store.publish(launch);
    assert.deepEqual(store.read({ token }), [launch]);
    store.close();
    store = new LaunchpadStore(path, config.scope);
    assert.deepEqual(store.read({ creator }), [launch]);
    chain.head = 11n;
    chain.providerDown = true;
    await assert.rejects(() => syncNewLaunchpadRange(store, rpc, config), /RPC unavailable/);
    assert.equal(store.status(), "delayed");
    assert.equal(store.checkpoint()?.number, 10n);
    assert.deepEqual(store.read(), [launch]);
    chain.providerDown = false;
    await syncNewLaunchpadRange(store, rpc, config);
    assert.equal(store.checkpoint()?.number, 11n);
    assert.deepEqual(store.read(), [{ ...launch, blockTimestamp: "1800000000", indexing: "indexed" }]);
    assert.equal(store.publish(launch).indexing, "indexed");
    chain.orphaned = true;
    await syncNewLaunchpadRange(store, rpc, config);
    assert.equal(store.checkpoint()?.hash, hash(1011));
    assert.deepEqual(store.read(), []);
    assert.equal(store.status(), "ready");
    assert.equal(chain.logQueryCount, 4);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fails closed on stale or disagreeing witnesses, contradictory duplicates and interrupted reorgs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-witness-"));
  const store = new LaunchpadStore(join(directory, "launches.sqlite"), config.scope);
  const { chain, rpc, receipt } = fixtureRpc();
  const launch = projectLaunchReceipt(deployment, receipt, tx);
  try {
    await syncNewLaunchpadRange(store, rpc, config, rpc);
    assert.deepEqual(store.anchor(), { number: 9n, hash: hash(9) });
    store.publish(launch);
    chain.head = 11n;
    chain.conflictingLog = true;
    await assert.rejects(syncNewLaunchpadRange(store, rpc, config, rpc), /conflicting duplicate/);
    assert.equal(store.checkpoint()?.number, 10n);
    assert.deepEqual(store.read(), [launch]);
    chain.conflictingLog = false;
    chain.omitLaunch = true;
    await assert.rejects(syncNewLaunchpadRange(store, rpc, config, rpc), /omits a verified provisional receipt/);
    assert.equal(store.checkpoint()?.number, 10n);
    chain.omitLaunch = false;
    const contradictingReceipt = {
      ...rpc,
      async getLogs() {
        return [{ ...receipt.logs.at(-1)!, data: launchLog(poolId, fundedNative + 1n).data }];
      },
    } as unknown as PublicClient;
    await assert.rejects(syncNewLaunchpadRange(store, contradictingReceipt, config, rpc), /does not match|disagree/);
    assert.equal(store.checkpoint()?.number, 10n);
    await syncNewLaunchpadRange(store, rpc, config, rpc);
    assert.equal(store.status(), "ready");
    const indexed = store.read();
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0].indexing, "indexed");

    const stale = { ...rpc, async getBlockNumber() { return 10n; } };
    await assert.rejects(syncNewLaunchpadRange(store, rpc, config, stale), /behind the durable checkpoint/);
    const wrongChain = { ...rpc, async getChainId() { return 4663; } };
    await assert.rejects(syncNewLaunchpadRange(store, rpc, config, wrongChain), /chain ID mismatch/);
    const disagreeing = { ...rpc, async getBlock(args: Parameters<typeof rpc.getBlock>[0]) {
      const block = await rpc.getBlock(args);
      return block.number === 11n ? { ...block, hash: hash(555) } : block;
    } } as Pick<PublicClient, "getChainId" | "getBlockNumber" | "getBlock">;
    await assert.rejects(syncNewLaunchpadRange(store, rpc, config, disagreeing), /providers disagree/);
    assert.equal(store.status(), "delayed");
    assert.deepEqual(store.read(), indexed);

    chain.orphaned = true;
    chain.providerDown = true;
    await assert.rejects(syncNewLaunchpadRange(store, rpc, config, rpc), /RPC unavailable/);
    assert.deepEqual(store.checkpoint(), { number: 11n, hash: hash(11) });
    assert.deepEqual(store.read(), indexed);
    chain.providerDown = false;
    await syncNewLaunchpadRange(store, rpc, config, rpc);
    assert.deepEqual(store.checkpoint(), { number: 11n, hash: hash(1011) });
    assert.deepEqual(store.read(), []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("binds every persisted event to its scope, complete PoolKey and unique event slot", async () => {
  const store = new LaunchpadStore(":memory:", config.scope);
  const { chain, rpc, receipt } = fixtureRpc();
  const launch = projectLaunchReceipt(deployment, receipt, tx);
  try {
    for (const invalid of [
      { ...launch, chainId: 4663 as 31337 },
      { ...launch, factory: creator },
      { ...launch, poolManager: creator },
      { ...launch, poolKey: { ...key, hooks: guard } },
      { ...launch, poolKey: { ...key, currency1: creator } },
      { ...launch, poolId: hash(18) },
      { ...launch, blockNumber: "9" },
      { ...launch, blockHash: "0x" as Hash },
      { ...launch, logIndex: -1 },
    ]) assert.throws(() => store.publish(invalid), /does not match/);
    const launch2Key = { ...key, currency1: address(14) };
    store.publish(launch);
    assert.throws(() => store.publish({ ...launch, name: "Conflicting receipt contents" }), /conflicting payloads/);
    assert.throws(() => store.publish({ ...launch, token: address(14), poolKey: launch2Key, poolId: launchPoolId(launch2Key),
      transactionHash: hash(401) }), /UNIQUE/);
    chain.head = 11n;
    await syncNewLaunchpadRange(store, rpc, config);
    assert.throws(() => store.publish({ ...launch, logIndex: launch.logIndex + 1 }), /conflicts with an indexed record/);
    assert.equal(store.read().length, 1);
  } finally { store.close(); }
});

test("restores a checksum-verified live-WAL snapshot into a fresh, delayed index before replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-backup-"));
  const original = join(directory, "live.sqlite");
  const snapshot = join(directory, "snapshot.sqlite");
  const destination = join(directory, "restored.sqlite");
  const writer = new LaunchpadStore(original, config.scope);
  const { chain, rpc } = fixtureRpc();
  try {
    chain.head = 11n;
    await syncNewLaunchpadRange(writer, rpc, config);
    assert.equal(existsSync(original + "-wal"), true);
    const backup = await writer.backup(snapshot);
    assert.deepEqual(backup.checkpoint, { number: 11n, hash: hash(11) });
    assert.match(backup.sha256, /^[a-f0-9]{64}$/);
    assert.equal(existsSync(snapshot + "-wal"), false);
    await assert.rejects(writer.backup(snapshot), /fresh absolute file/);
    await assert.rejects(LaunchpadStore.restore(snapshot, destination, config.scope, "0".repeat(64)), /SHA-256 mismatch/);
    assert.equal(existsSync(destination), false);
    await assert.rejects(LaunchpadStore.restore(snapshot, destination, guardedConfig.scope, backup.sha256), /requested index scope/);
    assert.equal(existsSync(destination), false);

    chain.head = 12n;
    await syncNewLaunchpadRange(writer, rpc, config);
    const restored = await LaunchpadStore.restore(snapshot, destination, config.scope, backup.sha256);
    assert.deepEqual(restored.checkpoint, backup.checkpoint);
    assert.notEqual(restored.sha256, backup.sha256);
    const replica = new LaunchpadStore(destination, config.scope);
    try {
      assert.equal(replica.status(), "delayed");
      assert.deepEqual(replica.checkpoint(), backup.checkpoint);
      assert.deepEqual(replica.read(), writer.read());
      await syncNewLaunchpadRange(replica, rpc, config);
      assert.equal(replica.status(), "ready");
      assert.deepEqual(replica.checkpoint(), writer.checkpoint());
      assert.deepEqual(replica.read(), writer.read());
    } finally { replica.close(); }
  } finally {
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retains late provisional evidence and commits reorg proof cleanup only with the replacement range", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-atomic-"));
  const path = join(directory, "launches.sqlite");
  const store = new LaunchpadStore(path, config.scope);
  const settlement = new LaunchpadSettlementStore(path, config.scope);
  const db = new DatabaseSync(path);
  const { chain, rpc, receipt } = fixtureRpc();
  const launch = projectLaunchReceipt(deployment, receipt, tx);
  try {
    await syncNewLaunchpadRange(store, rpc, config);
    chain.head = 11n;
    const latePublisher = { ...rpc, async getLogs() { store.publish(launch); return []; } } as unknown as PublicClient;
    await assert.rejects(syncNewLaunchpadRange(store, latePublisher, config), /provisional launch receipt unexplained/);
    assert.deepEqual(store.checkpoint(), { number: 10n, hash: hash(10) });
    assert.deepEqual(store.read(), [launch]);
    await syncNewLaunchpadRange(store, rpc, config);

    // Seed retention rows directly so the test isolates the indexer's transaction from the proof writer.
    const write = db.prepare(`INSERT INTO rmt_launch_native_settlement_proofs
      (scope, height, block_hash, tx_hash, log_index, expires_ms, proof) VALUES (?, ?, ?, ?, ?, ?, '{}')`);
    const fresh = Date.now() + 60_000;
    write.run(config.scope, 11, hash(11), hash(801), 1, fresh);
    write.run(config.scope, 10, hash(10), hash(802), 2, Date.now() - 1);
    write.run(guardedConfig.scope, 11, hash(11), hash(803), 3, fresh);
    const proofs = () => db.prepare("SELECT tx_hash FROM rmt_launch_native_settlement_proofs ORDER BY log_index").all().map((row) => row.tx_hash);
    db.exec(`CREATE TRIGGER interrupt_reorg BEFORE INSERT ON rmt_new_launch_checkpoints
      BEGIN SELECT RAISE(ABORT, 'interrupted SQLite replacement'); END`);
    chain.orphaned = true;
    await assert.rejects(syncNewLaunchpadRange(store, rpc, config), /interrupted SQLite replacement/);
    assert.deepEqual(store.checkpoint(), { number: 11n, hash: hash(11) });
    assert.equal(store.read().length, 1);
    assert.deepEqual(proofs(), [hash(801), hash(802), hash(803)]);
    assert.equal(store.status(), "delayed");

    db.exec("DROP TRIGGER interrupt_reorg");
    await syncNewLaunchpadRange(store, rpc, config);
    assert.deepEqual(store.checkpoint(), { number: 11n, hash: hash(1011) });
    assert.deepEqual(store.read(), []);
    assert.deepEqual(proofs(), [hash(803)]);
    assert.equal(store.status(), "ready");
  } finally {
    db.close();
    settlement.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("V2 uses an isolated durable scope and preserves the existing V1 index on reorg", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-guarded-index-"));
  const path = join(directory, "launches.sqlite");
  const v1 = new LaunchpadStore(path, config.scope);
  let v2 = new LaunchpadStore(path, guardedConfig.scope);
  const { chain, rpc, receipt } = fixtureRpc(makeReceipt(guardedKey, guardedPolicy));
  try {
    const oldLaunch = projectLaunchReceipt(deployment, makeReceipt(), tx);
    const guardedLaunch = projectLaunchReceipt(guardedConfig.deployment, receipt, tx);
    v1.publish(oldLaunch);
    v2.publish(guardedLaunch);
    chain.head = 11n;
    await syncNewLaunchpadRange(v2, rpc, guardedConfig);
    v2.close();
    v2 = new LaunchpadStore(path, guardedConfig.scope);
    assert.deepEqual(v2.read(), [{ ...guardedLaunch, blockTimestamp: "1800000000", indexing: "indexed" }]);
    assert.deepEqual(v1.read(), [oldLaunch]);
    chain.orphaned = true;
    await syncNewLaunchpadRange(v2, rpc, guardedConfig);
    assert.deepEqual(v2.read(), []);
    assert.deepEqual(v1.read(), [oldLaunch]);
  } finally {
    v1.close();
    v2.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rechecks chain-qualified guarded reads across restart, provider failure and a reorg", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rmt-guarded-public-"));
  const runtime = { ...guardedConfig, databasePath: join(directory, "launches.sqlite") };
  const { chain, rpc, receipt } = fixtureRpc(makeReceipt(guardedKey, guardedPolicy));
  const id = launchPoolId(guardedKey);
  let activityPool = id;
  const publicRpc = {
    ...rpc,
    async getBlock(args: Parameters<typeof rpc.getBlock>[0]) {
      return { ...await rpc.getBlock(args), timestamp: 1_800_000_000n };
    },
    async getLogs(args: { address: Address; args: { id: Hash }; fromBlock: bigint; toBlock: bigint }) {
      assert.equal(args.address, poolManager);
      assert.equal(args.args.id, id);
      assert.equal(args.fromBlock, 11n);
      assert.equal(args.toBlock, 11n);
      return [{ ...receipt.logs[0], address: poolManager, args: { id: activityPool, amount0: 10n, amount1: -9n,
        sqrtPriceX96: sqrtPrice, tick: 0, fee: 3000 } }];
    },
    async readContract(args: { functionName: string; blockHash: Hash; requireCanonical: boolean; args: readonly [Address, number] }) {
      assert.equal(args.blockHash, blockHash);
      assert.equal(args.requireCanonical, true);
      if (args.functionName === "getSlot0") return [sqrtPrice, 0, 0, 3000];
      if (args.functionName === "totalSupply") return supply;
      if (args.functionName === "feeTotals") return [0n, 0n, 0n, 0n];
      if (args.functionName === "feeBucket") return [[creator, guardedPolicy.treasury, guardedPolicy.reserve][args.args[1]], 0n, 0n, 0n, 0n];
      if (args.functionName === "ownerOf") return factory;
      if (args.functionName === "feePolicy") return [creator, guardedPolicy.treasury, guardedPolicy.reserve, 5000, 3000, 2000];
      return liquidity;
    },
  } as unknown as PublicClient;
  const services = { config: () => runtime, rpc: async () => publicRpc };
  const read = (operation: Parameters<typeof readLaunchpadPublicData>[0]["operation"]) =>
    readLaunchpadPublicData({ operation, chainId: 31337, ...(operation === "list_launches" ? {} : { token }) }, services);
  const identity = { chainId: 31337, factory, poolManager, poolKey: guardedKey, poolId: id };
  let store = new LaunchpadStore(runtime.databasePath, runtime.scope);
  try {
    await syncNewLaunchpadRange(store, rpc, runtime);
    chain.head = 11n;
    const launch = await verifyLaunchReceipt(rpc, runtime.deployment, tx, { creator, intentId });
    store.publish(launch);
    assert.equal((await read("get_launch")).status, "ready");
    store.close();
    store = new LaunchpadStore(runtime.databasePath, runtime.scope);

    chain.providerDown = true;
    await assert.rejects(() => syncNewLaunchpadRange(store, rpc, runtime), /RPC unavailable/);
    assert.equal((await read("get_launch")).status, "delayed");
    assert.equal(store.checkpoint()?.number, 10n);
    chain.providerDown = false;
    await syncNewLaunchpadRange(store, rpc, runtime);
    assert.equal(store.read().length, 1);
    assert.equal(store.read()[0].indexing, "indexed");

    const list = await read("list_launches");
    assert.equal(list.status, "ready");
    assert.equal((list.data as { launches: NewLaunchRecord[] }).launches[0].poolId, id);
    for (const operation of ["get_launch", "get_launch_checks", "get_pool_state", "get_launch_activity"] as const) {
      const result = await read(operation);
      assert.equal(result.status, "ready", operation);
      const evidence = (result.data as { evidence: typeof identity }).evidence;
      for (const field of Object.keys(identity) as (keyof typeof identity)[]) {
        assert.deepEqual(evidence[field], identity[field], `${operation} ${field}`);
      }
    }
    const checks = await read("get_launch_checks");
    assert.equal((checks.data as { health: { fees: { status: string } } }).health.fees.status, "verified");
    assert.equal((await readLaunchpadPublicData({ operation: "get_launch", chainId: 84532, token }, services)).status, "disabled");
    activityPool = poolId;
    assert.equal((await read("get_launch_activity")).status, "delayed");
    activityPool = id;

    chain.wrongBlockNumber = true;
    await assert.rejects(() => syncNewLaunchpadRange(store, rpc, runtime), /requested canonical block/);
    assert.equal((await read("get_launch")).status, "delayed");
    assert.equal(store.checkpoint()?.hash, blockHash);
    chain.wrongBlockNumber = false;
    chain.orphaned = true;
    for (const operation of ["list_launches", "get_launch", "get_launch_checks", "get_pool_state", "get_launch_activity"] as const) {
      assert.equal((await read(operation)).status, "delayed", operation);
    }
    assert.equal((await readLaunchpadPublicData({ operation: "get_launch", chainId: 31337, token: address(99) }, services)).status, "delayed");
    assert.equal((await read("get_launch")).data, undefined);
    await syncNewLaunchpadRange(store, rpc, runtime);
    assert.equal((await read("get_launch")).status, "not_found");
    assert.deepEqual(((await read("list_launches")).data as { launches: NewLaunchRecord[] }).launches, []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blocks hosted environments, other chain IDs, arbitrary public RPC URLs and runtime mismatches", async () => {
  assert.equal(readLaunchpadRuntime({}), null);
  assert.equal(readLaunchpadRuntime({ ...env, VERCEL_ENV: "production" }), null);
  assert.equal(readLaunchpadRuntime({ ...env, VERCEL_ENV: "preview" }), null);
  assert.equal(readLaunchpadRuntime({ ...env, VERCEL: "1" }), null);
  assert.equal(readLaunchpadRuntime({ ...guardEnv, VERCEL: "1" }), null);
  assert.equal(guardedConfig.deployment.engineVersion, 2);
  assert.equal(guardedConfig.deployment.initializationGuard, guard);
  assert.equal(readLaunchpadRuntime({ ...env, RMT_LAUNCHPAD_ENGINE_VERSION: "1" })?.scope, config.scope);
  assert.notEqual(guardedConfig.scope, config.scope);
  assert.throws(() => readLaunchpadRuntime({ ...env, RMT_LAUNCHPAD_ENGINE_VERSION: "2" }), /Missing .*GUARD_ADDRESS/);
  assert.throws(() => readLaunchpadRuntime({ ...guardEnv, RMT_LAUNCHPAD_ENGINE_VERSION: "1" }), /Guard pins require/);
  assert.throws(() => readLaunchpadRuntime({ ...guardEnv, RMT_LAUNCHPAD_GUARD_ADDRESS: address(0x2080) }), /only the before-initialize/);
  assert.equal(deployment.tradingEnabled, false);
  assert.equal(readLaunchpadRuntime({ ...env, RMT_LAUNCHPAD_TRADING_ENABLED: "true" })?.deployment.tradingEnabled, true);
  assert.throws(() => readLaunchpadRuntime({ ...env, RMT_LAUNCHPAD_CHAIN_ID: "4663" }), /local launchpad/);
  assert.throws(() => readLaunchpadRuntime({ ...env, RMT_LAUNCHPAD_RPC_URL: "http://127.0.0.1:8545/secret?key=value" }), /loopback HTTP origin/);
  const rpc = {
    async getChainId() { return 31337; },
    async getBlockNumber() { return 11n; },
    async getCode() { return "0x1234"; },
    async readContract() { return poolManager; },
  } as unknown as PublicClient;
  await assert.rejects(() => verifyLaunchpadRuntime(config, rpc), /runtime bytecode|declared start block|binding mismatch/);
});

test("pins V2 guard bytecode, atomic deployment and reciprocal factory, manager and runtime hash bindings", async () => {
  const code = "0x1234";
  const runtimeHash = keccak256(code);
  const contracts = { ...guardedConfig.contracts };
  for (const name of Object.keys(contracts) as (keyof typeof contracts)[]) contracts[name] = { ...contracts[name], runtimeHash };
  const runtime = { ...guardedConfig, contracts, guard: { address: guard, runtimeHash } };
  let priorGuard = false;
  let wrongGuardCode = false;
  let wrongGuardFactory = false;
  let wrongFactoryHash = false;
  const rpc = {
    async getChainId() { return 31337; },
    async getBlockNumber() { return 11n; },
    async getCode({ address: target, blockNumber }: { address: Address; blockNumber: bigint }) {
      if (blockNumber === 9n && (target === factory || (target === guard && !priorGuard))) return "0x";
      return target === guard && blockNumber === 11n && wrongGuardCode ? "0x4321" : code;
    },
    async readContract({ functionName }: { functionName: string }) {
      if (functionName === "initializationGuard") return guard;
      if (functionName === "initializationGuardRuntimeHash") return wrongFactoryHash ? hash(9) : runtimeHash;
      if (functionName === "factory") return wrongGuardFactory ? creator : factory;
      if (functionName === "positionManager") return positionManager;
      if (functionName === "permit2") return deployment.permit2;
      return poolManager;
    },
  } as unknown as PublicClient;
  await verifyLaunchpadRuntime(runtime, rpc);
  priorGuard = true;
  await assert.rejects(() => verifyLaunchpadRuntime(runtime, rpc), /guard existed before/);
  priorGuard = false;
  wrongGuardCode = true;
  await assert.rejects(() => verifyLaunchpadRuntime(runtime, rpc), /bytecode/);
  wrongGuardCode = false;
  wrongGuardFactory = true;
  await assert.rejects(() => verifyLaunchpadRuntime(runtime, rpc), /guard dependency binding/);
  wrongGuardFactory = false;
  wrongFactoryHash = true;
  await assert.rejects(() => verifyLaunchpadRuntime(runtime, rpc), /guard dependency binding/);
});

test("observes comparable liquidity and reconciled fee collection and distribution without estimating holder trends", async () => {
  const launch = projectLaunchReceipt(guardedConfig.deployment, makeReceipt(guardedKey, guardedPolicy), tx);
  const opening = { blockNumber: 11n, hash: blockHash, timestamp: 1000n };
  const current = { blockNumber: 16n, hash: hash(16), timestamp: 1015n };
  const position = { positionOwner: factory, positionLiquidity: liquidity.toString(), activeLiquidity: "205" };
  const recipients = [creator, guardedPolicy.treasury, guardedPolicy.reserve];
  let inconsistent = false;
  const rpc = {
    async readContract({ address: target, blockHash: observedHash, requireCanonical, functionName, args }: {
      address: Address; blockHash: Hash; requireCanonical: boolean; functionName: string; args: [Address, number];
    }) {
      assert.equal(requireCanonical, true);
      if (functionName === "getLiquidity") {
        assert.equal(target, deployment.stateView);
        assert.equal(observedHash, opening.hash);
        assert.equal(args[0], launch.poolId);
        return liquidity;
      }
      assert.equal(target, factory);
      assert.equal(observedHash, current.hash);
      assert.equal(args[0], token);
      if (functionName === "feePolicy") return [creator, guardedPolicy.treasury, guardedPolicy.reserve, 5000, 3000, 2000];
      if (functionName === "feeTotals") return [10_001n, 10_004n, inconsistent ? 2n : 1n, 1n];
      if (args[1] === 0) return [recipients[0], 4_990n, 5_002n, 10n, 0n];
      if (args[1] === 1) return [recipients[1], 3_000n, 2_901n, 0n, 100n];
      return [recipients[2], 2_000n, 2_000n, 0n, 0n];
    },
  } as unknown as PublicClient;
  const health = await readLaunchHealth(rpc, deployment.stateView, launch, position, opening, current);
  assert.equal(health.liquidity.custody.status, "verified");
  assert.deepEqual(health.creator, { initialTokenAllocation: "90", vesting: "none" });
  assert.equal(health.permissions.initializationGuard, guard);
  assert.equal(health.permissions.principalWithdrawal, false);
  assert.equal(health.fees.status, "verified");
  assert.equal(health.fees.buckets?.[1].tokenDistributed, "100");
  assert.equal(health.fees.totals?.nativeRoundingDust, "1");
  assert.deepEqual(health.trends.liquidity, {
    status: "observed",
    from: { blockNumber: "11", blockHash, timestampUnixSeconds: "1000", activeLiquidity: "125" },
    to: { blockNumber: "16", blockHash: hash(16), timestampUnixSeconds: "1015", activeLiquidity: "205" },
  });
  assert.equal(health.trends.holders.status, "unknown");
  inconsistent = true;
  const partial = await readLaunchHealth(rpc, deployment.stateView, launch, { ...position, positionOwner: creator }, opening, current);
  assert.equal(partial.fees.status, "unknown");
  assert.equal(partial.fees.buckets, null);
  assert.equal(partial.liquidity.custody.status, "failed");
  assert.equal(makeLaunchHealth(launch).permissions.status, "unknown");
  assert.equal(makeLaunchHealth(launch).trends.liquidity.status, "unknown");
  assert.equal(makeLaunchHealth(projectLaunchReceipt(deployment, makeReceipt(), tx), position).fees.status, "legacy");
});

test("bounds public requests, paginates in log order, and shares a durable rate limit across connections", async () => {
  assert.equal((await readLaunchpadPublicData({ operation: "list_launches", chainId: 31337, limit: 21 })).status, "invalid");
  assert.equal((await readLaunchpadPublicData({ operation: "list_launches", chainId: 31337, cursor: "_".repeat(129) })).status, "invalid");
  assert.equal((await readLaunchpadPublicData({ operation: "get_launch", chainId: 31337, token, limit: 1 })).status, "invalid");
  assert.equal((await readLaunchpadPublicData({ operation: "get_pool_state", chainId: 4663, token })).status, "disabled");

  const directory = mkdtempSync(join(tmpdir(), "rmt-launch-quota-"));
  const path = join(directory, "launches.sqlite");
  const writer = new LaunchpadStore(path, config.scope);
  const reader = new LaunchpadStore(path, config.scope);
  try {
    const now = 62_000;
    const launch = projectLaunchReceipt(deployment, makeReceipt(), tx);
    writer.publish(launch, now);
    const secondKey = { ...key, currency1: address(4) };
    const thirdKey = { ...key, currency1: address(5) };
    writer.publish({ ...launch, token: address(4), poolKey: secondKey, poolId: launchPoolId(secondKey),
      transactionHash: hash(401), logIndex: 2 }, now);
    writer.publish({ ...launch, token: address(5), poolKey: thirdKey, poolId: launchPoolId(thirdKey),
      transactionHash: hash(402), blockNumber: "10", blockHash: hash(10) }, now);
    assert.deepEqual(reader.readPage(2, undefined, now).map((row) => row.token), [token, address(4)]);
    assert.deepEqual(reader.readPage(2, { blockNumber: 11n, logIndex: 2 }, now).map((row) => row.token), [address(5)]);

    assert.equal(writer.consumePublicQuota("get_launch", 2, now), 0);
    assert.equal(reader.consumePublicQuota("get_launch", 2, now), 0);
    assert.equal(writer.consumePublicQuota("get_launch", 2, now), 58);
    assert.equal(reader.consumePublicQuota("get_launch_checks", 20, now), 0);
    assert.equal(reader.consumePublicQuota("get_launch", 2, 120_000), 0);
    for (let request = 0; request < 119; request++) assert.equal(writer.consumePublicQuota("list_launches", 200, 120_000), 0);
    assert.equal(reader.consumePublicQuota("get_pool_state", 20, 120_000), 60);
  } finally {
    reader.close();
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
