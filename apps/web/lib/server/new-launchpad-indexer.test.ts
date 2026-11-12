import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiItem, toHex, zeroAddress, type AbiEvent, type Address, type Hash, type Log, type PublicClient, type TransactionReceipt } from "viem";
import { launchCreatedEvent, launchPoolId, type LaunchPoolKey } from "../launchpad/launch-record";
import { readLaunchpadRuntime, verifyLaunchpadRuntime } from "./new-launchpad-config";
import { syncNewLaunchpadRange } from "./new-launchpad-indexer";
import { InvalidLaunchReceipt, projectLaunchReceipt, verifyLaunchReceipt } from "./new-launchpad-receipt";
import { LaunchpadStore } from "./new-launchpad-store";

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
const tx = hash(400);
const blockHash = hash(11);
const intentId = hash(66);
const key: LaunchPoolKey = { currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: zeroAddress };
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

function launchLog(id = poolId, amount0 = fundedNative) {
  return log(launchCreatedEvent, factory, 6, { creator, token, poolId: id }, [
    intentId, positionId, key, sqrtPrice, tickLower, tickUpper, liquidity, amount0, fundedToken, supply,
    "Fixture", "FIX", "https://example.com/project",
  ]);
}

function makeReceipt(): TransactionReceipt {
  const logs = [
    log(tokenTransfer, token, 1, { from: zeroAddress, to: factory }, [supply]),
    log(initialize, poolManager, 2, { id: poolId, currency0: zeroAddress, currency1: token }, [3000, 60, zeroAddress, sqrtPrice, 0]),
    log(positionTransfer, positionManager, 3, { from: zeroAddress, to: factory, tokenId: positionId }, []),
    log(modify, poolManager, 4, { id: poolId, sender: positionManager }, [tickLower, tickUpper, liquidity, toHex(positionId, { size: 32 })]),
    log(tokenTransfer, token, 5, { from: factory, to: poolManager }, [fundedToken]),
    launchLog(),
  ];
  return {
    blockHash, blockNumber: 11n, contractAddress: null, cumulativeGasUsed: 1n, effectiveGasPrice: 1n,
    from: creator, gasUsed: 1n, logs, logsBloom: "0x", status: "success", to: factory, transactionHash: tx,
    transactionIndex: 0, type: "eip1559",
  };
}

function fixtureRpc() {
  const chain = { head: 10n, providerDown: false, orphaned: false, wrongOwner: false, logQueryCount: 0 };
  const receipt = makeReceipt();
  const rpc = {
    async getBlockNumber() { return chain.head; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { hash: hash(Number(blockNumber) + (chain.orphaned && blockNumber > 10n ? 1000 : 0)) };
    },
    async getLogs({ address: emitter, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) {
      assert.equal(emitter, factory);
      assert.ok(toBlock - fromBlock < 256n);
      chain.logQueryCount++;
      if (chain.providerDown) throw new Error("RPC unavailable");
      return !chain.orphaned && fromBlock <= 11n && toBlock >= 11n ? [receipt.logs[5], receipt.logs[5]] : [];
    },
    async getTransactionReceipt({ hash: wanted }: { hash: Hash }) { assert.equal(wanted, tx); return receipt; },
    async readContract({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) {
      assert.equal(blockNumber, 11n);
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
    assert.deepEqual(store.read(), [{ ...launch, indexing: "indexed" }]);
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

test("blocks production, other chain IDs, arbitrary public RPC URLs and runtime mismatches", async () => {
  assert.equal(readLaunchpadRuntime({}), null);
  assert.equal(readLaunchpadRuntime({ ...env, VERCEL_ENV: "production" }), null);
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
