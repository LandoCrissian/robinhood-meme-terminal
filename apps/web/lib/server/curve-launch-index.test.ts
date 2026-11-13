import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, toHex, zeroAddress, type Address, type Hash, type Log, type TransactionReceipt } from "viem";
import { curveAtReceipt, projectCurveReceipt } from "../launchpad/curve-receipt";
import { curveAssetsMigratedEvent, curveCreatedEvent, curveFactoryAbi, curveLpCollectedEvent, projectMigratedEvent } from "../launchpad/curve-v1";
import type { LaunchRequest } from "../launchpad/transactions";
import { curveLoopbackRequest, readCurveRuntime, type verifiedCurveRuntime } from "./curve-launch-config";
import { CurveLaunchIndex, readCurveState } from "./curve-launch-index";

const address = (number: number): Address => toHex(number, { size: 20 });
const hash = (number: number | bigint): Hash => toHex(number, { size: 32 });
const factory = address(1);
const token = address(2);
const curve = address(3);
const creator = address(4);
const ledger = address(5);
const graduationEngine = address(6);
const registry = address(7);
const newCurve = address(8);
const lpLedger = address(12);
const intentId = hash(100);
const timestamp = 1_800_000_000n;
const supply = 1_000_000n * 10n ** 18n;
const project = { token, curve, creator, intentId, supply, revenueLedger: ledger, treasury: zeroAddress,
  treasuryShareBps: 0, name: "Fixture Curve", symbol: "FXC", projectURI: "" };

function observed(number: bigint, branch: number = 0) {
  return { blockNumber: number, hash: hash(number + BigInt(branch)), timestamp };
}

function creation(blockHash = hash(11), transactionHash = hash(1000)) {
  const event = {
    address: factory, logIndex: 3, transactionHash, transactionIndex: 0, blockHash, blockNumber: 11n, removed: false,
    topics: encodeEventTopics({ abi: [curveCreatedEvent], eventName: "CurveCreated", args: { token, curve, creator } }),
    data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" },
      { type: "uint16" }, { type: "string" }, { type: "string" }, { type: "string" }],
    [intentId, supply, ledger, zeroAddress, 0, project.name, project.symbol, ""]),
  } as Log;
  const receipt = { status: "success", transactionHash, transactionIndex: 0, blockHash, blockNumber: 11n, from: creator, to: factory,
    logs: [event] } as TransactionReceipt;
  return { receipt, event: { ...event, args: project } };
}

function env(path: string) {
  return { RMT_CURVE_ENABLED: "true", RMT_CURVE_RPC_URL: "http://127.0.0.1:8545/", RMT_CURVE_DATABASE_PATH: path,
    RMT_CURVE_FACTORY_ADDRESS: factory, RMT_CURVE_FACTORY_RUNTIME_HASH: hash(1), RMT_CURVE_GRADUATION_RUNTIME_HASH: hash(2),
    RMT_CURVE_GUARD_RUNTIME_HASH: hash(3), RMT_CURVE_REGISTRY_RUNTIME_HASH: hash(4), RMT_CURVE_START_BLOCK: "10" };
}

test("curve preview fails closed on hosted, credentialed, and cross-origin access", () => {
  const local = env(join(tmpdir(), "rmt-curve-config.sqlite"));
  assert.ok(readCurveRuntime(local));
  assert.equal(readCurveRuntime({ ...local, VERCEL: "1" }), null);
  assert.equal(readCurveRuntime({ ...local, RMT_CURVE_ENABLED: "false" }), null);
  assert.throws(() => readCurveRuntime({ ...local, RMT_CURVE_REGISTRY_RUNTIME_HASH: "" }), /pinned deployment/);
  assert.throws(() => readCurveRuntime({ ...local, RMT_CURVE_RPC_URL: "https://example.org/" }), /loopback/);
  assert.throws(() => readCurveRuntime({ ...local, RMT_CURVE_RPC_URL: "http://secret@127.0.0.1:8545/" }), /loopback/);
  assert.equal(curveLoopbackRequest(new Request("http://127.0.0.1:3000/api/launchpad/curve")), true);
  assert.equal(curveLoopbackRequest(new Request("http://127.0.0.1:3000/api/launchpad/curve", { headers: { Origin: "https://example.org" } })), false);
  assert.equal(curveLoopbackRequest(new Request("https://example.org/api/launchpad/curve")), false);
});

test("curve creation projection verifies exact wallet terms and one canonical receipt log", () => {
  const { receipt } = creation();
  const deadline = 1_800_000_000;
  const request: LaunchRequest = { kind: "curve-create", chainId: 31337, from: creator, to: factory, value: "0x0",
    intentId, blockHash: hash(10), blockNumber: "0xa", deadline,
    data: encodeFunctionData({ abi: curveFactoryAbi, functionName: "create",
      args: [project.name, project.symbol, "", 0, zeroAddress, 0, intentId, BigInt(deadline)] }) };
  const projected = projectCurveReceipt(factory, receipt, request);
  assert.equal(projected.token, token);
  assert.equal(projected.totalSupply, supply.toString());
  assert.throws(() => projectCurveReceipt(factory, receipt, { ...request, intentId: hash(101) }), /reviewed request/);
  assert.throws(() => projectCurveReceipt(factory, receipt, { ...request, value: "0x1" }), /reviewed request/);
  assert.throws(() => projectCurveReceipt(factory, { ...receipt, logs: [receipt.logs[0], receipt.logs[0]] }), /duplicate/);
});

test("curve index persists exact records, handles duplicate delivery, and restores an orphaned first range only after provider recovery", async () => {
  const folder = mkdtempSync(join(tmpdir(), "rmt-curve-index-"));
  const config = readCurveRuntime(env(join(folder, "index.sqlite")))!;
  const { event, receipt } = creation();
  let branch = 0;
  let unavailable = false;
  const rpc = {
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { number: blockNumber, timestamp, hash: hash(blockNumber + (blockNumber >= 11n ? BigInt(branch) : 0n)) };
    },
    async getLogs({ address: emitter, event: selected }: { address: Address; event: { name: string } }) {
      if (unavailable) throw new Error("Provider unavailable.");
      return emitter === factory && selected.name === "CurveCreated" && branch === 0 ? [event, event] : [];
    },
    async getTransactionReceipt({ hash: transactionHash }: { hash: Hash }) {
      assert.equal(transactionHash, receipt.transactionHash);
      return receipt;
    },
    async readContract({ address: emitter, functionName, requireCanonical, blockHash }: {
      address: Address; functionName: string; requireCanonical: boolean; blockHash: Hash;
    }) {
      assert.equal(requireCanonical, true);
      assert.equal(blockHash, hash(11));
      switch (functionName) {
        case "originCurveForToken": assert.equal(emitter, factory); return curve;
        case "curve": assert.equal(emitter, ledger); return curve;
        case "factory": return factory;
        case "token": return token;
        case "creator": return creator;
        case "revenueLedger": return ledger;
        case "totalSupply": return supply;
        case "treasury": return zeroAddress;
        case "treasuryShareBps": return 0;
        default: throw new Error("Unexpected fixture call.");
      }
    },
  };
  const ready = { rpc, browser: { curve: { graduationEngine, projectRegistry: registry } } } as unknown as Awaited<ReturnType<typeof verifiedCurveRuntime>>;
  let index = new CurveLaunchIndex(config);
  try {
    assert.equal(await index.sync(ready, observed(11n)), true);
    assert.equal(index.list().length, 1);
    index.close();
    index = new CurveLaunchIndex(config);
    assert.equal(index.list({ creator })[0].transactionHash, receipt.transactionHash);
    await assert.rejects(index.sync(ready, observed(10n)), /behind/);
    branch = 500;
    unavailable = true;
    await assert.rejects(index.sync(ready, observed(11n, branch)), /Provider unavailable/);
    assert.equal(index.list().length, 1);
    unavailable = false;
    assert.equal(await index.sync(ready, observed(11n, branch)), true);
    assert.equal(index.list().length, 0);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("curve state binds public migration and proposed engine evidence to the permanent project", async () => {
  const launch = projectCurveReceipt(factory, creation().receipt);
  const proposalEngine = address(9);
  const runtime = "0x6000";
  const engineHash = keccak256(runtime);
  const evidence = { transactionHash: hash(1200), blockHash: hash(12), blockNumber: "12", logIndex: 1, transactionIndex: 2,
    fromCurve: curve, toCurve: newCurve, version: 2, backing: "0", inventory: supply.toString(), sold: "0", ledger };
  let wrongEngine = false;
  const rpc = {
    async getCode() { return runtime; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { number: blockNumber, hash: hash(blockNumber), timestamp };
    },
    async readContract({ address: emitter, functionName, args, blockHash, requireCanonical }: {
      address: Address; functionName: string; args?: readonly unknown[]; blockHash: Hash; requireCanonical: boolean;
    }) {
      assert.equal(requireCanonical, true);
      assert.equal(blockHash, hash(13));
      switch (functionName) {
        case "project": assert.deepEqual(args, [token]); return [factory, newCurve, 2, newCurve, 1n];
        case "originCurve":
        case "originCurveForToken":
        case "migrationSource":
        case "curve": return curve;
        case "migration": assert.deepEqual(args, [token, 1n]); return [1, 2, curve, newCurve, engineHash, 12n, Number(timestamp)];
        case "proposal": return [proposalEngine, hash(90), Number(timestamp) + 600, 0, 0];
        case "executionVersion": return 2;
        case "executionEngine": return wrongEngine ? proposalEngine : newCurve;
        case "executionEngineRuntimeHash": return engineHash;
        case "economicRules": return hash(81);
        case "projectRegistry": return registry;
        case "active": return emitter === newCurve;
        case "migrationCommitment": return hash(91);
        case "migratedTo": assert.equal(emitter, curve); return newCurve;
        case "suspended": return false;
        case "directory": return address(10);
        case "migrationNonce": return 1n;
        case "curveForToken":
        case "activeCurve": return newCurve;
        case "factory": return factory;
        case "token": return token;
        case "revenueLedger": return ledger;
        case "sold": return 0n;
        case "graduationSold": return 600_000n * 10n ** 18n;
        case "graduated": return false;
        case "backingReserve": assert.equal(emitter, newCurve); return 0n;
        case "totalAccrued":
        case "totalClaimed":
        case "bucketAccrued": return 0n;
        case "operatingRecipient": return address(30);
        case "futureReserveRecipient": return address(31);
        default: throw new Error("Unexpected curve state read.");
      }
    },
  };
  const ready = { rpc, browser: { curve: { graduationEngine, projectRegistry: registry } } } as unknown as Awaited<ReturnType<typeof verifiedCurveRuntime>>;
  const lifecycle = { migration: (version: number) => version === 2 ? evidence : undefined };
  const state = await readCurveState(ready, launch, observed(13n), lifecycle);
  assert.equal(state.activeCurve, newCurve);
  assert.equal(state.project?.currentVersion, 2);
  assert.equal(state.project.migrations[0].runtimeHash, engineHash);
  assert.equal(state.project.migrations[0].transactionHash, evidence.transactionHash);
  assert.equal(state.project.pending?.nextEngine, proposalEngine);
  assert.equal(state.project.eligibility, "version_unsupported");
  assert.equal(curveAtReceipt(launch, state, { blockNumber: 12n, blockHash: hash(12), transactionIndex: 1 }), curve);
  assert.equal(curveAtReceipt(launch, state, { blockNumber: 12n, blockHash: hash(12), transactionIndex: 3 }), newCurve);
  assert.throws(() => curveAtReceipt(launch, state, { blockNumber: 12n, blockHash: hash(90), transactionIndex: 3 }), /different branches/);
  await assert.rejects(readCurveState(ready, launch, observed(13n), { migration: () => undefined }), /migration evidence/);
  await assert.rejects(readCurveState(ready, launch, observed(13n), {
    migration: () => ({ ...evidence, inventory: (supply + 1n).toString() }),
  }), /migration evidence/);
  await assert.rejects(readCurveState(ready, launch, observed(13n), {
    migration: () => ({ ...evidence, sold: supply.toString(), inventory: "0" }),
  }), /migration evidence/);
  wrongEngine = true;
  await assert.rejects(readCurveState(ready, launch, observed(13n), lifecycle), /Permanent project identity/);
});

test("index binds exact migration and LP collection receipts and rolls them back without rewriting project origin", async () => {
  const folder = mkdtempSync(join(tmpdir(), "rmt-curve-transitions-"));
  const config = readCurveRuntime(env(join(folder, "index.sqlite")))!;
  const initial = creation();
  const log = (emitter: Address, height: bigint, transactionHash: Hash, logIndex: number, data: `0x${string}`, topics: Log["topics"]): Log => ({
    address: emitter, blockNumber: height, blockHash: hash(height), transactionHash, transactionIndex: 0, logIndex, data, topics, removed: false,
  });
  const migrationHash = hash(1_200);
  const migrationArgs = { token, fromCurve: curve, toCurve: newCurve, version: 2, sold: 100n, backing: 13n, inventory: supply - 100n, ledger };
  const migration = { ...log(factory, 12n, migrationHash, 2,
    encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }],
      [2, migrationArgs.sold, migrationArgs.backing, migrationArgs.inventory, ledger]),
    encodeEventTopics({ abi: [curveAssetsMigratedEvent], eventName: "CurveAssetsMigrated",
      args: { token, fromCurve: curve, toCurve: newCurve } }) as Log["topics"]), args: migrationArgs };
  const registryLog = log(registry, 12n, migrationHash, 3, encodeAbiParameters([{ type: "uint32" }], [2]),
    encodeEventTopics({ abi: [projectMigratedEvent], eventName: "ProjectMigrated",
      args: { token, index: 1n, nextEngine: newCurve } }) as Log["topics"]);
  const collectionHash = hash(1_300);
  const collectionArgs = { token, positionTokenId: 123n, ledger: lpLedger, nativeAmount: 11n, tokenAmount: 17n };
  const collection = { ...log(graduationEngine, 13n, collectionHash, 3,
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [11n, 17n]),
    encodeEventTopics({ abi: [curveLpCollectedEvent], eventName: "LpFeesCollected",
      args: { token, positionTokenId: 123n, ledger: lpLedger } }) as Log["topics"]), args: collectionArgs };
  const receiptFor = (height: bigint, transactionHash: Hash, to: Address, logs: Log[]) => ({
    ...initial.receipt, blockNumber: height, blockHash: hash(height), transactionHash, to, logs,
  });
  let branch = 0n;
  let pairMissing = true;
  const rpc = {
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { number: blockNumber, timestamp, hash: hash(blockNumber >= 12n ? blockNumber + branch : blockNumber) };
    },
    async getLogs({ event, fromBlock, toBlock }: { event: { name: string }; fromBlock: bigint; toBlock: bigint }) {
      const rows = event.name === "CurveCreated" ? [initial.event] : branch !== 0n ? []
        : event.name === "CurveAssetsMigrated" ? [migration, migration] : event.name === "LpFeesCollected" ? [collection, collection] : [];
      return rows.filter(({ blockNumber }) => blockNumber! >= fromBlock && blockNumber! <= toBlock);
    },
    async getTransactionReceipt({ hash: transactionHash }: { hash: Hash }) {
      if (transactionHash === migrationHash) return receiptFor(12n, migrationHash, registry, pairMissing ? [migration] : [migration, registryLog]);
      if (transactionHash === collectionHash) return receiptFor(13n, collectionHash, graduationEngine, [collection]);
      assert.equal(transactionHash, initial.receipt.transactionHash);
      return initial.receipt;
    },
    async readContract({ functionName }: { functionName: string }) {
      switch (functionName) {
        case "originCurveForToken":
        case "curve": return curve;
        case "factory": return factory;
        case "token": return token;
        case "creator": return creator;
        case "revenueLedger": return ledger;
        case "totalSupply": return supply;
        case "treasury": return zeroAddress;
        case "treasuryShareBps": return 0;
        default: throw new Error("Unexpected fixture call.");
      }
    },
  };
  const ready = { rpc, browser: { curve: { graduationEngine, projectRegistry: registry } } } as unknown as Awaited<ReturnType<typeof verifiedCurveRuntime>>;
  let index = new CurveLaunchIndex(config);
  try {
    assert.equal(await index.sync(ready, observed(11n)), true);
    await assert.rejects(index.sync(ready, observed(13n)), /paired canonical migration/);
    assert.equal(index.migration(token, 2), undefined);
    pairMissing = false;
    assert.equal(await index.sync(ready, observed(13n)), true);
    index.close();
    index = new CurveLaunchIndex(config);
    assert.equal(index.migration(token, 2)?.toCurve, newCurve);
    assert.deepEqual(index.collection(token)?.amounts, { native: "11", token: "17" });
    assert.equal(index.list({ token })[0].curve, curve);
    branch = 100n;
    assert.equal(await index.sync(ready, observed(13n, 100)), true);
    assert.equal(index.migration(token, 2), undefined);
    assert.equal(index.collection(token), undefined);
    assert.equal(index.list({ token })[0].transactionHash, initial.receipt.transactionHash);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
