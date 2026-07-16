import { Pool } from "pg";
import { EXTERNAL_ORIGIN_SCHEMA_VERSION } from "./config.js";
import { externalOriginSchemaSql } from "./schema.js";

const databaseUrl = process.env.EXTERNAL_ORIGIN_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "EXTERNAL_ORIGIN_DATABASE_URL is required for the schema smoke test"
  );
}

function assertExactSet(
  label: string,
  actualValues: readonly string[],
  expectedValues: readonly string[]
) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      label + " mismatch. Expected " + expected.join(", ") +
      "; received " + actual.join(", ")
    );
  }
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
    process.env.PGSSLMODE?.trim().toLowerCase() === "disable"
      ? false
      : { rejectUnauthorized: false },
  max: 1
});
const client = await pool.connect();
const schemaName =
  "external_origin_smoke_" + process.pid + "_" + Date.now();
const quotedSchema = '"' + schemaName + '"';
let schemaCreated = false;

try {
  await client.query("CREATE SCHEMA " + quotedSchema);
  schemaCreated = true;
  await client.query("SET search_path TO " + quotedSchema);

  await client.query(externalOriginSchemaSql);
  await client.query(externalOriginSchemaSql);

  const expectedTables = [
    "external_origin_adapter_state",
    "external_origin_claims",
    "external_origin_sync_points"
  ];
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schemaName]
  );
  assertExactSet(
    "External-origin table set",
    tables.rows.map((row) => row.table_name),
    expectedTables
  );

  for (const table of expectedTables) {
    const result = await client.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM " + table
    );
    if (result.rows[0]?.count !== 0) {
      throw new Error(table + " was not empty after migration");
    }
  }

  const constraints = await client.query<{
    constraint_name: string;
    constraint_type: string;
  }>(
    `SELECT constraint_name, constraint_type
     FROM information_schema.table_constraints
     WHERE constraint_schema = $1
       AND table_name = ANY($2::text[])`,
    [schemaName, expectedTables]
  );
  const constraintTypes = new Map(
    constraints.rows.map((row) => [
      row.constraint_name,
      row.constraint_type
    ])
  );
  const requiredConstraints = new Map([
    ["external_origin_adapter_state_pkey", "PRIMARY KEY"],
    ["external_origin_adapter_state_factory_key", "UNIQUE"],
    ["external_origin_adapter_state_claim_parent_key", "UNIQUE"],
    ["external_origin_adapter_state_status_check", "CHECK"],
    ["external_origin_sync_points_pkey", "PRIMARY KEY"],
    ["external_origin_sync_points_adapter_fkey", "FOREIGN KEY"],
    ["external_origin_claims_pkey", "PRIMARY KEY"],
    ["external_origin_claims_evidence_key", "UNIQUE"],
    ["external_origin_claims_adapter_source_fkey", "FOREIGN KEY"],
    ["external_origin_claims_claim_kind_check", "CHECK"],
    ["external_origin_claims_token_check", "CHECK"]
  ]);
  for (const [name, type] of requiredConstraints) {
    if (constraintTypes.get(name) !== type) {
      throw new Error("Missing " + type + " constraint " + name);
    }
  }

  const indexes = await client.query<{ indexname: string }>(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = $1
       AND tablename = 'external_origin_claims'`,
    [schemaName]
  );
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  for (const name of [
    "external_origin_claims_pkey",
    "external_origin_claims_evidence_key",
    "external_origin_claims_token_block_log_idx",
    "external_origin_claims_adapter_block_log_idx"
  ]) {
    if (!indexNames.has(name)) throw new Error("Missing index " + name);
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
  const evidenceHash = `0x${"f".repeat(64)}`;

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
    `INSERT INTO external_origin_sync_points (
       chain_id, adapter_id, block_number, block_hash, parent_hash
     )
     VALUES ($1, $2, 100, $3, $4)`,
    [chainId, adapterId, blockHash, parentHash]
  );

  type ClaimOverrides = {
    adapterId?: string;
    factory?: string;
    token?: string;
    transactionHash?: string;
    logIndex?: number;
    evidenceHash?: string;
  };
  const insertClaim = (overrides: ClaimOverrides = {}) =>
    client.query(
      `INSERT INTO external_origin_claims (
         chain_id, adapter_id, source_id, source_name, claim_kind,
         token, factory, transaction_hash, log_index,
         transaction_index, block_number, block_hash,
         creator, market, evidence_hash
       )
       VALUES (
         $1, $2, $3, $4, 'token-created', $5, $6, $7,
         $8, 2, 100, $9, $10, $11, $12
       )`,
      [
        chainId,
        overrides.adapterId ?? adapterId,
        sourceId,
        sourceName,
        overrides.token ?? token,
        overrides.factory ?? factory,
        overrides.transactionHash ?? transactionHash,
        overrides.logIndex ?? 7,
        blockHash,
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
      evidenceHash: `0x${"6".repeat(64)}`
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

  await expectPgFailure(
    "Missing claim adapter",
    "23503",
    "external_origin_claims_adapter_source_fkey",
    () => insertClaim({
      adapterId: "missing-v1",
      transactionHash: `0x${"8".repeat(64)}`,
      logIndex: 9,
      evidenceHash: `0x${"8".repeat(64)}`
    })
  );

  await expectPgFailure(
    "Mismatched immutable provenance",
    "23503",
    "external_origin_claims_adapter_source_fkey",
    () => insertClaim({
      factory: `0x${"2".repeat(40)}`,
      transactionHash: `0x${"9".repeat(64)}`,
      logIndex: 10,
      evidenceHash: `0x${"9".repeat(64)}`
    })
  );

  await expectPgFailure(
    "Uppercase address",
    "23514",
    "external_origin_claims_token_check",
    () => insertClaim({
      token: `0x${"A".repeat(40)}`,
      transactionHash: `0x${"c".repeat(64)}`,
      logIndex: 11,
      evidenceHash: `0x${"c".repeat(64)}`
    })
  );

  await expectPgFailure(
    "Deleting retained provenance",
    "23503",
    "external_origin_claims_adapter_source_fkey",
    () => client.query(
      `DELETE FROM external_origin_adapter_state
       WHERE chain_id = $1 AND adapter_id = $2`,
      [chainId, adapterId]
    )
  );

  await client.query(
    `DELETE FROM external_origin_claims
     WHERE chain_id = $1
       AND transaction_hash = $2
       AND log_index = 7`,
    [chainId, transactionHash]
  );
  await client.query(
    `DELETE FROM external_origin_adapter_state
     WHERE chain_id = $1 AND adapter_id = $2`,
    [chainId, adapterId]
  );

  for (const table of expectedTables) {
    const result = await client.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM " + table
    );
    if (result.rows[0]?.count !== 0) {
      throw new Error(table + " did not return to zero rows");
    }
  }

  console.info("External-origin schema smoke test passed.");
} finally {
  try {
    if (schemaCreated) {
      await client.query("SET search_path TO public");
      await client.query(
        "DROP SCHEMA IF EXISTS " + quotedSchema + " CASCADE"
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}
