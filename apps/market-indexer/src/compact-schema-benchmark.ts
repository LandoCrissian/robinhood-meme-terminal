import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import pg from "pg";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const SCHEMA_PREFIX = "rmt_compact_bench_";

type Candidate = {
  id: string;
  ddl: string;
  insert: string;
  sourcePredicate: string;
  poolKeyExpression: string;
  tokenExpression: string;
  paginationOrder: string;
  eventConflictColumns: string;
  hasTransactionIndex: boolean;
  hashedIdentity?: boolean;
};

type QueryMeasurement = {
  medianMs: number;
  plan: string;
};

function requiredLocalUrl() {
  const raw = process.env.MARKET_INDEXER_BENCHMARK_DATABASE_URL;
  if (!raw) throw new Error("MARKET_INDEXER_BENCHMARK_DATABASE_URL is required");
  const url = new URL(raw);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("compact-schema benchmark permits loopback PostgreSQL only");
  }
  if (process.env.MARKET_INDEXER_BENCHMARK_ALLOW_LOCAL !== "1") {
    throw new Error("MARKET_INDEXER_BENCHMARK_ALLOW_LOCAL=1 is required");
  }
  return raw;
}

function rowCounts() {
  const raw = process.env.MARKET_INDEXER_BENCHMARK_ROWS ?? "200000,400000";
  const values = raw.split(",").map((value) => Number(value));
  if (
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 10_000 || value > 1_500_000)
  ) {
    throw new Error("MARKET_INDEXER_BENCHMARK_ROWS must contain integers from 10000 to 1500000");
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

const sourceText = `CASE
  WHEN i % 10000 < 1 THEN 'sushiswap-v2'
  WHEN i % 10000 < 45 THEN 'sushiswap-v3'
  WHEN i % 10000 < 633 THEN 'uniswap-v2'
  WHEN i % 10000 < 6363 THEN 'uniswap-v3'
  WHEN i % 10000 < 9993 THEN 'uniswap-v4'
  WHEN i % 10000 < 9997 THEN 'up-v2'
  ELSE 'up-cl'
END`;

const sourceCode = `CASE
  WHEN i % 10000 < 1 THEN 1
  WHEN i % 10000 < 45 THEN 2
  WHEN i % 10000 < 633 THEN 3
  WHEN i % 10000 < 6363 THEN 4
  WHEN i % 10000 < 9993 THEN 5
  WHEN i % 10000 < 9997 THEN 6
  ELSE 7
END`;

const protocolText = `CASE
  WHEN i % 10000 < 45 THEN 'sushiswap'
  WHEN i % 10000 < 9993 THEN 'uniswap'
  ELSE 'up'
END`;

const versionValue = `CASE
  WHEN i % 10000 < 1 THEN 2
  WHEN i % 10000 < 45 THEN 3
  WHEN i % 10000 < 633 THEN 2
  WHEN i % 10000 < 6363 THEN 3
  WHEN i % 10000 < 9993 THEN 4
  WHEN i % 10000 < 9997 THEN 2
  ELSE 3
END`;

const binaryPoolKey = `CASE WHEN (${versionValue}) = 4 THEN
  decode(md5('pool:' || i::text) || md5('pool:b:' || i::text), 'hex')
ELSE substring(decode(md5('pool:' || i::text) || md5('pool:b:' || i::text), 'hex') FROM 1 FOR 20) END`;
const binaryToken0 = `CASE WHEN i = 6419 THEN
  decode('e934e36a439c94017b64a3fece66af12099abf50', 'hex')
ELSE substring(decode(md5('token0:' || (i / 3)::text) || md5('token0:b:' || (i / 3)::text), 'hex') FROM 1 FOR 20) END`;
const binaryToken1 = `substring(decode(md5('token1:' || (i / 5 + 100000000)::text) || md5('token1:b:' || (i / 5 + 100000000)::text), 'hex') FROM 1 FOR 20)`;
const binaryTransactionHash = `decode(md5('tx:' || i::text) || md5('tx:b:' || i::text), 'hex')`;
const binaryBlockHash = `decode(md5('block:' || (i / 3)::text) || md5('block:b:' || (i / 3)::text), 'hex')`;
const binaryHooks = `CASE WHEN (${versionValue}) = 4 THEN substring(decode(md5('hooks:' || (i % 97)::text) || md5('hooks:b:' || (i % 97)::text), 'hex') FROM 1 FOR 20) ELSE NULL END`;
const blockNumber = `(1000000 + (i / 3))::bigint`;

const sourceRows = `
  INSERT INTO sources (source_code, source_id, protocol, protocol_version, chain_id) VALUES
    (1, 'sushiswap-v2', 'sushiswap', 2, 4663),
    (2, 'sushiswap-v3', 'sushiswap', 3, 4663),
    (3, 'uniswap-v2', 'uniswap', 2, 4663),
    (4, 'uniswap-v3', 'uniswap', 3, 4663),
    (5, 'uniswap-v4', 'uniswap', 4, 4663),
    (6, 'up-v2', 'up', 2, 4663),
    (7, 'up-cl', 'up', 3, 4663);`;

const compactSourceTable = `
  CREATE UNLOGGED TABLE sources (
    source_code SMALLINT PRIMARY KEY CHECK (source_code BETWEEN 1 AND 7),
    source_id TEXT NOT NULL UNIQUE,
    protocol TEXT NOT NULL,
    protocol_version SMALLINT NOT NULL,
    chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
    UNIQUE (source_code, protocol, protocol_version, chain_id)
  );
  ${sourceRows}`;

const compactColumns = `
  source_code SMALLINT NOT NULL REFERENCES sources(source_code),
  pool_key BYTEA NOT NULL CHECK (octet_length(pool_key) IN (20, 32)),
  token0 BYTEA NOT NULL CHECK (octet_length(token0) = 20),
  token1 BYTEA NOT NULL CHECK (octet_length(token1) = 20 AND token0 <> token1),
  stable BOOLEAN,
  fee INTEGER,
  tick_spacing SMALLINT,
  hooks BYTEA CHECK (hooks IS NULL OR octet_length(hooks) = 20),
  transaction_hash BYTEA NOT NULL CHECK (octet_length(transaction_hash) = 32),
  transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  block_number BIGINT NOT NULL CHECK (block_number >= 0),
  block_hash BYTEA NOT NULL CHECK (octet_length(block_hash) = 32),
  CHECK (
    (source_code IN (1, 3, 6) AND octet_length(pool_key) = 20)
    OR (source_code IN (2, 4, 7) AND octet_length(pool_key) = 20)
    OR (source_code = 5 AND octet_length(pool_key) = 32)
  ),
  CHECK ((source_code = 5 AND hooks IS NOT NULL) OR (source_code <> 5 AND hooks IS NULL)),
  CHECK ((source_code = 6 AND stable IS NOT NULL) OR (source_code <> 6 AND stable IS NULL))`;

const compactInsert = `
  INSERT INTO market_pools (
    source_code, pool_key, token0, token1, stable, fee, tick_spacing, hooks,
    transaction_hash, transaction_index, log_index, block_number, block_hash
  )
  SELECT ${sourceCode}, ${binaryPoolKey}, ${binaryToken0}, ${binaryToken1},
    CASE WHEN (${sourceCode}) = 6 THEN (i % 2 = 0) ELSE NULL END,
    CASE WHEN (${versionValue}) IN (3, 4) AND (${sourceCode}) <> 7 THEN 3000 ELSE NULL END,
    CASE WHEN (${versionValue}) IN (3, 4) THEN 60 ELSE NULL END,
    ${binaryHooks}, ${binaryTransactionHash}, (i % 50)::integer, (i % 3)::integer,
    ${blockNumber}, ${binaryBlockHash}
  FROM generate_series(1, $1::integer) AS generated(i);`;

const candidates: Candidate[] = [
  {
    id: "current_text",
    ddl: `CREATE UNLOGGED TABLE market_pools (
      chain_id BIGINT NOT NULL,
      source_id TEXT NOT NULL,
      protocol TEXT NOT NULL,
      protocol_version INTEGER NOT NULL,
      pool_key TEXT NOT NULL,
      pool_address TEXT,
      token0 TEXT NOT NULL,
      token1 TEXT NOT NULL,
      stable BOOLEAN,
      fee INTEGER,
      tick_spacing INTEGER,
      hooks TEXT,
      transaction_hash TEXT NOT NULL,
      transaction_index INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      block_number BIGINT NOT NULL,
      block_hash TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT current_text_pk PRIMARY KEY (chain_id, source_id, pool_key),
      CONSTRAINT current_text_event_unique UNIQUE (chain_id, transaction_hash, log_index)
    );
    CREATE INDEX current_text_tokens ON market_pools (chain_id, token0, token1);
    CREATE INDEX current_text_blocks ON market_pools (chain_id, source_id, block_number DESC, transaction_index DESC, log_index DESC);`,
    insert: `INSERT INTO market_pools (
      chain_id, source_id, protocol, protocol_version, pool_key, pool_address,
      token0, token1, stable, fee, tick_spacing, hooks, transaction_hash,
      transaction_index, log_index, block_number, block_hash
    ) SELECT 4663, ${sourceText}, ${protocolText}, ${versionValue},
      '0x' || encode(${binaryPoolKey}, 'hex'),
      CASE WHEN (${versionValue}) = 4 THEN NULL ELSE '0x' || encode(${binaryPoolKey}, 'hex') END,
      '0x' || encode(${binaryToken0}, 'hex'), '0x' || encode(${binaryToken1}, 'hex'),
      CASE WHEN (${sourceCode}) = 6 THEN (i % 2 = 0) ELSE NULL END,
      CASE WHEN (${versionValue}) IN (3, 4) AND (${sourceCode}) <> 7 THEN 3000 ELSE NULL END,
      CASE WHEN (${versionValue}) IN (3, 4) THEN 60 ELSE NULL END,
      CASE WHEN (${versionValue}) = 4 THEN '0x' || encode(${binaryHooks}, 'hex') ELSE NULL END,
      '0x' || encode(${binaryTransactionHash}, 'hex'), (i % 50)::integer,
      (i % 3)::integer, ${blockNumber}, '0x' || encode(${binaryBlockHash}, 'hex')
    FROM generate_series(1, $1::integer) AS generated(i);`,
    sourcePredicate: "chain_id = 4663 AND source_id = 'uniswap-v3'",
    poolKeyExpression: "pool_key",
    tokenExpression: "token0",
    paginationOrder: "block_number DESC, transaction_index DESC, log_index DESC",
    eventConflictColumns: "chain_id, transaction_hash, log_index",
    hasTransactionIndex: true
  },
  {
    id: "binary_equivalent",
    ddl: `CREATE UNLOGGED TABLE market_pools (
      chain_id BIGINT NOT NULL,
      source_id TEXT NOT NULL,
      protocol TEXT NOT NULL,
      protocol_version SMALLINT NOT NULL,
      pool_key BYTEA NOT NULL,
      pool_address BYTEA,
      token0 BYTEA NOT NULL,
      token1 BYTEA NOT NULL,
      stable BOOLEAN,
      fee INTEGER,
      tick_spacing SMALLINT,
      hooks BYTEA,
      transaction_hash BYTEA NOT NULL,
      transaction_index INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      block_number BIGINT NOT NULL,
      block_hash BYTEA NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT binary_equivalent_pk PRIMARY KEY (chain_id, source_id, pool_key),
      CONSTRAINT binary_equivalent_event_unique UNIQUE (chain_id, transaction_hash, log_index)
    );
    CREATE INDEX binary_equivalent_tokens ON market_pools (chain_id, token0, token1);
    CREATE INDEX binary_equivalent_blocks ON market_pools (chain_id, source_id, block_number DESC, transaction_index DESC, log_index DESC);`,
    insert: `INSERT INTO market_pools (
      chain_id, source_id, protocol, protocol_version, pool_key, pool_address,
      token0, token1, stable, fee, tick_spacing, hooks, transaction_hash,
      transaction_index, log_index, block_number, block_hash
    ) SELECT 4663, ${sourceText}, ${protocolText}, ${versionValue}, ${binaryPoolKey},
      CASE WHEN (${versionValue}) = 4 THEN NULL ELSE ${binaryPoolKey} END,
      ${binaryToken0}, ${binaryToken1},
      CASE WHEN (${sourceCode}) = 6 THEN (i % 2 = 0) ELSE NULL END,
      CASE WHEN (${versionValue}) IN (3, 4) AND (${sourceCode}) <> 7 THEN 3000 ELSE NULL END,
      CASE WHEN (${versionValue}) IN (3, 4) THEN 60 ELSE NULL END,
      ${binaryHooks}, ${binaryTransactionHash}, (i % 50)::integer, (i % 3)::integer,
      ${blockNumber}, ${binaryBlockHash}
    FROM generate_series(1, $1::integer) AS generated(i);`,
    sourcePredicate: "chain_id = 4663 AND source_id = 'uniswap-v3'",
    poolKeyExpression: "pool_key",
    tokenExpression: "token0",
    paginationOrder: "block_number DESC, transaction_index DESC, log_index DESC",
    eventConflictColumns: "chain_id, transaction_hash, log_index",
    hasTransactionIndex: true
  },
  {
    id: "compact_manifest_tx_event",
    ddl: `${compactSourceTable}
    CREATE UNLOGGED TABLE market_pools (${compactColumns},
      CONSTRAINT compact_manifest_tx_event_pk PRIMARY KEY (source_code, pool_key),
      CONSTRAINT compact_manifest_tx_event_unique UNIQUE (transaction_hash, log_index)
    );
    CREATE INDEX compact_manifest_tx_tokens ON market_pools (token0, token1);
    CREATE INDEX compact_manifest_tx_blocks ON market_pools (source_code, block_number DESC, transaction_index DESC, log_index DESC);`,
    insert: compactInsert,
    sourcePredicate: "source_code = 4",
    poolKeyExpression: "pool_key",
    tokenExpression: "token0",
    paginationOrder: "block_number DESC, transaction_index DESC, log_index DESC",
    eventConflictColumns: "transaction_hash, log_index",
    hasTransactionIndex: true
  },
  {
    id: "compact_manifest_coordinates",
    ddl: `${compactSourceTable}
    CREATE UNLOGGED TABLE market_pools (${compactColumns},
      CONSTRAINT compact_manifest_coordinates_pk PRIMARY KEY (source_code, pool_key),
      CONSTRAINT compact_manifest_coordinates_event UNIQUE (block_number, log_index)
    );
    CREATE INDEX compact_manifest_coordinates_page ON market_pools (block_number DESC, transaction_index DESC, log_index DESC);`,
    insert: compactInsert,
    sourcePredicate: "source_code = 4",
    poolKeyExpression: "pool_key",
    tokenExpression: "token0",
    paginationOrder: "block_number DESC, transaction_index DESC, log_index DESC",
    eventConflictColumns: "block_number, log_index",
    hasTransactionIndex: true
  },
  {
    id: "compact_manifest_coordinates_token_gin",
    ddl: `${compactSourceTable}
    CREATE UNLOGGED TABLE market_pools (${compactColumns},
      CONSTRAINT compact_manifest_coordinates_token_gin_pk PRIMARY KEY (source_code, pool_key),
      CONSTRAINT compact_manifest_coordinates_token_gin_event UNIQUE (block_number, log_index)
    );
    CREATE INDEX compact_manifest_coordinates_token_gin_page ON market_pools (block_number DESC, transaction_index DESC, log_index DESC);
    CREATE INDEX compact_manifest_coordinates_token_gin_tokens ON market_pools USING GIN ((ARRAY[token0, token1]));`,
    insert: compactInsert,
    sourcePredicate: "source_code = 4",
    poolKeyExpression: "pool_key",
    tokenExpression: "token0",
    paginationOrder: "block_number DESC, transaction_index DESC, log_index DESC",
    eventConflictColumns: "block_number, log_index",
    hasTransactionIndex: true
  },
  {
    id: "packed_manifest_coordinates",
    ddl: `CREATE UNLOGGED TABLE sources (
      source_code SMALLINT PRIMARY KEY CHECK (source_code BETWEEN 1 AND 7),
      source_id TEXT NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      protocol_version SMALLINT NOT NULL,
      chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
      UNIQUE (source_code, protocol, protocol_version, chain_id)
    );
    INSERT INTO sources (source_code, source_id, protocol, protocol_version, chain_id) VALUES
      (1, 'sushiswap-v2', 'sushiswap', 2, 4663),
      (2, 'sushiswap-v3', 'sushiswap', 3, 4663),
      (3, 'uniswap-v2', 'uniswap', 2, 4663),
      (4, 'uniswap-v3', 'uniswap', 3, 4663),
      (5, 'uniswap-v4', 'uniswap', 4, 4663),
      (6, 'up-v2', 'up', 2, 4663),
      (7, 'up-cl', 'up', 3, 4663);
    CREATE UNLOGGED TABLE market_pools (
      source_code SMALLINT NOT NULL REFERENCES sources(source_code),
      pool_key BYTEA NOT NULL CHECK (octet_length(pool_key) IN (20, 32)),
      token0 BYTEA NOT NULL CHECK (octet_length(token0) = 20),
      token1 BYTEA NOT NULL CHECK (octet_length(token1) = 20 AND token0 <> token1),
      attributes BYTEA,
      provenance BYTEA NOT NULL CHECK (octet_length(provenance) = 64),
      block_number INTEGER NOT NULL CHECK (block_number >= 0),
      log_index INTEGER NOT NULL CHECK (log_index >= 0),
      CONSTRAINT packed_manifest_coordinates_pk PRIMARY KEY (source_code, pool_key) WITH (fillfactor = 100),
      CONSTRAINT packed_manifest_coordinates_event UNIQUE (block_number, log_index) WITH (fillfactor = 100),
      CHECK (
        (source_code IN (1, 3, 6) AND octet_length(pool_key) = 20)
        OR (source_code IN (2, 4, 7) AND octet_length(pool_key) = 20)
        OR (source_code = 5 AND octet_length(pool_key) = 32)
      ),
      CHECK (
        (source_code IN (1, 3) AND attributes IS NULL)
        OR (source_code IN (2, 4) AND octet_length(attributes) = 5)
        OR (source_code = 5 AND octet_length(attributes) = 25)
        OR (source_code = 6 AND octet_length(attributes) = 1)
        OR (source_code = 7 AND octet_length(attributes) = 2)
      )
    );`,
    insert: `INSERT INTO market_pools (
      source_code, pool_key, token0, token1, attributes, provenance,
      block_number, log_index
    ) SELECT (${sourceCode})::smallint, ${binaryPoolKey}, ${binaryToken0}, ${binaryToken1},
      CASE
        WHEN (${sourceCode}) IN (1, 3) THEN NULL
        WHEN (${sourceCode}) IN (2, 4) THEN substring(int4send(3000) FROM 2 FOR 3) || int2send(60::smallint)
        WHEN (${sourceCode}) = 5 THEN substring(int4send(3000) FROM 2 FOR 3) || int2send(60::smallint) || ${binaryHooks}
        WHEN (${sourceCode}) = 6 THEN decode(CASE WHEN i % 2 = 0 THEN '01' ELSE '00' END, 'hex')
        ELSE int2send(60::smallint)
      END,
      ${binaryTransactionHash} || ${binaryBlockHash},
      (${blockNumber})::integer, (i % 3)::integer
    FROM generate_series(1, $1::integer) AS generated(i);`,
    sourcePredicate: "source_code = 4",
    poolKeyExpression: "pool_key",
    tokenExpression: "token0",
    paginationOrder: "block_number DESC, log_index DESC",
    eventConflictColumns: "block_number, log_index",
    hasTransactionIndex: false
  },
  {
    id: "packed_manifest_hashed_identity",
    ddl: `CREATE UNLOGGED TABLE sources (
      source_code \"char\" PRIMARY KEY CHECK (source_code BETWEEN '1' AND '7'),
      source_id TEXT NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      protocol_version SMALLINT NOT NULL,
      chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
      UNIQUE (source_code, protocol, protocol_version, chain_id)
    );
    INSERT INTO sources (source_code, source_id, protocol, protocol_version, chain_id) VALUES
      ('1', 'sushiswap-v2', 'sushiswap', 2, 4663),
      ('2', 'sushiswap-v3', 'sushiswap', 3, 4663),
      ('3', 'uniswap-v2', 'uniswap', 2, 4663),
      ('4', 'uniswap-v3', 'uniswap', 3, 4663),
      ('5', 'uniswap-v4', 'uniswap', 4, 4663),
      ('6', 'up-v2', 'up', 2, 4663),
      ('7', 'up-cl', 'up', 3, 4663);
    CREATE UNLOGGED TABLE market_pools (
      source_code \"char\" NOT NULL REFERENCES sources(source_code),
      pool_hash BIGINT NOT NULL,
      collision_ordinal SMALLINT NOT NULL DEFAULT 0 CHECK (collision_ordinal >= 0),
      pool_key BYTEA NOT NULL CHECK (octet_length(pool_key) IN (20, 32)),
      token0 BYTEA NOT NULL CHECK (octet_length(token0) = 20),
      token1 BYTEA NOT NULL CHECK (octet_length(token1) = 20 AND token0 <> token1),
      attributes BYTEA,
      provenance BYTEA NOT NULL CHECK (octet_length(provenance) = 64),
      block_number INTEGER NOT NULL CHECK (block_number >= 0),
      log_index INTEGER NOT NULL CHECK (log_index >= 0),
      CONSTRAINT packed_manifest_hashed_identity_pk PRIMARY KEY (pool_hash, source_code, collision_ordinal),
      CONSTRAINT packed_manifest_hashed_identity_event UNIQUE (block_number, log_index),
      CHECK (
        (source_code IN ('1', '3', '6') AND octet_length(pool_key) = 20)
        OR (source_code IN ('2', '4', '7') AND octet_length(pool_key) = 20)
        OR (source_code = '5' AND octet_length(pool_key) = 32)
      ),
      CHECK (
        (source_code IN ('1', '3') AND attributes IS NULL)
        OR (source_code IN ('2', '4') AND octet_length(attributes) = 5)
        OR (source_code = '5' AND octet_length(attributes) = 25)
        OR (source_code = '6' AND octet_length(attributes) = 1)
        OR (source_code = '7' AND octet_length(attributes) = 2)
      )
    );`,
    insert: `INSERT INTO market_pools (
      source_code, pool_hash, collision_ordinal, pool_key, token0, token1,
      attributes, provenance, block_number, log_index
    ) SELECT (${sourceCode})::text::\"char\",
      ('x' || substring(md5('canonical-pool:' || i::text) FROM 1 FOR 16))::bit(64)::bigint,
      0, ${binaryPoolKey}, ${binaryToken0}, ${binaryToken1},
      CASE
        WHEN (${sourceCode}) IN (1, 3) THEN NULL
        WHEN (${sourceCode}) IN (2, 4) THEN substring(int4send(3000) FROM 2 FOR 3) || int2send(60::smallint)
        WHEN (${sourceCode}) = 5 THEN substring(int4send(3000) FROM 2 FOR 3) || int2send(60::smallint) || ${binaryHooks}
        WHEN (${sourceCode}) = 6 THEN decode(CASE WHEN i % 2 = 0 THEN '01' ELSE '00' END, 'hex')
        ELSE int2send(60::smallint)
      END,
      ${binaryTransactionHash} || ${binaryBlockHash},
      (${blockNumber})::integer, (i % 3)::integer
    FROM generate_series(1, $1::integer) AS generated(i);`,
    sourcePredicate: "source_code = '4'",
    poolKeyExpression: "pool_key",
    tokenExpression: "token0",
    paginationOrder: "block_number DESC, log_index DESC",
    eventConflictColumns: "block_number, log_index",
    hasTransactionIndex: false,
    hashedIdentity: true
  }
];

function selectedCandidates() {
  const raw = process.env.MARKET_INDEXER_BENCHMARK_CANDIDATES;
  if (!raw) return candidates;
  const requested = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
  const selected = candidates.filter((candidate) => requested.has(candidate.id));
  if (selected.length !== requested.size || selected.length === 0) {
    throw new Error("MARKET_INDEXER_BENCHMARK_CANDIDATES contains an unknown candidate");
  }
  return selected;
}

function safeSchema(candidate: Candidate, rows: number) {
  const schema = `${SCHEMA_PREFIX}${candidate.id}_${rows}`;
  assert.match(schema, /^[a-z0-9_]+$/);
  return schema;
}

async function explain(
  client: pg.Client,
  sql: string,
  values: unknown[] = []
): Promise<QueryMeasurement> {
  const samples: number[] = [];
  let plan = "";
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const result = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
      values
    );
    const document = result.rows[0]?.["QUERY PLAN"]?.[0];
    if (!document) throw new Error("PostgreSQL did not return an explain plan");
    samples.push(Number(document["Execution Time"]));
    plan = document.Plan["Node Type"] + collectIndexes(document.Plan);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: samples[Math.floor(samples.length / 2)]!, plan };
}

function collectIndexes(plan: Record<string, unknown>): string {
  const names: string[] = [];
  const visit = (node: Record<string, unknown>) => {
    if (typeof node["Index Name"] === "string") names.push(node["Index Name"]);
    const children = node.Plans;
    if (Array.isArray(children)) {
      for (const child of children) visit(child as Record<string, unknown>);
    }
  };
  visit(plan);
  return names.length > 0 ? `:${[...new Set(names)].join(",")}` : "";
}

async function measureCandidate(client: pg.Client, candidate: Candidate, rows: number) {
  const schema = safeSchema(candidate, rows);
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}, public`);
  await client.query(candidate.ddl);
  const startedAt = performance.now();
  await client.query(candidate.insert, [rows]);
  const insertMs = performance.now() - startedAt;
  await client.query("VACUUM (ANALYZE) market_pools");

  const relation = await client.query<{
    heap_bytes: string;
    index_bytes: string;
    total_bytes: string;
  }>(`SELECT pg_relation_size('market_pools')::text AS heap_bytes,
             pg_indexes_size('market_pools')::text AS index_bytes,
             pg_total_relation_size('market_pools')::text AS total_bytes`);
  const indexes = await client.query<{
    index_name: string;
    bytes: string;
    primary: boolean;
    unique_index: boolean;
  }>(`SELECT indexrelid::regclass::text AS index_name,
             pg_relation_size(indexrelid)::text AS bytes,
             indisprimary AS primary,
             indisunique AS unique_index
      FROM pg_index
      WHERE indrelid = 'market_pools'::regclass
      ORDER BY index_name`);
  const sample = await client.query<{ pool_key: Buffer; token0: Buffer; pool_hash: string | null }>(
    `SELECT ${candidate.poolKeyExpression} AS pool_key, ${candidate.tokenExpression} AS token0,
            ${candidate.hashedIdentity ? "pool_hash::text" : "NULL::text"} AS pool_hash
     FROM market_pools OFFSET $1 LIMIT 1`,
    [Math.floor(rows * 0.7)]
  );
  const selected = sample.rows[0];
  if (!selected) throw new Error("benchmark sample row missing");
  const coordinate = await client.query<{ block_number: string; transaction_index: number | null; log_index: number }>(
    `SELECT block_number::text, ${candidate.hasTransactionIndex ? "transaction_index" : "NULL::integer"} AS transaction_index, log_index FROM market_pools
     ORDER BY ${candidate.paginationOrder} OFFSET $1 LIMIT 1`,
    [Math.floor(rows / 2)]
  );
  const cursor = coordinate.rows[0];
  if (!cursor) throw new Error("benchmark cursor row missing");

  const pagination = await explain(
    client,
    candidate.hasTransactionIndex
      ? `SELECT pool_key FROM market_pools
         WHERE (block_number, transaction_index, log_index) < ($1::bigint, $2::integer, $3::integer)
         ORDER BY ${candidate.paginationOrder} LIMIT 100`
      : `SELECT pool_key FROM market_pools
         WHERE (block_number, log_index) < ($1::integer, $2::integer)
         ORDER BY ${candidate.paginationOrder} LIMIT 100`,
    candidate.hasTransactionIndex
      ? [cursor.block_number, cursor.transaction_index, cursor.log_index]
      : [cursor.block_number, cursor.log_index]
  );
  const sourcePagination = await explain(
    client,
    candidate.hasTransactionIndex
      ? `SELECT pool_key FROM market_pools
         WHERE ${candidate.sourcePredicate}
           AND (block_number, transaction_index, log_index) < ($1::bigint, $2::integer, $3::integer)
         ORDER BY ${candidate.paginationOrder} LIMIT 100`
      : `SELECT pool_key FROM market_pools
         WHERE ${candidate.sourcePredicate}
           AND (block_number, log_index) < ($1::integer, $2::integer)
         ORDER BY ${candidate.paginationOrder} LIMIT 100`,
    candidate.hasTransactionIndex
      ? [cursor.block_number, cursor.transaction_index, cursor.log_index]
      : [cursor.block_number, cursor.log_index]
  );
  const token = await explain(
    client,
    candidate.id.endsWith("token_gin")
      ? "SELECT pool_key FROM market_pools WHERE ARRAY[$1::bytea] <@ ARRAY[token0, token1] ORDER BY block_number DESC, transaction_index DESC, log_index DESC LIMIT 100"
      : `SELECT pool_key FROM market_pools WHERE token0 = $1 OR token1 = $1 ORDER BY ${candidate.paginationOrder} LIMIT 100`,
    [selected.token0]
  );
  const poolKey = await explain(
    client,
    candidate.hashedIdentity
      ? `SELECT pool_key FROM market_pools WHERE pool_hash = $1 AND pool_key = $2 ORDER BY ${candidate.paginationOrder} LIMIT 100`
      : `SELECT pool_key FROM market_pools WHERE pool_key = $1 ORDER BY ${candidate.paginationOrder} LIMIT 100`,
    candidate.hashedIdentity
      ? [selected.pool_hash, selected.pool_key]
      : [selected.pool_key]
  );
  const v4SourcePredicate = candidate.id === "current_text" || candidate.id === "binary_equivalent"
    ? "source_id = 'uniswap-v4'"
    : candidate.id === "packed_manifest_hashed_identity"
      ? "source_code = '5'"
      : "source_code = 5";
  const v4Sample = await client.query<{ pool_key: Buffer | string }>(
    `SELECT pool_key FROM market_pools WHERE ${v4SourcePredicate} LIMIT 1`
  );
  const v4PoolId = await explain(
    client,
    `SELECT pool_key FROM market_pools WHERE pool_key = $1 ORDER BY ${candidate.paginationOrder} LIMIT 100`,
    [v4Sample.rows[0]!.pool_key]
  );
  const rollback = await explain(
    client,
    `SELECT count(*) FROM market_pools WHERE ${candidate.sourcePredicate} AND block_number > $1`,
    [cursor.block_number]
  );
  const enrichment = await explain(
    client,
    candidate.id === "packed_manifest_hashed_identity"
      ? "SELECT pool_key FROM market_pools WHERE source_code IN ('6', '7') ORDER BY block_number LIMIT 20"
      : candidate.id.includes("manifest")
      ? "SELECT pool_key FROM market_pools WHERE source_code IN (6, 7) ORDER BY block_number LIMIT 20"
      : "SELECT pool_key FROM market_pools WHERE source_id IN ('up-v2', 'up-cl') ORDER BY block_number LIMIT 20"
  );

  const before = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM market_pools");
  let duplicateRejected = false;
  try {
    await client.query(`INSERT INTO market_pools SELECT * FROM market_pools LIMIT 1`);
  } catch (error) {
    duplicateRejected = error instanceof Error && "code" in error && error.code === "23505";
  }
  const after = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM market_pools");
  assert.equal(after.rows[0]?.count, before.rows[0]?.count);
  assert.equal(duplicateRejected, true);

  const beforeRollback = Number(before.rows[0]!.count);
  await client.query("BEGIN");
  await client.query(`DELETE FROM market_pools WHERE ${candidate.sourcePredicate} AND block_number > $1`, [cursor.block_number]);
  await client.query("ROLLBACK");
  const afterRollback = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM market_pools");
  assert.equal(Number(afterRollback.rows[0]!.count), beforeRollback);

  const firstPage = await client.query<{
    pool_key: Buffer | string;
    block_number: string;
    transaction_index: number | null;
    log_index: number;
  }>(
    `SELECT pool_key, block_number::text,
            ${candidate.hasTransactionIndex ? "transaction_index" : "NULL::integer"} AS transaction_index,
            log_index
     FROM market_pools ORDER BY ${candidate.paginationOrder} LIMIT 100`
  );
  const boundary = firstPage.rows.at(-1)!;
  const secondPage = await client.query<{ pool_key: Buffer | string }>(
    candidate.hasTransactionIndex
      ? `SELECT pool_key FROM market_pools
         WHERE (block_number, transaction_index, log_index) < ($1::bigint, $2::integer, $3::integer)
         ORDER BY ${candidate.paginationOrder} LIMIT 100`
      : `SELECT pool_key FROM market_pools
         WHERE (block_number, log_index) < ($1::integer, $2::integer)
         ORDER BY ${candidate.paginationOrder} LIMIT 100`,
    candidate.hasTransactionIndex
      ? [boundary.block_number, boundary.transaction_index, boundary.log_index]
      : [boundary.block_number, boundary.log_index]
  );
  const firstIdentities = new Set(firstPage.rows.map((row) => Buffer.isBuffer(row.pool_key)
    ? row.pool_key.toString("hex")
    : row.pool_key));
  assert.equal(secondPage.rows.some((row) => firstIdentities.has(Buffer.isBuffer(row.pool_key)
    ? row.pool_key.toString("hex")
    : row.pool_key)), false);

  let invariants: Record<string, boolean> | null = null;
  if (candidate.id.startsWith("packed_manifest_")) {
    const sourceSet = await client.query<{
      source_id: string;
      protocol: string;
      protocol_version: number;
      chain_id: string;
    }>("SELECT source_id, protocol, protocol_version, chain_id::text FROM sources ORDER BY source_id");
    const v4 = await client.query<{
      pool_key_length: number;
      attributes_length: number;
      provenance_length: number;
      token0: string;
    }>(`SELECT octet_length(pool_key) AS pool_key_length,
              octet_length(attributes) AS attributes_length,
              octet_length(provenance) AS provenance_length,
              encode(token0, 'hex') AS token0
       FROM market_pools WHERE source_code = ${candidate.hashedIdentity ? "'5'" : "5"} AND token0 = decode($1, 'hex')`,
      ["e934e36a439c94017b64a3fece66af12099abf50"]);
    const addressPool = await client.query<{ key_length: number; derived_equal: boolean }>(
      `SELECT octet_length(pool_key) AS key_length, pool_key = pool_key AS derived_equal
       FROM market_pools WHERE source_code IN (${candidate.hashedIdentity ? "'1', '2', '3', '4', '6', '7'" : "1, 2, 3, 4, 6, 7"}) LIMIT 1`
    );
    invariants = {
      exactSevenSourceBinding:
        JSON.stringify(sourceSet.rows) === JSON.stringify([
          { source_id: "sushiswap-v2", protocol: "sushiswap", protocol_version: 2, chain_id: "4663" },
          { source_id: "sushiswap-v3", protocol: "sushiswap", protocol_version: 3, chain_id: "4663" },
          { source_id: "uniswap-v2", protocol: "uniswap", protocol_version: 2, chain_id: "4663" },
          { source_id: "uniswap-v3", protocol: "uniswap", protocol_version: 3, chain_id: "4663" },
          { source_id: "uniswap-v4", protocol: "uniswap", protocol_version: 4, chain_id: "4663" },
          { source_id: "up-cl", protocol: "up", protocol_version: 3, chain_id: "4663" },
          { source_id: "up-v2", protocol: "up", protocol_version: 2, chain_id: "4663" }
        ]),
      v4PoolIdBytes32: v4.rows[0]?.pool_key_length === 32,
      v4PoolAddressDerivedNull: v4.rows.length === 1,
      stonkbrokerEvidencePreserved:
        v4.rows[0]?.token0 === "e934e36a439c94017b64a3fece66af12099abf50", // gitleaks:allow -- public test-only contract
      v4AttributesPreserved: v4.rows[0]?.attributes_length === 25,
      transactionAndBlockHashesPreserved: v4.rows[0]?.provenance_length === 64,
      v2V3PoolAddressDerivable:
        addressPool.rows[0]?.key_length === 20 && addressPool.rows[0]?.derived_equal === true,
      rollbackTransactionPreserved: Number(afterRollback.rows[0]!.count) === beforeRollback
    };
    assert.ok(Object.values(invariants).every(Boolean));
  }

  const heapBytes = Number(relation.rows[0]!.heap_bytes);
  const indexBytes = Number(relation.rows[0]!.index_bytes);
  const totalBytes = Number(relation.rows[0]!.total_bytes);
  return {
    candidate: candidate.id,
    rows,
    insertMs: Math.round(insertMs * 1000) / 1000,
    insertsPerSecond: Math.round((rows / insertMs) * 1000),
    heapBytes,
    primaryKeyBytes: indexes.rows.filter((index) => index.primary).reduce((sum, index) => sum + Number(index.bytes), 0),
    uniqueIndexBytes: indexes.rows.filter((index) => index.unique_index && !index.primary).reduce((sum, index) => sum + Number(index.bytes), 0),
    secondaryIndexBytes: indexes.rows.filter((index) => !index.unique_index).reduce((sum, index) => sum + Number(index.bytes), 0),
    indexBytes,
    totalBytes,
    heapBytesPerPool: heapBytes / rows,
    indexBytesPerPool: indexBytes / rows,
    totalBytesPerPool: totalBytes / rows,
    indexes: indexes.rows,
    queries: {
      pagination,
      sourcePagination,
      token,
      poolKey,
      v4PoolId,
      rollback,
      enrichment
    },
    duplicateRejected,
    adjacentPagesOverlap: false,
    eventConflictColumns: candidate.eventConflictColumns,
    invariants
  };
}

async function measureSyncPointRetention(client: pg.Client) {
  const measurements = [];
  for (const variant of ["current_unbounded_projection", "compact_bounded_64"] as const) {
    const schema = `${SCHEMA_PREFIX}sync_${variant}`;
    assert.match(schema, /^[a-z0-9_]+$/);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const compact = variant === "compact_bounded_64";
    await client.query(compact
      ? `CREATE UNLOGGED TABLE sync_points (
           source_code \"char\" NOT NULL CHECK (source_code BETWEEN '1' AND '7'),
           block_number INTEGER NOT NULL CHECK (block_number >= 0),
           provenance BYTEA NOT NULL CHECK (octet_length(provenance) = 64),
           PRIMARY KEY (source_code, block_number)
         ) WITH (fillfactor = 100)`
      : `CREATE UNLOGGED TABLE sync_points (
           chain_id BIGINT NOT NULL,
           source_id TEXT NOT NULL,
           block_number BIGINT NOT NULL,
           block_hash TEXT NOT NULL,
           parent_hash TEXT NOT NULL,
           indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (chain_id, source_id, block_number)
         )`);
    const rows = compact ? 7 * 64 : 53_881;
    await client.query(compact
      ? `INSERT INTO sync_points (source_code, block_number, provenance)
         SELECT ((i - 1) % 7 + 1)::text::\"char\", (1000000 + i)::integer,
                decode(
                  md5('sync:block:' || i::text) || md5('sync:block:b:' || i::text) ||
                  md5('sync:parent:' || i::text) || md5('sync:parent:b:' || i::text),
                  'hex'
                )
         FROM generate_series(1, $1::integer) AS generated(i)`
      : `INSERT INTO sync_points (chain_id, source_id, block_number, block_hash, parent_hash)
         SELECT 4663,
                (ARRAY['sushiswap-v2','sushiswap-v3','uniswap-v2','uniswap-v3','uniswap-v4','up-v2','up-cl'])[((i - 1) % 7) + 1],
                (1000000 + i)::bigint,
                '0x' || md5('sync:block:' || i::text) || md5('sync:block:b:' || i::text),
                '0x' || md5('sync:parent:' || i::text) || md5('sync:parent:b:' || i::text)
         FROM generate_series(1, $1::integer) AS generated(i)`, [rows]);
    await client.query("VACUUM (ANALYZE) sync_points");
    const size = await client.query<{ heap: string; indexes: string; total: string }>(
      `SELECT pg_relation_size('sync_points')::text AS heap,
              pg_indexes_size('sync_points')::text AS indexes,
              pg_total_relation_size('sync_points')::text AS total`
    );
    measurements.push({
      variant,
      rows,
      heapBytes: Number(size.rows[0]!.heap),
      indexBytes: Number(size.rows[0]!.indexes),
      totalBytes: Number(size.rows[0]!.total)
    });
  }
  return measurements;
}

const client = new pg.Client({ connectionString: requiredLocalUrl(), ssl: false });
await client.connect();
try {
  const version = await client.query<{ version: string }>("SELECT version()");
  const results = [];
  for (const rows of rowCounts()) {
    for (const candidate of selectedCandidates()) {
      results.push(await measureCandidate(client, candidate, rows));
    }
  }
  const syncPointRetention = await measureSyncPointRetention(client);
  const winning = results
    .filter((result) => result.candidate === "packed_manifest_coordinates")
    .sort((a, b) => b.rows - a.rows)[0];
  const projectedFinalPoolCount = 940_375;
  const conservativePoolCount = Math.ceil(projectedFinalPoolCount * 1.1);
  const compactSyncBytes = syncPointRetention.find(
    (measurement) => measurement.variant === "compact_bounded_64"
  )!.totalBytes;
  const fixedOtherBytes = 8_345_279 + 294_912;
  const projection = winning
    ? {
        observedProjectedFinalPoolCount: projectedFinalPoolCount,
        conservativePoolCount,
        uncertaintyBps: 1_000,
        measuredBytesPerPool: winning.totalBytesPerPool,
        projectedFinalLogicalBytes: Math.ceil(
          projectedFinalPoolCount * winning.totalBytesPerPool + compactSyncBytes + fixedOtherBytes
        ),
        conservativeProjectedFinalLogicalBytes: Math.ceil(
          conservativePoolCount * winning.totalBytesPerPool + compactSyncBytes + fixedOtherBytes
        ),
        configuredLimitBytes: 367_001_600,
        warningThresholdBytes: Math.floor(367_001_600 * 0.8)
      }
    : null;
  process.stdout.write(JSON.stringify({
    benchmarkVersion: 1,
    postgresVersion: version.rows[0]!.version,
    generatedAt: new Date().toISOString(),
    dataset: {
      deterministic: true,
      sourceMixBasis: "#419 catalog sample: 191290 pool rows",
      tokenReuse: "token0 every 3 rows; token1 every 5 rows",
      poolsPerSyntheticBlock: 3
    },
    results,
    syncPointRetention,
    projection
  }, null, 2) + "\n");
} finally {
  await client.end();
}
