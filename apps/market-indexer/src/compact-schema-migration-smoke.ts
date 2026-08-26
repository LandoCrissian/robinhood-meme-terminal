import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import pg from "pg";
import {
  inspectCompactMigrationStatus,
  localMigrationTestDatabaseUrl,
  preflightCompactMigration,
  runCompactMigrationRecovery,
  runCompactPreserveProgressMigration,
  TEMP_WAL_SAFETY_RESERVE_BYTES,
  type CompactMigrationSafety
} from "./compact-schema-migration.js";
import { hexBytes, packPoolProvenance, sourceCodeForId } from "./compact-storage.js";
import type { MarketIndexerConfig } from "./config.js";
import {
  migrateMarketIndexer,
  retainLatestSourceSyncPoints,
  rollbackSourceAfter
} from "./schema.js";
import { createMarketIndexerServer } from "./server.js";
import {
  MARKET_INDEXER_CHAIN_ID,
  MARKET_INDEXER_SCHEMA_VERSION,
  MARKET_SOURCE_MANIFEST_HASH,
  marketSources
} from "./sources.js";
import type { MarketIndexerWorker } from "./worker.js";

assert.throws(
  () => localMigrationTestDatabaseUrl({
    MARKET_INDEXER_MIGRATION_TEST_DATABASE_URL: "postgresql://example.com/rmt",
    MARKET_INDEXER_MIGRATION_TEST_ALLOW_LOCAL: "1"
  }),
  /loopback PostgreSQL only/
);

const databaseUrl = localMigrationTestDatabaseUrl();
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 2 });
const safety: CompactMigrationSafety = Object.freeze({
  writerStopped: true,
  shadowMode: true,
  authoritative: false,
  servingProductionTraffic: false,
  activationLocked: true,
  oldRelationCleanupAuthorized: true,
  configuredLimitBytes: 367_001_600
});

const sourceText = `CASE
  WHEN i % 10000 < 1 THEN 'sushiswap-v2'
  WHEN i % 10000 < 45 THEN 'sushiswap-v3'
  WHEN i % 10000 < 633 THEN 'uniswap-v2'
  WHEN i % 10000 < 6363 THEN 'uniswap-v3'
  WHEN i % 10000 < 9993 THEN 'uniswap-v4'
  WHEN i % 10000 < 9997 THEN 'up-v2'
  ELSE 'up-cl' END`;
const sourceCode = `CASE
  WHEN i % 10000 < 1 THEN 1 WHEN i % 10000 < 45 THEN 2
  WHEN i % 10000 < 633 THEN 3 WHEN i % 10000 < 6363 THEN 4
  WHEN i % 10000 < 9993 THEN 5 WHEN i % 10000 < 9997 THEN 6 ELSE 7 END`;
const protocol = `CASE WHEN i % 10000 < 45 THEN 'sushiswap'
  WHEN i % 10000 < 9993 THEN 'uniswap' ELSE 'up' END`;
const version = `CASE WHEN i % 10000 < 1 THEN 2 WHEN i % 10000 < 45 THEN 3
  WHEN i % 10000 < 633 THEN 2 WHEN i % 10000 < 6363 THEN 3
  WHEN i % 10000 < 9993 THEN 4 WHEN i % 10000 < 9997 THEN 2 ELSE 3 END`;
const rawPool = `CASE WHEN (${version})=4 THEN md5('pool:'||i::text)||md5('pool:b:'||i::text)
  ELSE substring(md5('pool:'||i::text)||md5('pool:b:'||i::text) FROM 1 FOR 40) END`;
const token0 = `CASE WHEN i=6419 THEN 'e934e36a439c94017b64a3fece66af12099abf50'
  ELSE substring(md5('token0:'||(i/3)::text)||md5('token0:b:'||(i/3)::text) FROM 1 FOR 40) END`;
const token1 = `substring(md5('token1:'||(i/5+100000000)::text)||md5('token1:b:'||(i/5+100000000)::text) FROM 1 FOR 40)`;

async function resetV2Fixture(rows: number) {
  await pool.query(`DROP TABLE IF EXISTS
    market_indexer_compact_migration_state,
    market_pool_state_compact_v3,market_indexer_sync_points_compact_v3,market_pools_compact_v3,
    market_pool_state_v2_old,market_indexer_sync_points_v2_old,market_pools_v2_old,
    market_token_identity_catalog_state,market_token_identity_shard,
    market_pool_state,market_pools,market_indexer_sync_points,market_indexer_source_state CASCADE`);
  await pool.query(`
    CREATE UNLOGGED TABLE market_indexer_source_state(
      chain_id BIGINT NOT NULL,source_id TEXT NOT NULL,protocol TEXT NOT NULL,
      protocol_version INTEGER NOT NULL,source_kind TEXT NOT NULL,contract_address TEXT NOT NULL,
      start_block BIGINT NOT NULL,next_block BIGINT NOT NULL,runtime_code_hash TEXT NOT NULL,
      deployment_transaction TEXT NOT NULL,manifest_hash TEXT NOT NULL,schema_version INTEGER NOT NULL,
      status TEXT NOT NULL,last_sync_at TIMESTAMPTZ,last_error TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(chain_id,source_id),CHECK(chain_id=4663),CHECK(schema_version>0));
    CREATE UNLOGGED TABLE market_indexer_sync_points(
      chain_id BIGINT NOT NULL,source_id TEXT NOT NULL,block_number BIGINT NOT NULL,
      block_hash TEXT NOT NULL,parent_hash TEXT NOT NULL,indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(chain_id,source_id,block_number),
      FOREIGN KEY(chain_id,source_id) REFERENCES market_indexer_source_state(chain_id,source_id) ON DELETE CASCADE);
    CREATE UNLOGGED TABLE market_pools(
      chain_id BIGINT NOT NULL,source_id TEXT NOT NULL,protocol TEXT NOT NULL,protocol_version INTEGER NOT NULL,
      pool_key TEXT NOT NULL,pool_address TEXT,token0 TEXT NOT NULL,token1 TEXT NOT NULL,stable BOOLEAN,
      fee INTEGER,tick_spacing INTEGER,hooks TEXT,transaction_hash TEXT NOT NULL,transaction_index INTEGER NOT NULL,
      log_index INTEGER NOT NULL,block_number BIGINT NOT NULL,block_hash TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(chain_id,source_id,pool_key),
      UNIQUE(chain_id,transaction_hash,log_index),
      FOREIGN KEY(chain_id,source_id) REFERENCES market_indexer_source_state(chain_id,source_id) ON DELETE CASCADE);
    CREATE UNLOGGED TABLE market_pool_state(
      chain_id BIGINT NOT NULL,source_id TEXT NOT NULL,pool_key TEXT NOT NULL,status TEXT NOT NULL,
      live_fee INTEGER,fee_denominator INTEGER,gauge_address TEXT,gauge_alive BOOLEAN,gauge_weight NUMERIC(78,0),
      gauge_claimable NUMERIC(78,0),fees_address TEXT,bribe_address TEXT,last_error TEXT,
      observed_block BIGINT NOT NULL,observed_block_hash TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(chain_id,source_id,pool_key),
      FOREIGN KEY(chain_id,source_id,pool_key) REFERENCES market_pools(chain_id,source_id,pool_key) ON DELETE CASCADE);
    CREATE INDEX market_pools_tokens_idx ON market_pools(chain_id,token0,token1);
    CREATE INDEX market_pools_block_idx ON market_pools(chain_id,source_id,block_number DESC,transaction_index DESC,log_index DESC);
    CREATE INDEX market_pool_state_refresh_idx ON market_pool_state(observed_block,observed_at);`);
  for (const source of marketSources) {
    await pool.query(`INSERT INTO market_indexer_source_state(
      chain_id,source_id,protocol,protocol_version,source_kind,contract_address,start_block,next_block,
      runtime_code_hash,deployment_transaction,manifest_hash,schema_version,status,last_sync_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,2,'backfilling',NOW())`, [
      MARKET_INDEXER_CHAIN_ID, source.id, source.protocol, source.version, source.kind,
      source.contract.toLowerCase(), source.startBlock.toString(), (source.startBlock + 123_456n).toString(),
      source.runtimeCodeHash, source.deploymentTransaction, MARKET_SOURCE_MANIFEST_HASH
    ]);
  }
  await pool.query(`INSERT INTO market_pools(
      chain_id,source_id,protocol,protocol_version,pool_key,pool_address,token0,token1,stable,fee,
      tick_spacing,hooks,transaction_hash,transaction_index,log_index,block_number,block_hash)
    SELECT 4663,${sourceText},${protocol},${version},'0x'||(${rawPool}),
      CASE WHEN (${version})=4 THEN NULL ELSE '0x'||(${rawPool}) END,
      '0x'||(${token0}),'0x'||(${token1}),CASE WHEN (${sourceCode})=6 THEN i%2=0 ELSE NULL END,
      CASE WHEN (${sourceCode}) IN(2,4,5) THEN 3000 ELSE NULL END,
      CASE WHEN (${sourceCode}) IN(2,4,5,7) THEN 60 ELSE NULL END,
      CASE WHEN (${sourceCode})=5 THEN '0x'||substring(md5('hooks:'||i::text)||md5('hooks:b:'||i::text) FROM 1 FOR 40) ELSE NULL END,
      '0x'||md5('tx:'||i::text)||md5('tx:b:'||i::text),(i/3%50)::integer,(i%3)::integer,
      (1000000+i/3)::bigint,'0x'||md5('block:'||(i/3)::text)||md5('block:b:'||(i/3)::text)
    FROM generate_series(1,$1::integer) generated(i)`, [rows]);
  await pool.query(`INSERT INTO market_indexer_sync_points(chain_id,source_id,block_number,block_hash,parent_hash)
    SELECT 4663,s.source_id,s.start_block+i,
      '0x'||md5('sync:block:'||s.source_id||':'||i)||md5('sync:block:b:'||s.source_id||':'||i),
      '0x'||md5('sync:parent:'||s.source_id||':'||i)||md5('sync:parent:b:'||s.source_id||':'||i)
    FROM market_indexer_source_state s CROSS JOIN generate_series(1,80) i`);
  await pool.query(`INSERT INTO market_pool_state(
      chain_id,source_id,pool_key,status,live_fee,fee_denominator,observed_block,observed_block_hash)
    SELECT chain_id,source_id,pool_key,'ready',30,
      CASE WHEN source_id='up-v2' THEN 10000 ELSE 1000000 END,block_number,block_hash
    FROM market_pools WHERE source_id IN('up-v2','up-cl') LIMIT 4`);
  await pool.query("VACUUM (ANALYZE) market_pools");
}

async function v2Restored(expectedRows: number) {
  const result = await pool.query<{ rows: string; version: number; source_code: boolean; indexes: string; artifacts: string }>(`
    SELECT (SELECT COUNT(*) FROM market_pools)::text AS rows,
      (SELECT MIN(schema_version) FROM market_indexer_source_state) AS version,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='market_indexer_source_state' AND column_name='source_code') AS source_code,
      (SELECT COUNT(*) FROM pg_indexes WHERE tablename='market_pools')::text AS indexes,
      (SELECT COUNT(*) FROM pg_class WHERE relname LIKE '%compact_v3' OR relname LIKE '%v2_old'
        OR relname='market_indexer_compact_migration_state')::text AS artifacts`);
  assert.equal(result.rows[0]?.rows, String(expectedRows));
  assert.equal(result.rows[0]?.version, 2);
  assert.equal(result.rows[0]?.source_code, false);
  assert.equal(result.rows[0]?.indexes, "4");
  assert.equal(result.rows[0]?.artifacts, "0");
}

try {
  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, {
      failurePoint: "after-source-code-addition",
      abruptLoss: true
    }),
    /synthetic abrupt loss after source code addition/
  );
  const afterUncommittedSourceCode = await pool.connect();
  try {
    assert.equal((await inspectCompactMigrationStatus(afterUncommittedSourceCode)).phase, "V2_CLEAN");
  } finally {
    afterUncommittedSourceCode.release();
  }
  assert.equal((await runCompactMigrationRecovery(pool, safety, "ROLLBACK_TO_V2")).phase, "V2_CLEAN");
  assert.equal((await runCompactMigrationRecovery(pool, safety, "ROLLBACK_TO_V2")).phase, "V2_CLEAN");

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, {
      failurePoint: "after-empty-stage",
      abruptLoss: true
    }),
    /synthetic abrupt loss after empty stage/
  );
  const preparedClient = await pool.connect();
  try {
    const prepared = await inspectCompactMigrationStatus(preparedClient);
    assert.equal(prepared.phase, "V3_STAGING_PREPARED");
    assert.equal(prepared.restartEligible, false);
    const protections = await preparedClient.query<{ old_pk: boolean; compact_pk: boolean; compact_event: boolean }>(`
      SELECT
        EXISTS(SELECT 1 FROM pg_constraint WHERE conname='market_pools_pkey') AS old_pk,
        EXISTS(SELECT 1 FROM pg_constraint WHERE conname='market_pools_compact_v3_pkey') AS compact_pk,
        EXISTS(SELECT 1 FROM pg_constraint WHERE conname='market_pools_compact_v3_event_key') AS compact_event`);
    assert.equal(protections.rows[0]?.old_pk, true);
    assert.equal(protections.rows[0]?.compact_pk, true);
    assert.equal(protections.rows[0]?.compact_event, true);
  } finally {
    preparedClient.release();
  }
  assert.equal((await runCompactMigrationRecovery(pool, safety, "ROLLBACK_TO_V2")).phase, "V2_CLEAN");
  await v2Restored(2_000);

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, { failurePoint: "after-predrop", abruptLoss: true }),
    /synthetic abrupt loss after predrop/
  );
  const predroppedClient = await pool.connect();
  try {
    assert.equal((await inspectCompactMigrationStatus(predroppedClient)).phase, "V2_INDEXES_PREDROPPED");
  } finally {
    predroppedClient.release();
  }
  assert.equal((await runCompactMigrationRecovery(pool, safety, "RESUME_PRE_CUTOVER")).phase, "V3_FINALIZED");

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, { failurePoint: "after-populate", abruptLoss: true }),
    /synthetic abrupt loss after populate/
  );
  const populatedClient = await pool.connect();
  try {
    assert.equal((await inspectCompactMigrationStatus(populatedClient)).phase, "V3_STAGING_POPULATED");
  } finally {
    populatedClient.release();
  }
  assert.equal((await runCompactMigrationRecovery(pool, safety, "RESUME_PRE_CUTOVER")).phase, "V3_FINALIZED");

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, { failurePoint: "after-cutover", abruptLoss: true }),
    /synthetic abrupt loss after cutover/
  );
  const cutoverClient = await pool.connect();
  try {
    assert.equal((await inspectCompactMigrationStatus(cutoverClient)).phase, "V3_CUTOVER_MARKER_3001");
  } finally {
    cutoverClient.release();
  }
  assert.equal((await runCompactMigrationRecovery(pool, safety, "ROLLBACK_TO_V2")).phase, "V2_CLEAN");
  await v2Restored(2_000);

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, { failurePoint: "after-cutover", abruptLoss: true }),
    /synthetic abrupt loss after cutover/
  );
  assert.equal((await runCompactMigrationRecovery(pool, safety, "RESUME_VALIDATED_CUTOVER")).phase, "V3_FINALIZED");

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, {
      failurePoint: "after-cutover-validation",
      abruptLoss: true
    }),
    /synthetic abrupt loss after cutover validation/
  );
  const oldPresentClient = await pool.connect();
  try {
    assert.equal((await inspectCompactMigrationStatus(oldPresentClient)).phase, "V3_OLD_RELATIONS_PRESENT");
  } finally {
    oldPresentClient.release();
  }
  assert.equal((await runCompactMigrationRecovery(pool, safety, "RESUME_VALIDATED_CUTOVER")).phase, "V3_FINALIZED");

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, { failurePoint: "after-old-cleanup", abruptLoss: true }),
    /synthetic abrupt loss after old cleanup/
  );
  const cleanedClient = await pool.connect();
  try {
    const cleaned = await inspectCompactMigrationStatus(cleanedClient);
    assert.equal(cleaned.phase, "V3_OLD_RELATIONS_CLEANED");
    assert.equal(cleaned.oldRelationsPresent, false);
    assert.equal(cleaned.restartEligible, false);
    const sanitizedStatus = JSON.stringify(cleaned);
    assert.equal(sanitizedStatus.includes("postgresql://"), false);
    assert.equal(sanitizedStatus.includes("MARKET_INDEXER_READ_TOKEN"), false);
  } finally {
    cleanedClient.release();
  }
  await assert.rejects(
    runCompactMigrationRecovery(pool, safety, "ROLLBACK_TO_V2"),
    /rollback to v2 is impossible after old-relation cleanup/
  );
  assert.equal((await runCompactMigrationRecovery(pool, safety, "FINALIZE_CLEANED_V3")).phase, "V3_FINALIZED");
  assert.equal((await runCompactMigrationRecovery(pool, safety, "FINALIZE_CLEANED_V3")).phase, "V3_FINALIZED");

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, { failurePoint: "after-empty-stage", abruptLoss: true }),
    /synthetic abrupt loss/
  );
  await pool.query("DROP TABLE market_pool_state_compact_v3");
  const corruptClient = await pool.connect();
  try {
    assert.equal((await inspectCompactMigrationStatus(corruptClient)).phase, "UNKNOWN_UNSAFE");
  } finally {
    corruptClient.release();
  }
  await assert.rejects(
    runCompactMigrationRecovery(pool, safety, "ROLLBACK_TO_V2"),
    /UNKNOWN_UNSAFE/
  );

  await resetV2Fixture(2_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, { failurePoint: "after-predrop", abruptLoss: true }),
    /synthetic abrupt loss/
  );
  await pool.query("UPDATE market_indexer_source_state SET next_block=next_block+1 WHERE source_id='uniswap-v4'");
  await assert.rejects(
    runCompactMigrationRecovery(pool, safety, "RESUME_PRE_CUTOVER"),
    /UNKNOWN_UNSAFE|checkpoints moved/
  );

  await resetV2Fixture(10_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, {
      ...safety,
      oldRelationCleanupAuthorized: false
    }),
    /old-relation cleanup authorization is required/
  );
  await assert.rejects(
    migrateMarketIndexer(pool, "rebuildable"),
    /schema v2 requires the reviewed compact preserve-progress migration/
  );
  await pool.query("UPDATE market_indexer_source_state SET schema_version=3001");
  await assert.rejects(
    migrateMarketIndexer(pool, "rebuildable"),
    /migration is incomplete; writer must remain stopped/
  );
  await pool.query("UPDATE market_indexer_source_state SET schema_version=2");
  const client = await pool.connect();
  try {
    const refused = await preflightCompactMigration(client, { ...safety, configuredLimitBytes: 1 });
    assert.equal(refused.safe, false);
  } finally {
    client.release();
  }
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, "after-stage"),
    /synthetic failure after stage/
  );
  await v2Restored(10_000);

  await resetV2Fixture(10_000);
  await assert.rejects(
    runCompactPreserveProgressMigration(pool, safety, "after-cutover"),
    /synthetic failure after cutover/
  );
  await v2Restored(10_000);

  const representativeRows = Number(process.env.MARKET_INDEXER_MIGRATION_TEST_ROWS ?? "260000");
  assert(Number.isSafeInteger(representativeRows) && representativeRows >= 100_000 && representativeRows <= 500_000);
  await resetV2Fixture(representativeRows);
  const beforeCheckpoints = await pool.query<{ source_id: string; next_block: string }>(
    "SELECT source_id,next_block::text FROM market_indexer_source_state ORDER BY source_id"
  );
  const result = await runCompactPreserveProgressMigration(pool, safety);
  assert.equal(result.poolCount, representativeRows);
  assert(result.preflight.safe);
  assert(result.preparedBytes >= result.preflight.logicalBytes);
  assert(result.stagedBytes + TEMP_WAL_SAFETY_RESERVE_BYTES <= result.preflight.warningThresholdBytes);
  assert(result.postCleanupBytes < result.preflight.logicalBytes);
  assert(result.reclaimedBytes > 0);

  const compact = await pool.query<{
    version: number;
    pools: string;
    old_relations: string;
    source_codes: string;
    v4_stonk: string;
  }>(`SELECT
    (SELECT MIN(schema_version) FROM market_indexer_source_state) AS version,
    (SELECT COUNT(*) FROM market_pools)::text AS pools,
    (SELECT COUNT(*) FROM pg_class WHERE relname LIKE '%v2_old')::text AS old_relations,
    (SELECT COUNT(DISTINCT source_code) FROM market_indexer_source_state)::text AS source_codes,
    (SELECT COUNT(*) FROM market_pools WHERE source_code=5
      AND octet_length(pool_key)=32
      AND (token0=decode('e934e36a439c94017b64a3fece66af12099abf50','hex')
        OR token1=decode('e934e36a439c94017b64a3fece66af12099abf50','hex')))::text AS v4_stonk`);
  assert.equal(compact.rows[0]?.version, MARKET_INDEXER_SCHEMA_VERSION);
  assert.equal(compact.rows[0]?.pools, String(representativeRows));
  assert.equal(compact.rows[0]?.old_relations, "0");
  assert.equal(compact.rows[0]?.source_codes, "7");
  assert.equal(compact.rows[0]?.v4_stonk, "1");
  const afterCheckpoints = await pool.query<{ source_id: string; next_block: string }>(
    "SELECT source_id,next_block::text FROM market_indexer_source_state ORDER BY source_id"
  );
  assert.deepEqual(afterCheckpoints.rows, beforeCheckpoints.rows);

  await migrateMarketIndexer(pool, "rebuildable");
  const readToken = "migration-smoke-read-token-000000000000001";
  const server = createMarketIndexerServer(
    pool,
    {
      databaseUrl,
      rpcUrl: "https://example.invalid",
      readToken,
      storageMode: "rebuildable",
      confirmations: 20,
      batchSize: 5_000,
      enrichmentBatchSize: 25,
      tokenIdentityBatchSize: 250,
      pollIntervalMs: 5_000,
      heartbeatIntervalMs: 60_000,
      databasePoolSize: 2,
      databaseSizeLimitBytes: safety.configuredLimitBytes,
      databaseSsl: false,
      port: 3_003,
      positionGuardEvaluator: null
    } satisfies MarketIndexerConfig,
    { status: {
      running: false,
      cycleSequence: 0,
      verifiedSources: [],
      verifiedDependencies: [],
      indexedThrough: Object.fromEntries(marketSources.map((candidate) => [candidate.id, null])),
      lastSyncAt: null,
      lastError: null,
      lastCycleStartedAt: null,
      lastCycleCompletedAt: null,
      lastCycleDurationMs: null,
      lastFinalizedHead: null,
      telemetry: null
    } } as unknown as MarketIndexerWorker
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/pools?limit=2&token=0xe934e36a439c94017b64a3fece66af12099abf50`, // gitleaks:allow -- public test-only contract
      { headers: { authorization: `Bearer ${readToken}` } }
    );
    assert.equal(response.status, 200);
    const inventory = await response.json() as {
      chainId: number;
      mode: string;
      authoritative: boolean;
      pools: Array<{
        version: number;
        poolKey: string;
        poolAddress: string | null;
        fee: number;
        tickSpacing: number;
        hooks: string;
        transactionHash: string;
        blockHash: string;
      }>;
    };
    assert.equal(inventory.chainId, 4_663);
    assert.equal(inventory.mode, "shadow");
    assert.equal(inventory.authoritative, false);
    assert.equal(inventory.pools.length, 1);
    assert.equal(inventory.pools[0]?.version, 4);
    assert.match(inventory.pools[0]?.poolKey ?? "", /^0x[0-9a-f]{64}$/);
    assert.equal(inventory.pools[0]?.poolAddress, null);
    assert.equal(inventory.pools[0]?.fee, 3_000);
    assert.equal(inventory.pools[0]?.tickSpacing, 60);
    assert.match(inventory.pools[0]?.hooks ?? "", /^0x[0-9a-f]{40}$/);
    assert.match(inventory.pools[0]?.transactionHash ?? "", /^0x[0-9a-f]{64}$/);
    assert.match(inventory.pools[0]?.blockHash ?? "", /^0x[0-9a-f]{64}$/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const source = marketSources.find((candidate) => candidate.id === "uniswap-v3")!;
  const sourceCodeValue = sourceCodeForId(source.id);
  const nextBlock = BigInt(afterCheckpoints.rows.find((row) => row.source_id === source.id)!.next_block);
  const resumedPoolKey = "0x00000000000000000000000000000000000000f1";
  await pool.query(`INSERT INTO market_pools(source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index)
    VALUES($1,$2,$3,$4,$5,$6,$7,99)`, [
    sourceCodeValue,
    hexBytes(resumedPoolKey, 20, "resumed pool"),
    hexBytes("0x00000000000000000000000000000000000000f2", 20, "resumed token0"),
    hexBytes("0x00000000000000000000000000000000000000f3", 20, "resumed token1"),
    Buffer.from("000bb8003c", "hex"),
    packPoolProvenance(`0x${"a".repeat(64)}`, `0x${"b".repeat(64)}`),
    Number(nextBlock)
  ]);
  await assert.rejects(
    pool.query(`INSERT INTO market_pools(source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index)
      VALUES($1,$2,$3,$4,$5,$6,$7,99)`, [
      sourceCodeValue,
      hexBytes("0x00000000000000000000000000000000000000f4", 20, "conflict pool"),
      hexBytes("0x00000000000000000000000000000000000000f2", 20, "conflict token0"),
      hexBytes("0x00000000000000000000000000000000000000f3", 20, "conflict token1"),
      Buffer.from("000bb8003c", "hex"),
      packPoolProvenance(`0x${"c".repeat(64)}`, `0x${"d".repeat(64)}`),
      Number(nextBlock)
    ]),
    /market_pools_compact_v3_event_key|duplicate key/
  );

  const syncClient = await pool.connect();
  try {
    await syncClient.query("DELETE FROM market_indexer_sync_points WHERE source_code=$1", [sourceCodeValue]);
    for (let index = 0; index < 70; index += 1) {
      await syncClient.query(
        "INSERT INTO market_indexer_sync_points(source_code,block_number,provenance) VALUES($1,$2,$3)",
        [sourceCodeValue, index + 1, Buffer.alloc(64, index)]
      );
    }
    await retainLatestSourceSyncPoints(syncClient, source.id);
    const retained = await syncClient.query<{ count: string; minimum: number }>(
      "SELECT COUNT(*)::text AS count,MIN(block_number) AS minimum FROM market_indexer_sync_points WHERE source_code=$1",
      [sourceCodeValue]
    );
    assert.equal(retained.rows[0]?.count, "64");
    assert.equal(retained.rows[0]?.minimum, 7);
    await rollbackSourceAfter(syncClient, source.id, nextBlock - 1n);
  } finally {
    syncClient.release();
  }
  const rolledBack = await pool.query<{ count: string; next_block: string }>(
    `SELECT (SELECT COUNT(*) FROM market_pools WHERE source_code=$1 AND block_number>$2)::text AS count,
      (SELECT next_block::text FROM market_indexer_source_state WHERE source_code=$1) AS next_block`,
    [sourceCodeValue, (nextBlock - 1n).toString()]
  );
  assert.equal(rolledBack.rows[0]?.count, "0");
  assert.equal(rolledBack.rows[0]?.next_block, nextBlock.toString());

  console.info(JSON.stringify({
    status: "compact schema low-peak migration smoke passed",
    representativeRows,
    preflight: result.preflight,
    preparedBytes: result.preparedBytes,
    afterPredropBytes: result.afterPredropBytes,
    stagedBytes: result.stagedBytes,
    postCleanupBytes: result.postCleanupBytes,
    actualPeakBytes: result.actualPeakBytes,
    reclaimedBytes: result.reclaimedBytes
  }));
} finally {
  await pool.end();
}
