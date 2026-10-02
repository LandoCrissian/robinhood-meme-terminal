import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Hex } from "viem";
import { RMT_LAUNCH_AUTHORITIES } from "@rmt/shared/launch-intelligence";
import { migrateMarketIndexer } from "../../../market-indexer/src/schema";
import {
  migrateLaunchStore,
  insertLaunchEvent,
  readLaunchDirectory,
  rollbackLaunchSource,
} from "../../../market-indexer/src/launch-store";
import { launchSourceManifest } from "../../../market-indexer/src/launch-sources";
import { decodeLaunchEvent } from "../../../market-indexer/src/launch-domain";
import { refreshLaunchIdentities } from "../../../market-indexer/src/launch-identity";
import {
  LaunchIndexer,
  observeLaunch,
} from "../../../market-indexer/src/launch-worker";
import { createMarketIndexerServer } from "../../../market-indexer/src/server";
import { loadMarketIndexerConfig } from "../../../market-indexer/src/config";
import type { MarketIndexerWorker } from "../../../market-indexer/src/worker";
import { readLaunchIntelligence } from "./launch-intelligence-reader";
import { launchTerminalEntry } from "../vnext/launch-presentation";

const databaseUrl = process.env.MARKET_INDEXER_DATABASE_URL;
assert.ok(
  databaseUrl,
  "A local disposable PostgreSQL database is required; this test has no skip path",
);
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
  "Never mutate a production database",
);
const { Pool } = createRequire(
  resolve(process.cwd(), "../market-indexer/package.json"),
)("pg");
let pool = new Pool({ connectionString: databaseUrl, ssl: false });
const storageSetting = process.env.MARKET_INDEXER_STORAGE_MODE ?? "durable";
assert.ok(storageSetting === "durable" || storageSetting === "rebuildable");
const storageMode = storageSetting === "rebuildable" ? "rebuildable" : "durable";
const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../market-indexer/fixtures/launch-authority-evidence.json",
    ),
    "utf8",
  ),
);
const head = BigInt(fixture.observationBlock),
  headHash = fixture.observationBlockHash as Hex;
const events = fixture.rows.map((row: any) =>
  decodeLaunchEvent(
    launchSourceManifest.sources.find((s) => s.id === row.sourceId)!,
    {
      ...row.log,
      blockNumber: BigInt(row.log.blockNumber),
      logIndex: Number(BigInt(row.log.logIndex)),
    },
    row.timestamp,
  ),
);
let failMetadata = false,
  failName = false,
  failLogs = false,
  reorg = false,
  deepReorg = false,
  logReads = 0,
  metadataBatches = 0;
function revive(value: any): any {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, revive(v)]),
    );
  return typeof value === "string" && /^\d+$/.test(value)
    ? BigInt(value)
    : value;
}
const rpc = {
  getChainId: async () => 4663,
  getBytecode: async ({ address }: { address: string }) => {
    if (address === fixture.lens.contract) return fixture.lens.code;
    const source = fixture.sources.find((s: any) => s.contract === address);
    if (!source) throw Error("CONTROLLED_UNSAMPLED_SOURCE");
    return source.code;
  },
  getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    hash:
      deepReorg || (reorg && blockNumber === head + 1n)
        ? `0x${"f".repeat(64)}`
        : headHash,
    timestamp: BigInt(Math.floor(Date.parse(fixture.capturedAt) / 1000)),
  }),
  getLogs: async () => {
    logReads++;
    if (failLogs) throw Error("CONTROLLED_RPC_UNAVAILABLE");
    return [];
  },
  multicall: async ({
    contracts,
  }: {
    contracts: { address: string; functionName: string }[];
  }) => {
    metadataBatches++;
    if (failMetadata) throw Error("CONTROLLED_METADATA_UNAVAILABLE");
    return contracts.map((c) => {
      const value = fixture.rows.find((r: any) => r.token === c.address)
        ?.identity[c.functionName === "logo" ? "artwork" : c.functionName];
      return value === undefined || (failName && c.functionName === "name")
        ? { status: "failure", error: Error("CONTROLLED_CATEGORY_UNAVAILABLE") }
        : { status: "success", result: value };
    });
  },
  readContract: async ({
    address,
    functionName,
    args,
  }: {
    address: string;
    functionName: string;
    args: any[];
  }) => {
    if (functionName === "quote")
      return launchSourceManifest.sources.find((s) => s.contract === address)!
        .quoteAsset;
    if (functionName === "viewLaunch")
      return revive(
        fixture.rows.find(
          (r: any) =>
            r.log.address === args[0] && r.sourceView?.id === String(args[1]),
        )!.sourceView,
      );
    if (functionName === "getLaunchedToken")
      return revive(
        fixture.rows.find((r: any) => r.token === args[0])!.sourceView,
      );
    if (functionName === "graduationStatus") return [0n, 100n, false];
    if (functionName === "locker")
      return "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
    if (functionName === "realQuoteReserve") return 1n;
    if (functionName === "graduationThreshold")
      return revive(
        fixture.rows.find(
          (r: any) =>
            r.sourceView?.curve?.toLowerCase() === address.toLowerCase(),
        )!.sourceView.graduationThreshold,
      );
    if (functionName === "readyToGraduate") return false;
    throw Error(`Unexpected read-only boundary ${functionName}`);
  },
} as unknown as Parameters<typeof observeLaunch>[0];
let server: ReturnType<typeof createMarketIndexerServer> | undefined;
async function main() {
  try {
    assert.deepEqual(
      RMT_LAUNCH_AUTHORITIES,
      launchSourceManifest.sources.map(({ id, source, version, contract }) => ({
        id,
        source,
        version,
        contract,
      })),
    );
    await migrateMarketIndexer(pool, storageMode);
    await migrateLaunchStore(pool);
    const launchPersistence = await pool.query(
      "SELECT relpersistence FROM pg_class WHERE relname = ANY($1::text[])",
      [["rmt_launch_sources", "rmt_launch_events", "rmt_launch_checkpoints", "rmt_launch_observations", "rmt_launch_identities", "rmt_launch_refresh_attempts"]],
    );
    assert.equal(launchPersistence.rows.length, 6);
    assert.ok(launchPersistence.rows.every((row: any) => row.relpersistence === "p"), "Launch authority must remain durable even with rebuildable pool storage");
    await pool.query(
      "TRUNCATE rmt_launch_sources,rmt_launch_events,rmt_launch_checkpoints,rmt_launch_observations,rmt_launch_identities,rmt_launch_refresh_attempts",
    );
    const client = await pool.connect();
    try {
      for (const source of launchSourceManifest.sources)
        await client.query(
          "INSERT INTO rmt_launch_sources(source_id,fingerprint,next_block,historical_next,historical_end,status) VALUES($1,'controlled',$2,$3,$2,'ready')",
          [
            source.id,
            String(head + 1n),
            String(BigInt(source.startBlock) - 1n),
          ],
        );
      for (const event of events) {
        await insertLaunchEvent(client, event);
        await insertLaunchEvent(client, event);
      }
      assert.equal(
        (await client.query("SELECT COUNT(*) AS count FROM rmt_launch_events"))
          .rows[0].count,
        String(events.length),
      );
      await assert.rejects(
        insertLaunchEvent(client, {
          ...events[0],
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
        /conflicting launch event/,
      );
      await refreshLaunchIdentities(client, rpc, head, headHash);
      const first = await readLaunchDirectory(client, { limit: 2 });
      assert.equal(first.entries.length, 2);
      assert.ok(first.nextCursor);
      const second = await readLaunchDirectory(client, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      assert.ok(
        second.entries.every(
          (e) => !first.entries.some((old) => old.launchId === e.launchId),
        ),
      );
      await assert.rejects(
        readLaunchDirectory(client, {
          cursor: first.nextCursor!,
          source: "PONS",
        }),
        /invalid launch cursor/,
      );
      const all = await readLaunchDirectory(client, { limit: 50 });
      assert.equal(all.entries.length, 10);
      assert.equal(all.status, "ready");
      const pons = all.entries.find((e) => e.sourceId === "pons-v2")!;
      const observed = await observeLaunch(
        rpc,
        launchSourceManifest.sources.find((s) => s.id === pons.sourceId)!,
        pons,
        head,
        headHash,
      );
      assert.equal(observed.state, "BONDING");
      assert.ok(observed.curve);
      const stonk = all.entries.find(
        (e) => e.sourceId === "stonk-v2-weth" && e.launchId.endsWith(":1"),
      )!;
      const stonkObserved = await observeLaunch(
        rpc,
        launchSourceManifest.sources.find((s) => s.id === stonk.sourceId)!,
        stonk,
        head,
        headHash,
      );
      assert.equal(stonkObserved.state, "GRADUATED");
      assert.equal(stonkObserved.graduatedMarkets.length, 1);
      const enrolled = all.entries.find((e) => e.sourceVersion === "V2_R2")!;
      assert.equal(
        (
          await observeLaunch(
            rpc,
            launchSourceManifest.sources.find(
              (s) => s.id === enrolled.sourceId,
            )!,
            enrolled,
            head,
            headHash,
          )
        ).relationship,
        "TOKEN_ENROLLED",
      );
      // Category failures retain proof dates and units; a failed batch does not
      // masquerade as a successful identity observation.
      await client.query(
        "UPDATE rmt_launch_identities SET refreshed_at=NOW()-INTERVAL '2 hours'",
      );
      failName = true;
      await refreshLaunchIdentities(client, rpc, head, headHash);
      failName = false;
      assert.equal(
        (await readLaunchDirectory(client, { token: pons.token })).entries[0]!
          .identity.name,
        pons.identity.name,
      );
      const before = (
        await client.query(
          "SELECT payload FROM rmt_launch_identities WHERE token=$1",
          [pons.token],
        )
      ).rows[0].payload;
      await client.query(
        "UPDATE rmt_launch_identities SET refreshed_at=NOW()-INTERVAL '2 hours'",
      );
      failMetadata = true;
      await refreshLaunchIdentities(client, rpc, head, headHash);
      assert.deepEqual(
        (
          await client.query(
            "SELECT payload FROM rmt_launch_identities WHERE token=$1",
            [pons.token],
          )
        ).rows[0].payload,
        before,
      );
      const batches = metadataBatches;
      await refreshLaunchIdentities(client, rpc, head, headHash);
      assert.equal(
        metadataBatches,
        batches,
        "Failed batch backoff prevents hot retries",
      );
      failMetadata = false;
    } finally {
      client.release();
    }
    // Restart the real connection pool and rerun both migrations: no launch is
    // removed by the independently pool-derived canonical identity catalog.
    await pool.end();
    pool = new Pool({ connectionString: databaseUrl, ssl: false });
    await migrateMarketIndexer(pool, storageMode);
    await migrateLaunchStore(pool);
    assert.equal(
      (await readLaunchDirectory(pool, { limit: 50 })).entries.length,
      10,
    );
    const readToken = "controlled-launch-read-token-00000000000001";
    const config = loadMarketIndexerConfig({
      NODE_ENV: "test",
      MARKET_INDEXER_DATABASE_URL: databaseUrl,
      MARKET_INDEXER_READ_TOKEN: readToken,
      MARKET_INDEXER_RPC_URL: "https://rpc.mainnet.chain.robinhood.com/",
      PGSSLMODE: "disable",
    });
    server = createMarketIndexerServer(pool, config, {
      status: {},
    } as MarketIndexerWorker);
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/v1/launches`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/v1/launches?cursor=YWJj`, {
          headers: { Authorization: `Bearer ${readToken}` },
        })
      ).status,
      400,
    );
    const env = {
      NODE_ENV: "test" as const,
      RMT_MARKET_INDEXER_URL: base,
      RMT_MARKET_INDEXER_READ_TOKEN: readToken,
    };
    const actual = await readLaunchIntelligence({ limit: 50 }, { env });
    assert.equal(actual.entries.length, 10);
    const row = actual.entries.find((e) => e.sourceId === "pons-v2")!;
    const seed = launchTerminalEntry(
      { context: "asset", market: row.token },
      row,
    )!;
    assert.equal(seed.address, row.token);
    assert.equal(seed.verifiedIdentity?.decimals, row.identity.decimals);
    assert.equal(
      launchTerminalEntry(
        { context: "asset", market: events[0].creation!.token },
        row,
      ),
      undefined,
      "Wrong exact token cannot inherit launch identity",
    );
    assert.equal(
      (
        await readLaunchIntelligence(
          {},
          { env: { ...env, RMT_MARKET_INDEXER_READ_TOKEN: "incorrect" } },
        )
      ).status,
      "unavailable",
    );
    // Real worker, real storage; only external read RPC is controlled. One live
    // range and one history range cover all compatible sources, not N pads.
    await pool.query(
      "TRUNCATE rmt_launch_sources,rmt_launch_events,rmt_launch_checkpoints,rmt_launch_observations,rmt_launch_identities,rmt_launch_refresh_attempts",
    );
    const worker = new LaunchIndexer(pool, rpc, 5000);
    await worker.tick(head, headHash);
    assert.equal(logReads, 2);
    const checkpoint = await pool.query("SELECT * FROM rmt_launch_checkpoints");
    assert.ok(checkpoint.rows.length > 2);
    failLogs = true;
    await worker.tick(head + 1n, headHash);
    assert.equal(
      (await pool.query("SELECT * FROM rmt_launch_checkpoints")).rows.length,
      checkpoint.rows.length,
      "RPC outage does not advance durable checkpoints",
    );
    failLogs = false;
    await new LaunchIndexer(pool, rpc, 5000).tick(head + 1n, headHash);
    assert.ok(
      (await pool.query("SELECT * FROM rmt_launch_checkpoints")).rows.length >=
        checkpoint.rows.length,
    );
    // A changed tip must remove orphaned facts and return to the real retained
    // ancestor before replay. A deeper-than-checkpoint reorg must halt safely.
    const orphan = {
      ...events[0],
      block: String(head + 1n),
      key: `controlled-orphan:${events[0].key}`,
    };
    const orphanClient = await pool.connect();
    try {
      await insertLaunchEvent(orphanClient, orphan);
    } finally {
      orphanClient.release();
    }
    reorg = true;
    await worker.tick(head + 2n, headHash);
    assert.equal(
      (
        await pool.query(
          "SELECT COUNT(*) AS count FROM rmt_launch_events WHERE event_key=$1",
          [orphan.key],
        )
      ).rows[0].count,
      "0",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT MAX(next_block)::text AS next FROM rmt_launch_sources WHERE status='indexing'",
        )
      ).rows[0].next,
      String(head + 1n),
    );
    reorg = false;
    await worker.tick(head + 2n, headHash);
    const beforeDeep = (
      await pool.query(
        "SELECT source_id,next_block::text,historical_next::text FROM rmt_launch_sources ORDER BY source_id",
      )
    ).rows;
    deepReorg = true;
    await worker.tick(head + 3n, headHash);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT source_id,next_block::text,historical_next::text FROM rmt_launch_sources ORDER BY source_id",
        )
      ).rows,
      beforeDeep,
      "Deep reorg does not invent a safe ancestor or advance",
    );
    deepReorg = false;
    const lock = await pool.connect();
    try {
      await lock.query("SELECT pg_advisory_lock(4663,78191)");
      const before = logReads;
      await Promise.all([
        worker.tick(head + 3n, headHash),
        new LaunchIndexer(pool, rpc, 5000).tick(head + 3n, headHash),
      ]);
      assert.equal(
        logReads,
        before,
        "Concurrent consumers cannot bypass durable producer lock",
      );
    } finally {
      await lock.query("SELECT pg_advisory_unlock(4663,78191)");
      lock.release();
    }
    const rollbackClient = await pool.connect();
    try {
      await rollbackLaunchSource(rollbackClient, "pons-v2", head - 1n);
      assert.ok(
        BigInt(
          (
            await rollbackClient.query(
              "SELECT next_block FROM rmt_launch_sources WHERE source_id='pons-v2'",
            )
          ).rows[0].next_block,
        ) <= head,
      );
    } finally {
      rollbackClient.release();
    }
    console.info(
      JSON.stringify({
        realProducerPersistenceAuthenticatedSearchConsumer: true,
        genuineCreationReplays: 10,
        coalescedLogReadsFirstCycle: 2,
        metadataBatches,
        restart: true,
        replay: true,
        providerRecovery: true,
        workerReorg: true,
        deepReorgHalt: true,
        concurrentProducerLock: true,
        financialRpcMethods: 0,
      }),
    );
  } finally {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.query(
      "DROP TABLE IF EXISTS rmt_launch_refresh_attempts,rmt_launch_identities,rmt_launch_observations,rmt_launch_checkpoints,rmt_launch_events,rmt_launch_sources CASCADE",
    );
    await pool.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
