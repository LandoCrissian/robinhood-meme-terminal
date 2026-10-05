import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import { LaunchIndexer, observeLaunch } from "./launch-worker.js";
import { historicalFailureDelay, nextHistoryGroup, LAUNCH_HISTORY_BUDGET } from "./launch-history-budget.js";
import { launchSourceManifest } from "./launch-sources.js";
import { launchAbi, decodeLaunchEvent } from "./launch-domain.js";
import { migrateLaunchStore, readLaunchDirectory } from "./launch-store.js";
import { migrateMarketIndexer } from "./schema.js";
import { MarketIndexerWorker } from "./worker.js";
import { loadMarketIndexerConfig } from "./config.js";
import { marketSources } from "./sources.js";

const url = process.env.MARKET_INDEXER_DATABASE_URL;
assert.ok(url, "Disposable local PostgreSQL required; there is no skip path");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Never write a production database");
const pool = new Pool({ connectionString: url, ssl: false });
const fixture = JSON.parse(readFileSync(new URL("../fixtures/launch-authority-evidence.json", import.meta.url), "utf8"));
const head = 100_000_000n;
let observedHead = head;
const hash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const timestamp = 1_791_000_000n;
// Real captured creation envelopes, relocated only in this explicitly controlled
// chain timeline. These are regression fixtures, never production records.
const logs: any[] = fixture.rows.map((row: any, i: number) => ({
  ...row.log, blockNumber: head - 12_000n + BigInt(i),
  blockHash: hash(head - 12_000n + BigInt(i)), logIndex: Number(BigInt(row.log.logIndex)),
}));
for (const id of ["pons-v2", "stonk-v2-weth"]) {
  const source = launchSourceManifest.sources.find((s) => s.id === id)!;
  const row = fixture.rows.find((r: any) => r.sourceId === id);
  const creation = decodeLaunchEvent(source, logs[fixture.rows.indexOf(row)]!, new Date(Number(timestamp) * 1000).toISOString()).creation!;
  const name = id === "pons-v2" ? "PoolGraduated" : "LaunchBonded";
  const event = launchAbi(source).find((e) => e.type === "event" && e.name === name)! as any;
  const args = id === "pons-v2" ? { token: creation.token } : { id: BigInt(creation.launchId.split(":")[1]!) };
  logs.push({ address: source.contract, topics: encodeEventTopics({ abi: [event], eventName: name, args }),
    data: encodeAbiParameters(event.inputs.filter((i: any) => !i.indexed), event.inputs.filter((i: any) => !i.indexed).map(() => 1n)),
    blockNumber: head - 7_000n, blockHash: hash(head - 7_000n), transactionHash: hash(head + BigInt(logs.length)), logIndex: 200 + logs.length });
}
let reads = 0, fail: string | null = null, hold: (() => Promise<void>) | null = null;
let reorgAt: bigint | null = null;
let denseRange = false;
const order: { from: bigint; to: bigint }[] = [];
const marketSource = marketSources.find((s) => s.id === "uniswap-v3")!;
const marketBlock = marketSource.startBlock + 20n;
const marketLog = { address: marketSource.contract,
  topics: encodeEventTopics({ abi: [marketSource.event], eventName: "PoolCreated", args: {
    token0: "0x0000000000000000000000000000000000000001", token1: "0x0000000000000000000000000000000000000002", fee: 3000,
  } }), data: encodeAbiParameters([{ type: "int24" }, { type: "address" }], [60, "0x0000000000000000000000000000000000000003"]),
  blockNumber: marketBlock, blockHash: hash(marketBlock), transactionHash: hash(marketBlock + 1n), transactionIndex: 0, logIndex: 1,
};
const rpc = {
  getChainId: async () => 4663,
  getBlockNumber: async () => observedHead + 20n,
  getBytecode: async ({ address }: any) => {
    if (address === fixture.lens.contract) return fixture.lens.code;
    const source = fixture.sources.find((s: any) => s.contract === address);
    if (!source) throw Error("CONTROLLED_UNSAMPLED_RUNTIME");
    return source.code;
  },
  getBlock: async ({ blockNumber }: any) => ({ number: blockNumber, hash: blockNumber === reorgAt ? hash(blockNumber + 1n) : hash(blockNumber), parentHash: hash(blockNumber - 1n), timestamp }),
  getLogs: async ({ address, fromBlock, toBlock }: any) => {
    if (!Array.isArray(address)) return address === marketSource.contract && fromBlock <= marketBlock && toBlock >= marketBlock ? [marketLog] : [];
    reads++; order.push({ from: fromBlock, to: toBlock });
    if (hold) { const wait = hold; hold = null; await wait(); }
    if (fail) { const name = fail; fail = null; const e = new Error("CONTROLLED_PROVIDER_FAILURE"); e.name = name; throw e; }
    if (denseRange) return Array.from({ length: 50 }, (_, i) => ({ ...logs[0], blockNumber: toBlock - BigInt(i), blockHash: hash(toBlock - BigInt(i)) }));
    const selected = logs.filter((l) => address.includes(l.address) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    return [...selected, ...selected]; // Exact duplicate replay must deduplicate.
  },
  multicall: async ({ contracts }: any) => contracts.map(() => ({ status: "failure", error: Error("CONTROLLED_OPTIONAL_METADATA") })),
  readContract: async ({ address, functionName }: any) => {
    if (functionName === "quote") return launchSourceManifest.sources.find((s) => s.contract === address)!.quoteAsset;
    throw Error("CONTROLLED_OPTIONAL_LIFECYCLE_VIEW");
  },
} as any;

async function reset() {
  await pool.query("TRUNCATE rmt_launch_events,rmt_launch_checkpoints,rmt_launch_observations,rmt_launch_identities,rmt_launch_refresh_attempts,rmt_launch_sources");
  for (const source of launchSourceManifest.sources) await pool.query(
    "INSERT INTO rmt_launch_sources(source_id,fingerprint,next_block,historical_next,historical_end) VALUES($1,$2,$3,$4,$4)",
    [source.id, keccak256(new TextEncoder().encode(JSON.stringify(source))), String(head + 1n), String(head - 1n)],
  );
  reorgAt = null;
}
async function evidence() {
  return (await pool.query("SELECT source_id,event_key,payload FROM rmt_launch_events ORDER BY source_id,event_key")).rows;
}
async function cursors() {
  return (await pool.query("SELECT source_id,historical_next::text,next_block::text FROM rmt_launch_sources ORDER BY source_id")).rows;
}
async function main() {
  try {
    await migrateMarketIndexer(pool, "durable");
    await migrateLaunchStore(pool);
    await pool.query("TRUNCATE market_pool_state,market_pools,market_indexer_sync_points,market_indexer_source_state,market_token_identity_shard,market_token_identity_catalog_state");
    await migrateMarketIndexer(pool, "durable");
    const eligible = launchSourceManifest.sources.map((s, i) => ({ source_id: s.id, historical_next: String(head - BigInt(i * 5_000)) }));
    let after: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 21; i++) {
      const group: typeof eligible = nextHistoryGroup(eligible, after);
      group.forEach((s) => seen.add(s.source_id)); after = group[0]!.source_id;
    }
    assert.equal(seen.size, 21, "Every diverged source receives a turn");
    const interleaved = eligible.map((s, i) => ({ ...s, historical_next: String(head - BigInt(i % 3 * 5_000)) }));
    let interleavedAfter: string | null = null;
    const anchors = new Set<string>();
    for (let i = 0; i < 21; i++) {
      const group: typeof interleaved = nextHistoryGroup(interleaved, interleavedAfter);
      interleavedAfter = group[0]!.source_id;
      anchors.add(interleavedAfter);
      group.forEach((s) => { s.historical_next = String(BigInt(s.historical_next) - 5_000n); });
    }
    assert.equal(anchors.size, 21, "Coalesced groups cannot skip interleaved divergent sources");
    assert.equal(historicalFailureDelay(1), 30_000);
    assert.equal(historicalFailureDelay(20), 300_000);

    await reset();
    for (const source of launchSourceManifest.sources) await pool.query(
      "UPDATE rmt_launch_sources SET historical_next=$2 WHERE source_id=$1",
      [source.id, String(BigInt(source.startBlock) - 1n)],
    );
    const completed = new LaunchIndexer(pool, rpc, 5_000);
    await completed.tick(head, hash(head));
    assert.equal(completed.canBackfill(), false, "Completed history disables background RPC admission");
    const completedReads = reads;
    await completed.backfill(head, hash(head));
    assert.equal(reads, completedReads);
    await completed.tick(head + 1n, hash(head + 1n));
    assert.equal(reads, completedReads + 1, "Live polling continues after historical completion");
    // Controlled durable cursor restoration models a replay/recovered source.
    await pool.query("UPDATE rmt_launch_sources SET historical_next=$1 WHERE source_id='pons-v1'", [String(head - 1n)]);
    await completed.tick(head + 2n, hash(head + 2n));
    assert.equal(completed.canBackfill(), true, "The ordinary cycle discovers newly pending durable history");

    await reset();
    const slow = new LaunchIndexer(pool, rpc, 5_000);
    for (let i = 0; i < 4; i++) await slow.tick(head, hash(head));
    const slowEvidence = await evidence();
    const slowDirectory = await readLaunchDirectory(pool as any, { limit: 50 });
    assert.equal(slowDirectory.entries.length, 10);
    assert.ok(slowDirectory.entries.some((e) => e.state === "BONDING"));
    assert.ok(slowDirectory.entries.some((e) => e.graduationTransaction !== null));
    assert.ok(slowDirectory.entries.some((e) => e.sourceVersion === "V1"));
    const v1 = slowDirectory.entries.find((e) => e.sourceVersion === "V1")!;
    const v1Source = launchSourceManifest.sources.find((s) => s.id === v1.sourceId)!;
    const v1Record = fixture.rows.find((r: any) => r.token === v1.token).sourceView;
    const graduatedV1 = await observeLaunch({ readContract: async ({ functionName }: any) => {
      if (functionName === "getLaunchedToken") return v1Record;
      if (functionName === "graduationStatus") return [100n, 100n, true];
      if (functionName === "locker") return "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
      throw Error("Unexpected V1 view");
    } } as any, v1Source, v1, head, hash(head));
    assert.equal(graduatedV1.state, "GRADUATED");
    assert.deepEqual(graduatedV1.graduatedMarkets, [v1.initialMarket]);
    assert.equal(graduatedV1.graduationTransaction, null, "V1 threshold views never invent migration transactions");

    await reset();
    const fast = new LaunchIndexer(pool, rpc, 5_000);
    await fast.tick(head, hash(head));
    await fast.backfill(head, hash(head));
    assert.deepEqual(await evidence(), slowEvidence, "Multiple historical ranges produce exactly the same canonical event payloads");
    await fast.tick(head, hash(head)); // Resolve the same optional identity enrichment boundary.
    assert.deepEqual((await readLaunchDirectory(pool as any, { limit: 50 })).entries, slowDirectory.entries);
    const activeCursors = (await cursors()).filter((s) => fixture.sources.some((f: any) => f.id === s.source_id));
    assert.ok(activeCursors.every((s) => BigInt(s.historical_next) <= head - 20_001n));

    // Restart continues from committed cursor; does not jump or duplicate evidence.
    const beforeRestart = await cursors();
    const restarted = new LaunchIndexer(pool, rpc, 5_000);
    await restarted.tick(head, hash(head));
    await restarted.backfill(head, hash(head));
    assert.deepEqual(await evidence(), slowEvidence);
    const afterRestart = await cursors();
    for (const s of activeCursors) assert.ok(BigInt(afterRestart.find((r) => r.source_id === s.source_id)!.historical_next) < BigInt(beforeRestart.find((r) => r.source_id === s.source_id)!.historical_next));

    await reset();
    const dense = new LaunchIndexer(pool, rpc, 5_000);
    await dense.tick(head, hash(head));
    const beforeSplit = await cursors();
    denseRange = true; await dense.backfill(head, hash(head)); denseRange = false;
    assert.deepEqual(await cursors(), beforeSplit, "RPC work quota splits a dense range without advancing");
    const nextRead = order.length;
    await dense.backfill(head, hash(head));
    assert.equal(order[nextRead]!.to - order[nextRead]!.from + 1n, 2_500n);
    assert.deepEqual(await evidence(), slowEvidence, "Smaller contiguous ranges preserve the canonical directory");

    // A mid-transaction crash must leave both evidence and cursor unchanged.
    await reset();
    await pool.query("UPDATE rmt_launch_sources SET historical_next=$1", [String(head - 10_001n)]);
    const beforeCrash = await cursors();
    const crashingPool = { connect: async () => {
      const client = await pool.connect(); let crashed = false;
      return { query: async (sql: string, params: any[]) => {
        if (!crashed && sql.startsWith("UPDATE rmt_launch_sources SET historical_next=")) { crashed = true; throw Error("CONTROLLED_CRASH_BEFORE_CURSOR"); }
        return client.query(sql, params);
      }, release: () => client.release() };
    } } as unknown as Pool;
    const crashing = new LaunchIndexer(crashingPool, rpc, 5_000);
    await crashing.tick(head, hash(head));
    assert.deepEqual(await cursors(), beforeCrash);
    assert.equal((await evidence()).length, 0);
    const resumed = new LaunchIndexer(pool, rpc, 5_000);
    await resumed.tick(head, hash(head));
    await resumed.backfill(head, hash(head));
    assert.ok((await evidence()).length >= 10);

    // A queued live tick takes the next slot, ahead of another historical range.
    await reset();
    const priority = new LaunchIndexer(pool, rpc, 5_000);
    await priority.tick(head, hash(head));
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((r) => { entered = r; });
    hold = () => { entered(); return new Promise<void>((r) => { release = r; }); };
    const history = priority.backfill(head, hash(head)); await enteredPromise;
    const start = performance.now(), beforeLive = order.length;
    const live = priority.tick(head + 1n, hash(head + 1n)); release();
    await Promise.all([history, live]);
    assert.equal(order[beforeLive]!.from, head + 1n, "Live RPC precedes the next historical range");
    const liveWaitMs = performance.now() - start;

    // Historical provider failures preserve committed evidence and back off;
    // live reads continue without attempting the failed history lane.
    for (const [index, name] of ["Http429", "Http503", "TimeoutError", "RpcError"].entries()) {
      const worker = new LaunchIndexer(pool, rpc, 5_000);
      await worker.tick(head + 1n, hash(head + 1n));
      const before = await cursors(), records = await evidence(), failureHead = head + 10n + BigInt(index);
      fail = name; await worker.backfill(failureHead, hash(failureHead));
      assert.equal(worker.canBackfill(), false);
      assert.deepEqual(await cursors(), before);
      assert.deepEqual(await evidence(), records);
      const count = reads;
      await worker.backfill(failureHead, hash(failureHead)); assert.equal(reads, count);
      await worker.tick(failureHead, hash(failureHead));
      assert.equal(reads, count + 1, "Live progresses during history backoff");
    }

    // Same shallow reorg under one-range and accelerated scheduling.
    async function reorgReplay(accelerated: boolean) {
      await reset();
      const worker = new LaunchIndexer(pool, rpc, 5_000);
      await worker.tick(head, hash(head));
      await worker.tick(head + 1n, hash(head + 1n));
      reorgAt = head + 1n;
      if (accelerated) await worker.backfill(head + 2n, hash(head + 2n));
      else await worker.tick(head + 2n, hash(head + 2n));
      return { cursors: await cursors(), events: await evidence() };
    }
    assert.deepEqual(await reorgReplay(true), await reorgReplay(false));
    reorgAt = null;

    // Real ordinary worker with controlled read-only RPC boundaries; all seven
    // durable pool checkpoints must advance while the history lane is active.
    const marketConfig = loadMarketIndexerConfig({ ...process.env,
      MARKET_INDEXER_DATABASE_URL: url, DATABASE_URL: "", EXTERNAL_ORIGIN_DATABASE_URL: "",
      MARKET_INDEXER_RPC_URL: "https://controlled-rpc.invalid/", PGSSLMODE: "disable",
      MARKET_INDEXER_READ_TOKEN: "controlled-history-read-token-000000000001",
    });
    const market = new MarketIndexerWorker(pool, marketConfig);
    Object.assign(market, { rpc, historyRpc: rpc });
    market.status.verifiedSources = marketSources.map((s) => s.id);
    const initial = (await pool.query("SELECT source_id,next_block::text FROM market_indexer_source_state ORDER BY source_id")).rows;
    const poolsBefore = Number((await pool.query("SELECT count(*) FROM market_pools")).rows[0].count);
    const historyWorker = new LaunchIndexer(pool, rpc, 5_000);
    await historyWorker.tick(head, hash(head));
    Object.assign(market, { launchIndexer: historyWorker });
    const liveReadsBefore = order.filter((r) => r.from > head).length;
    for (let i = 0; i < 2; i++) {
      observedHead = head + BigInt(i + 1);
      await Promise.all([market.tick(), historyWorker.backfill(observedHead, hash(observedHead))]);
    }
    assert.ok(order.filter((r) => r.from > head).length >= liveReadsBefore + 2, "Live launch reads continue while ordinary markets and history advance");
    const final = (await pool.query("SELECT source_id,next_block::text FROM market_indexer_source_state ORDER BY source_id")).rows;
    assert.equal(final.length, 7); assert.equal(market.status.lastError, null);
    assert.ok(final.every((r, i) => BigInt(r.next_block) === BigInt(initial[i].next_block) + 10_000n));
    const poolsAfter = Number((await pool.query("SELECT count(*) FROM market_pools")).rows[0].count);
    assert.ok(poolsAfter > poolsBefore, "Pool reconstruction continues concurrently");
    market.stop();
    console.info(JSON.stringify({ evidenceClass: "CONTROLLED_REGRESSION_NOT_PRODUCTION_ACCEPTANCE", pass: true,
      canonicalCreationEnvelopes: 10, lifecycleEvents: 2, fairSources: seen.size,
      checkpointAdvancement: final, poolsBefore, poolsAfter, liveWaitMs, providerFailureCases: 4, cyclePhasesMs: market.status.lastCyclePhasesMs,
      budget: LAUNCH_HISTORY_BUDGET, restart: true, crashAtomicity: true, reorgEquivalence: true }));
  } finally { await pool.end(); }
}
await main();
