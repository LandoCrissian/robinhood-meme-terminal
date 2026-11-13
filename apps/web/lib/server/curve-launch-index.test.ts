import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, toHex, zeroAddress, type Address, type Hash, type Log, type TransactionReceipt } from "viem";
import { projectCurveReceipt } from "../launchpad/curve-receipt";
import { curveCreatedEvent, curveFactoryAbi } from "../launchpad/curve-v1";
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
    async getLogs({ address: emitter }: { address: Address }) {
      if (unavailable) throw new Error("Provider unavailable.");
      return emitter === factory && branch === 0 ? [event, event] : [];
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
        case "curveForToken": assert.equal(emitter, factory); return curve;
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
  const ready = { rpc, browser: { curve: { graduationEngine } } } as unknown as Awaited<ReturnType<typeof verifiedCurveRuntime>>;
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
  const registry = address(7);
  const newEngine = address(8);
  const proposalEngine = address(9);
  let wrongEngine = false;
  const rpc = {
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { number: blockNumber, hash: hash(blockNumber), timestamp };
    },
    async readContract({ functionName, args, blockHash, requireCanonical }: {
      functionName: string; args?: readonly unknown[]; blockHash: Hash; requireCanonical: boolean;
    }) {
      assert.equal(requireCanonical, true);
      assert.equal(blockHash, hash(13));
      switch (functionName) {
        case "project": assert.deepEqual(args, [token]); return [factory, curve, 2, newEngine, 1n];
        case "migration": assert.deepEqual(args, [token, 1n]); return [1, 2, curve, newEngine, hash(80), 12n, Number(timestamp)];
        case "proposal": return [proposalEngine, hash(90), Number(timestamp) + 600, 0, 0];
        case "executionVersion": return 2;
        case "executionEngine": return wrongEngine ? proposalEngine : newEngine;
        case "executionEngineRuntimeHash": return hash(80);
        case "economicRules": return hash(81);
        case "projectRegistry": return registry;
        case "curveForToken": return curve;
        case "sold": return 0n;
        case "graduationSold": return 600_000n * 10n ** 18n;
        case "graduated": return false;
        case "backingReserve":
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
  const state = await readCurveState(ready, launch, observed(13n), undefined);
  assert.equal(state.project?.currentVersion, 2);
  assert.equal(state.project.migrations[0].runtimeHash, hash(80));
  assert.equal(state.project.pending?.nextEngine, proposalEngine);
  wrongEngine = true;
  await assert.rejects(readCurveState(ready, launch, observed(13n), undefined), /Permanent project identity/);
});
