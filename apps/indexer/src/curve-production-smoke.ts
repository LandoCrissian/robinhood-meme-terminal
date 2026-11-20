import assert from "node:assert/strict";
import type { Client } from "pg";
import { keccak256, type Address, type Hash, type PublicClient } from "viem";
import { curveProductionConfig, type CurveProductionConfig } from "./curve-production-config.js";
import { createProductionCurveIndexer, parseProductionCurveQuery } from "./curve-production.js";
import { commitProductionCurveRange, initializeProductionCurveStore, productionCurveScope,
  rollbackProductionCurve } from "./curve-production-store.js";
import { curveFixedSupplyProfile, type CurveLaunchRegistration } from "./curve-launch-evidence.js";

const address = (id: number): Address => `0x${((1n << 156n) + BigInt(id)).toString(16).padStart(40, "0")}`;
const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;
const runtime = "0x6001";
const registryRuntime = "0x6002";
export const syntheticProductionProposal = {
  schemaVersion: 1, evidence: "CANONICAL_DEPLOYMENT_AND_SOURCE_VERIFIED", chainId: 4663, profile: curveFixedSupplyProfile,
  deploymentBlock: "100", deploymentBlockHash: hash(100), deploymentTransactionHash: hash(77),
  factory: address(1), factoryRuntimeHash: keccak256(runtime), projectRegistry: address(2), registryRuntimeHash: keccak256(registryRuntime),
  operatingRecipient: address(3), reserveRecipient: address(4), sourceVerificationEvidenceSha256: "5".repeat(64), creationFeeWei: "400000000000000",
};
const proposal = syntheticProductionProposal;
export const syntheticProductionConfig = curveProductionConfig({ RMT_CURVE_PRODUCTION_BINDING: JSON.stringify(proposal) })!;
const config = syntheticProductionConfig;

function memoryStore() {
  type Record = { token: string; block: bigint; payload: string };
  const state = { next: 100n, identity: "", points: new Map<string, { block_hash: Hash; observed_at: Date }>(),
    launches: [] as Record[] };
  let snapshot: typeof state | undefined;
  const queries: string[] = [];
  let tablesPresent = true;
  let leaseAvailable = true;
  let interruptCheckpoint = false;
  const query = async (sql: string, values: unknown[] = []) => {
    queries.push(sql);
    let rows: unknown[] = [];
    if (sql === "BEGIN") snapshot = structuredClone(state);
    else if (sql === "ROLLBACK" && snapshot) Object.assign(state, snapshot);
    else if (sql === "COMMIT") snapshot = undefined;
    else if (sql.includes("to_regclass")) rows = [{ present: tablesPresent }];
    else if (sql.includes("pg_try_advisory_lock")) rows = [{ locked: leaseAvailable }];
    else if (sql.includes("INSERT INTO rmt_curve_production_bindings")) state.identity ||= String(values[1]);
    else if (sql.includes("identity = $2")) rows = [{ matches: state.identity === values[1], next_block: state.next.toString() }];
    else if (sql.includes("SELECT next_block::text")) rows = [{ next_block: state.next.toString() }];
    else if (sql.includes("SELECT block_number::text")) rows = [...state.points].sort(([first], [second]) => Number(BigInt(second) - BigInt(first)))
      .slice(0, Number(values[1])).map(([block_number, value]) => ({ block_number, ...value }));
    else if (sql.includes("SELECT block_hash")) rows = state.points.has(String(values[1])) ? [state.points.get(String(values[1]))] : [];
    else if (sql.includes("INSERT INTO rmt_curve_production_launches")) {
      if (!state.launches.some((row) => row.token === values[1])) state.launches.push({ token: String(values[1]), block: BigInt(String(values[4])), payload: String(values[6]) });
    } else if (sql.includes("SELECT payload =")) rows = [{ matches: state.launches.find((row) => row.token === values[1])?.payload === values[2] }];
    else if (sql.includes("INSERT INTO rmt_curve_production_checkpoints")) {
      if (interruptCheckpoint) throw new Error("Synthetic checkpoint interruption");
      state.points.set(String(values[1]), { block_hash: values[2] as Hash, observed_at: new Date(String(values[3])) });
    } else if (sql.includes("UPDATE rmt_curve_production_bindings")) state.next = BigInt(String(values[1]));
    else if (sql.includes("DELETE FROM rmt_curve_production_launches")) state.launches = state.launches.filter((row) => row.block <= BigInt(String(values[1])));
    else if (sql.includes("DELETE FROM rmt_curve_production_checkpoints")) {
      for (const point of state.points.keys()) if (BigInt(point) > BigInt(String(values[1]))) state.points.delete(point);
    } else if (!sql.startsWith("SET LOCAL") && !sql.includes("SELECT scope")) throw new Error("Unexpected production-store test query");
    return { rows, rowCount: rows.length };
  };
  return { db: { query } as unknown as Pick<Client, "query">, state, queries,
    absentTables: () => { tablesPresent = false; }, lostLease: () => { leaseAvailable = false; },
    interrupt: (value: boolean) => { interruptCheckpoint = value; } };
}

export function syntheticProductionRegistration(): CurveLaunchRegistration {
  return { kind: "curve-launch-1b-v2", status: "created", chainId: 4663, engineVersion: 1,
    factory: config.binding.factory, projectRegistry: config.binding.projectRegistry, token: address(5), initialCurve: address(6),
    creator: address(7), revenueLedger: address(8), totalSupplyWei: (10n ** 27n).toString(), tokenDecimals: 18,
    intentId: hash(9), name: "Synthetic production-store test", symbol: "TEST", projectURI: "", treasury: null, treasuryShareBps: 0,
    creation: { blockNumber: "100", blockHash: hash(100), timestamp: "2026-11-17T12:00:00.000Z", transactionHash: hash(10), logIndex: 4 },
    projectRegistrationLogIndex: 3, creationFee: { amountWei: "400000000000000", refundWei: "0", recipient: address(3), logIndex: 5 },
    checkpoint: { blockNumber: "100", blockHash: hash(100), timestamp: "2026-11-17T12:00:00.000Z",
      confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" } };
}

export async function testCurveProduction() {
  assert.equal(curveProductionConfig({}), null);
  for (const change of [{ chainId: 31337 }, { evidence: "PREDICTED" }, { deploymentTransactionHash: null },
    { creationFeeWei: "0" }, { sourceVerificationEvidenceSha256: null }, { reserveRecipient: address(3) }, { confirmations: 2 }]) {
    assert.throws(() => curveProductionConfig({ RMT_CURVE_PRODUCTION_BINDING: JSON.stringify({ ...proposal, ...change }) }));
  }
  assert.throws(() => curveProductionConfig({ RMT_CURVE_PRODUCTION_BINDING: "{" }));
  assert.equal(parseProductionCurveQuery(new URL("http://read.test/curve-launches?limit=50"))?.limit, 50);
  for (const path of ["/curve-launches?limit=51", "/curve-launches?limit=2&limit=3", "/curve-launches?offset=2",
    "/curve-launches?after=unknown", "/curve-launches/unknown", `/curve-launches/${address(5)}?limit=1`]) {
    assert.equal(parseProductionCurveQuery(new URL("http://read.test" + path)), null);
  }

  const missingSchema = memoryStore();
  missingSchema.absentTables();
  await assert.rejects(initializeProductionCurveStore(missingSchema.db, config), /verified backup and explicit installation/);
  assert.ok(!missingSchema.queries.some((query) => /CREATE|ALTER|DROP|INSERT|UPDATE|DELETE/.test(query)));
  const unavailableLease = memoryStore();
  unavailableLease.lostLease();
  await assert.rejects(initializeProductionCurveStore(unavailableLease.db, config), /database_writer_conflict/);

  const store = memoryStore();
  await initializeProductionCurveStore(store.db, config);
  const item = syntheticProductionRegistration();
  store.interrupt(true);
  await assert.rejects(commitProductionCurveRange(store.db, config, 100n, item.checkpoint, [item]), /interruption/);
  assert.equal(store.state.launches.length, 0);
  assert.equal(store.state.next, 100n);
  store.interrupt(false);
  await commitProductionCurveRange(store.db, config, 100n, item.checkpoint, [item, item]);
  assert.equal(store.state.launches.length, 1);
  assert.equal(store.state.next, 101n);
  await commitProductionCurveRange(store.db, config, 100n, item.checkpoint, [item]);
  assert.equal(store.state.launches.length, 1);
  await assert.rejects(commitProductionCurveRange(store.db, config, 100n, { ...item.checkpoint, blockHash: hash(999) }, [item]), /replay checkpoint/);
  await rollbackProductionCurve(store.db, productionCurveScope(config), 99n);
  assert.equal(store.state.launches.length, 0);
  assert.equal(store.state.next, 100n);

  const workerStore = memoryStore();
  let head = 120n;
  let disagreement = false;
  let outage = false;
  let replacedBlock = false;
  function rpc(peer: boolean): PublicClient {
    return {
      getChainId: async () => 4663,
      getBlockNumber: async () => {
        if (outage) { const error = new Error("Synthetic timeout"); error.name = "HttpRequestError"; throw error; }
        return head;
      },
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber,
        hash: peer && disagreement ? hash(999) : replacedBlock && blockNumber === 101n ? hash(998) : hash(Number(blockNumber)),
        timestamp: 1_795_000_000n + blockNumber, transactions: [] }),
      getCode: async ({ address: selected, blockNumber }: { address: Address; blockNumber: bigint }) =>
        blockNumber < 100n ? "0x" : selected === config.binding.factory ? runtime : registryRuntime,
      getTransactionReceipt: async () => ({ status: "success", blockNumber: 100n, blockHash: hash(100) }),
      getLogs: async () => [],
      readContract: async ({ functionName }: { functionName: string }) => ({ engineVersion: 1, projectRegistry: config.binding.projectRegistry,
        creationFeeWei: config.binding.creationFeeWei, operatingRecipient: config.binding.creationFeeRecipient,
        tokenSupply: 10n ** 27n, futureReserveRecipient: config.reserveRecipient })[functionName],
    } as unknown as PublicClient;
  }
  const primary = rpc(false), archive = rpc(true);
  let observedTime = Number(1_795_000_000n + 120n) * 1_000;
  const worker = createProductionCurveIndexer(config, workerStore.db, primary, archive, () => observedTime);
  await worker.syncOnce();
  assert.equal(worker.state().status, "ready");
  assert.equal(worker.state().checkpoint?.blockNumber, "100");
  // A DB read may straddle the freshness deadline without any writer revision.
  // Recheck status after the query, rather than publishing the pre-query "ready".
  const readyTime = observedTime;
  const point = worker.state().checkpoint!;
  const delayedReader = { query: async (sql: string) => {
    if (sql.includes("b.next_block - 1 =")) return { rows: [{ matches: true }] };
    if (sql.includes("SELECT l.payload")) {
      observedTime = Date.parse(point.timestamp) + 120_001;
      return { rows: [{ payload: item }] };
    }
    throw new Error("Unexpected delayed-read query");
  } } as unknown as Pick<Client, "query">;
  const agedRead = await worker.read(delayedReader, { token: undefined, after: undefined, limit: 25 });
  assert.equal(agedRead.status, "stale", "freshness expiry during a read is visible in the response");
  assert.equal(agedRead.checkpoint.blockHash, point.blockHash);
  assert.equal(agedRead.launches[0]?.creation.transactionHash, item.creation.transactionHash);
  observedTime = readyTime;
  const earningsReader = { query: async (sql: string) => {
    if (sql.includes("SELECT c.block_number::text")) return { rows: [{ block_number: point.blockNumber,
      block_hash: point.blockHash, observed_at: new Date(point.timestamp) }] };
    if (sql.includes("SELECT l.payload")) {
      observedTime = readyTime - 1_000; // clock rollback invalidates the verification age
      return { rows: [{ payload: item }] };
    }
    throw new Error("Unexpected delayed-earnings query");
  } } as unknown as Pick<Client, "query">;
  const clockRollbackRead = await worker.readEarnings(earningsReader, { recipient: item.creator, limit: 25 });
  assert.equal(clockRollbackRead.status, "stale", "verification-clock drift during earnings read never remains ready");
  observedTime = readyTime;
  observedTime += 121_000;
  await worker.syncOnce();
  assert.equal(worker.state().status, "stale", "successful reads of an old canonical head never imply freshness");
  observedTime -= 121_000;
  outage = true;
  await assert.rejects(worker.syncOnce(), /timeout/);
  assert.equal(worker.state().status, "stale");
  assert.equal(workerStore.state.next, 101n);
  outage = false;
  disagreement = true;
  await assert.rejects(worker.syncOnce(), /providers disagree/);
  assert.equal(worker.state().status, "unavailable");
  disagreement = false;
  head = 121n;
  await worker.syncOnce();
  assert.equal(worker.state().status, "ready");
  const restarted = createProductionCurveIndexer(config, workerStore.db, primary, archive, () => observedTime);
  await restarted.syncOnce();
  assert.equal(restarted.state().checkpoint?.blockNumber, "101");
  assert.equal(workerStore.state.next, 102n);
  replacedBlock = true;
  head = 122n;
  await restarted.syncOnce();
  assert.equal(restarted.state().checkpoint?.blockNumber, "102");
  assert.equal(workerStore.state.points.has("101"), false, "reorg removes the superseded checkpoint before replay");
  assert.equal(workerStore.state.next, 103n);
}
