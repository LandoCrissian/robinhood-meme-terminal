import assert from "node:assert/strict";
import { Pool } from "pg";
import { EXTERNAL_ORIGIN_SCHEMA_VERSION } from "./config.js";
import {
  deriveExternalOriginEvidenceHash,
  type ExternalOriginEvidence
} from "./evidence.js";
import { ExternalOriginStore } from "./origin-store.js";
import {
  applyExternalOriginSchema,
  assertExternalOriginSchema,
  externalOriginSchemaSql
} from "./schema.js";

const databaseUrl = process.env.EXTERNAL_ORIGIN_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "EXTERNAL_ORIGIN_DATABASE_URL is required for the schema smoke test"
  );
}

async function expectPgFailure(
  label: string,
  expectedCode: string,
  expectedConstraint: string,
  action: () => Promise<unknown>
) {
  try {
    await action();
  } catch (error) {
    const failure = error as {
      code?: string;
      constraint?: string;
      message?: string;
    };
    if (
      failure.code !== expectedCode ||
      failure.constraint !== expectedConstraint
    ) {
      throw new Error(
        label + " failed for the wrong reason: " +
        (failure.code ?? "unknown") + "/" +
        (failure.constraint ?? "unknown") + " " +
        (failure.message ?? "")
      );
    }
    return;
  }
  throw new Error(label + " unexpectedly succeeded");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.PGSSLMODE?.trim().toLowerCase() === "disable",
  max: 4
});

await Promise.all([
  applyExternalOriginSchema(pool),
  applyExternalOriginSchema(pool)
]);

await pool.query("CREATE TABLE isolation_sentinel (id INTEGER)");
await assert.rejects(
  () => applyExternalOriginSchema(pool),
  /not a dedicated database/
);
await pool.query("DROP TABLE isolation_sentinel");

const client = await pool.connect();
try {
  const expectedTables = [
    "external_origin_adapter_state",
    "external_origin_claims",
    "external_origin_sync_points"
  ];
  for (const table of expectedTables) {
    const result = await client.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM " + table
    );
    assert.equal(result.rows[0]?.count, 0, table + " must start empty");
  }

  const chainId = 4663;
  const adapterId = "example-v1";
  const sourceId = "example";
  const sourceName = "Example Launchpad";
  const factory = `0x${"1".repeat(40)}`;
  const token = `0x${"3".repeat(40)}`;
  const creator = `0x${"4".repeat(40)}`;
  const market = `0x${"5".repeat(40)}`;
  const manifestHash = `0x${"a".repeat(64)}`;
  const transactionHash = `0x${"b".repeat(64)}`;
  const blockHash = `0x${"d".repeat(64)}`;
  const parentHash = `0x${"e".repeat(64)}`;

  const evidence: ExternalOriginEvidence = {
    chainId,
    adapterId,
    manifestHash,
    claimKind: "token-created",
    token,
    factory,
    transactionHash,
    logIndex: 7,
    transactionIndex: 2,
    blockNumber: 100n,
    blockHash,
    creator,
    market
  };
  const evidenceHash = deriveExternalOriginEvidenceHash(evidence);

  await client.query(
    `INSERT INTO external_origin_adapter_state (
       chain_id, adapter_id, source_id, source_name, factory,
       start_block, next_block, manifest_hash, schema_version,
       status, last_sync_at
     )
     VALUES ($1, $2, $3, $4, $5, 100, 101, $6, $7, 'ready', NOW())`,
    [
      chainId,
      adapterId,
      sourceId,
      sourceName,
      factory,
      manifestHash,
      EXTERNAL_ORIGIN_SCHEMA_VERSION
    ]
  );

  await client.query(
    `INSERT INTO external_origin_adapter_state (
       chain_id, adapter_id, source_id, source_name, factory,
       start_block, next_block, manifest_hash, schema_version, status
     )
     VALUES (
       $1, 'example-v2', $2, $3, $4, 100, 100, $5, $6, 'backfilling'
     )`,
    [
      chainId,
      sourceId,
      sourceName,
      factory,
      `0x${"6".repeat(64)}`,
      EXTERNAL_ORIGIN_SCHEMA_VERSION
    ]
  );

  await expectPgFailure(
    "Ready state without a completed checkpoint",
    "23514",
    "external_origin_adapter_state_ready_check",
    () => client.query(
      `INSERT INTO external_origin_adapter_state (
         chain_id, adapter_id, source_id, source_name, factory,
         start_block, next_block, manifest_hash, schema_version, status
       )
       VALUES (
         $1, 'bad-ready-v1', 'bad-ready', 'Bad Ready',
         $2, 100, 100, $3, $4, 'ready'
       )`,
      [
        chainId,
        `0x${"2".repeat(40)}`,
        `0x${"7".repeat(64)}`,
        EXTERNAL_ORIGIN_SCHEMA_VERSION
      ]
    )
  );

  await client.query(
    `INSERT INTO external_origin_sync_points (
       chain_id, adapter_id, block_number, block_hash, parent_hash
     )
     VALUES ($1, $2, 100, $3, $4)`,
    [chainId, adapterId, blockHash, parentHash]
  );

  type ClaimOverrides = {
    claimKind?: "token-created" | "source-listed";
    adapterId?: string;
    factory?: string;
    startBlock?: string;
    manifestHash?: string;
    token?: string;
    transactionHash?: string;
    logIndex?: number;
    blockNumber?: string;
    blockHash?: string;
    evidenceHash?: string;
  };
  const insertClaim = (overrides: ClaimOverrides = {}) =>
    client.query(
      `INSERT INTO external_origin_claims (
         chain_id, adapter_id, source_id, source_name, claim_kind,
         token, factory, start_block, manifest_hash, schema_version,
         transaction_hash, log_index, transaction_index,
         block_number, block_hash, creator, market, evidence_hash
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, 2, $13, $14, $15, $16, $17
       )`,
      [
        chainId,
        overrides.adapterId ?? adapterId,
        sourceId,
        sourceName,
        overrides.claimKind ?? "token-created",
        overrides.token ?? token,
        overrides.factory ?? factory,
        overrides.startBlock ?? "100",
        overrides.manifestHash ?? manifestHash,
        EXTERNAL_ORIGIN_SCHEMA_VERSION,
        overrides.transactionHash ?? transactionHash,
        overrides.logIndex ?? 7,
        overrides.blockNumber ?? "100",
        overrides.blockHash ?? blockHash,
        creator,
        market,
        overrides.evidenceHash ?? evidenceHash
      ]
    );

  await insertClaim();

  await expectPgFailure(
    "Duplicate chain evidence",
    "23505",
    "external_origin_claims_pkey",
    () => insertClaim({
      evidenceHash: `0x${"8".repeat(64)}`
    })
  );

  await expectPgFailure(
    "Duplicate evidence digest",
    "23505",
    "external_origin_claims_evidence_key",
    () => insertClaim({
      transactionHash: `0x${"7".repeat(64)}`,
      logIndex: 8
    })
  );

  await expectPgFailure(
    "Conflicting token creation origin",
    "23505",
    "external_origin_claims_created_token_key",
    () => insertClaim({
      transactionHash: `0x${"8".repeat(64)}`,
      logIndex: 9,
      evidenceHash: `0x${"9".repeat(64)}`
    })
  );

  await insertClaim({
    claimKind: "source-listed",
    transactionHash: `0x${"9".repeat(64)}`,
    logIndex: 10,
    evidenceHash: `0x${"b".repeat(64)}`
  });

  const store = new ExternalOriginStore(pool);
  const creationClaims = await store.originClaims(
    [token],
    [adapterId]
  );
  assert.equal(creationClaims.length, 1);
  assert.equal(creationClaims[0]?.claimKind, "token-created");
  assert.equal(creationClaims[0]?.manifestHash, manifestHash);

  await expectPgFailure(
    "Retroactive manifest mutation",
    "23503",
    "external_origin_claims_adapter_source_fkey",
    () => client.query(
      `UPDATE external_origin_adapter_state
       SET manifest_hash = $1
       WHERE chain_id = $2 AND adapter_id = $3`,
      [`0x${"c".repeat(64)}`, chainId, adapterId]
    )
  );

  await expectPgFailure(
    "Mismatched claim manifest",
    "23503",
    "external_origin_claims_adapter_source_fkey",
    () => insertClaim({
      claimKind: "source-listed",
      manifestHash: `0x${"c".repeat(64)}`,
      transactionHash: `0x${"c".repeat(64)}`,
      logIndex: 11,
      evidenceHash: `0x${"d".repeat(64)}`
    })
  );

  await expectPgFailure(
    "Mismatched checkpoint hash",
    "23503",
    "external_origin_claims_checkpoint_fkey",
    () => insertClaim({
      claimKind: "source-listed",
      blockHash: `0x${"f".repeat(64)}`,
      transactionHash: `0x${"e".repeat(64)}`,
      logIndex: 12,
      evidenceHash: `0x${"e".repeat(64)}`
    })
  );

  await expectPgFailure(
    "Orphan sync point",
    "23503",
    "external_origin_sync_points_adapter_fkey",
    () => client.query(
      `INSERT INTO external_origin_sync_points (
         chain_id, adapter_id, block_number, block_hash, parent_hash
       )
       VALUES ($1, 'missing-v1', 101, $2, $3)`,
      [chainId, blockHash, parentHash]
    )
  );

  await client.query(
    `INSERT INTO external_origin_sync_points (
       chain_id, adapter_id, block_number, block_hash, parent_hash
     )
     VALUES ($1, $2, 99, $3, $4)`,
    [
      chainId,
      adapterId,
      `0x${"1".repeat(64)}`,
      `0x${"2".repeat(64)}`
    ]
  );
  await expectPgFailure(
    "Claim before adapter deployment",
    "23514",
    "external_origin_claims_block_range_check",
    () => insertClaim({
      claimKind: "source-listed",
      blockNumber: "99",
      blockHash: `0x${"1".repeat(64)}`,
      transactionHash: `0x${"1".repeat(64)}`,
      logIndex: 13,
      evidenceHash: `0x${"2".repeat(64)}`
    })
  );

  await client.query(
    `DELETE FROM external_origin_sync_points
     WHERE chain_id = $1
       AND adapter_id = $2
       AND block_number = 100`,
    [chainId, adapterId]
  );
  const reorgClaims = await client.query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count
     FROM external_origin_claims
     WHERE chain_id = $1 AND adapter_id = $2`,
    [chainId, adapterId]
  );
  assert.equal(
    reorgClaims.rows[0]?.count,
    0,
    "Deleting a checkpoint must remove its claims"
  );

  await client.query(
    `DELETE FROM external_origin_adapter_state
     WHERE chain_id = $1`,
    [chainId]
  );

  for (const table of expectedTables) {
    const result = await client.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM " + table
    );
    assert.equal(result.rows[0]?.count, 0, table + " must return to zero");
  }

  const driftSchema =
    "external_origin_drift_" + process.pid + "_" + Date.now();
  const quotedDriftSchema = '"' + driftSchema + '"';
  await client.query("CREATE SCHEMA " + quotedDriftSchema);
  try {
    await client.query("SET search_path TO " + quotedDriftSchema);
    await client.query(externalOriginSchemaSql);
    await client.query(externalOriginSchemaSql);
    await assertExternalOriginSchema(client, driftSchema);
    await client.query(
      "ALTER TABLE external_origin_claims " +
      "DROP CONSTRAINT external_origin_claims_evidence_key"
    );
    await assert.rejects(
      () => assertExternalOriginSchema(client, driftSchema),
      /constraints mismatch/
    );
  } finally {
    await client.query("SET search_path TO public");
    await client.query(
      "DROP SCHEMA IF EXISTS " + quotedDriftSchema + " CASCADE"
    );
  }

  console.info("External-origin schema smoke test passed.");
} finally {
  client.release();
  await pool.end();
}
