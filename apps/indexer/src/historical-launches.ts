import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { decodeEventLog, type Hash, type TransactionReceipt } from "viem";
import { marketEvents, tokenLaunchedEvent } from "./abi.js";
import { classifySyncFailure } from "./rpc-resilience.js";

export const historicalFactory = "0x8e75c57079a01ce2094bc4187b78710887547651";
export const historicalStartBlock = 10_248_855n;
export const historicalFactoryCodeHash = "0x274321493d48091b4443e007b8335a93a977e67dffe67d6147ff8557a1e58830";
export const historicalConfirmationDepth = 20;
export const historicalCheckpointMaxAgeMs = 120_000;
const historicalFullProofMaxAgeMs = 90_000;
const historicalPageLimit = 25;
const historicalChainId = 4_663;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;

type RpcBlock = { number: bigint | null; hash: Hash | null; timestamp: bigint };
export type HistoricalBoundary = { blockNumber: bigint; blockHash: string; blockTimestamp: bigint };
export type HistoricalCheckpoint = HistoricalBoundary & { proofAt: number | null; verifiedAt: number };

export function historicalBoundary(block: RpcBlock, expectedHeight: bigint): HistoricalBoundary {
  if (block.number !== expectedHeight || !block.hash || !hashPattern.test(block.hash) || block.timestamp <= 0n) {
    throw new Error("Historical canonical checkpoint has invalid block evidence");
  }
  return { blockNumber: expectedHeight, blockHash: block.hash.toLowerCase(), blockTimestamp: block.timestamp };
}

export async function observeHistoricalCheckpoint(
  boundary: HistoricalBoundary,
  reusable: HistoricalCheckpoint | null,
  prove: () => Promise<boolean>,
  clock = Date.now
): Promise<HistoricalCheckpoint> {
  const now = clock();
  if (reusable && reusable.proofAt !== null &&
      reusable.blockNumber === boundary.blockNumber && reusable.blockHash === boundary.blockHash &&
      reusable.blockTimestamp === boundary.blockTimestamp && now >= reusable.verifiedAt &&
      now - reusable.proofAt < historicalFullProofMaxAgeMs) {
    return reusable;
  }
  const proofBackfillComplete = await prove();
  const proofAt = clock();
  return { ...boundary, proofAt: proofBackfillComplete ? proofAt : null, verifiedAt: proofAt };
}

export type HistoricalQuery =
  | { token: string }
  | { limit: number; before?: { blockNumber: number; logIndex: number } };

export function parseHistoricalQuery(params: URLSearchParams): HistoricalQuery | null {
  if (params.size > 2 || [...params.keys()].some((key) =>
      !["token", "limit", "cursor"].includes(key) || params.getAll(key).length !== 1)) return null;
  if (params.has("token")) {
    const token = params.get("token")!;
    return addressPattern.test(token) && params.size === 1 ? { token: token.toLowerCase() } : null;
  }
  const limit = params.get("limit") ?? historicalPageLimit.toString();
  if (!/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limit)) return null;
  if (!params.has("cursor")) return { limit: Number(limit) };
  const cursor = /^(\d{1,16})\.(\d{1,10})$/.exec(params.get("cursor")!);
  if (!cursor) return null;
  const blockNumber = Number(cursor[1]);
  const logIndex = Number(cursor[2]);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < Number(historicalStartBlock) || logIndex > 2_147_483_647) return null;
  return { limit: Number(limit), before: { blockNumber, logIndex } };
}

export function hasHistoricalReadAccess(token: string | null, authorization: string | undefined) {
  if (!token || !authorization) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function historicalCommonAncestor(
  points: readonly { block_number: string; block_hash: string }[],
  primary: (height: bigint) => Promise<RpcBlock>,
  archive?: (height: bigint) => Promise<RpcBlock>,
  onMismatch?: () => void
) {
  for (const point of points) {
    const height = BigInt(point.block_number);
    const canonical = historicalBoundary(
      await readWithArchive(() => primary(height), archive && (() => archive(height))),
      height
    );
    if (canonical.blockHash === point.block_hash.toLowerCase()) return canonical;
    onMismatch?.();

    // Do not discard data based on a single disagreeing provider or an absent archive block.
    const witness = await archive?.(height);
    if (!witness || historicalBoundary(witness, height).blockHash !== canonical.blockHash) {
      throw new Error("Historical reorg could not be witnessed by both configured providers");
    }
    // The read-with-fallback call might itself have returned the archive's answer.
    const primaryWitness = historicalBoundary(await primary(height), height);
    if (primaryWitness.blockHash !== canonical.blockHash) {
      throw new Error("Historical reorg could not be witnessed by both configured providers");
    }
  }
  throw new Error("Historical reorg exceeds the retained checkpoint comparison window");
}

export async function rollbackIndexRows(db: Pick<PoolClient, "query">, chainId: number, blockNumber: bigint) {
  const value = blockNumber.toString();
  await db.query("DELETE FROM fee_splitter_events WHERE block_number > $1", [value]);
  await db.query("DELETE FROM graduation_fee_collections WHERE block_number > $1", [value]);
  await db.query("DELETE FROM creator_payout_events WHERE block_number > $1", [value]);
  await db.query("DELETE FROM liquidity_migrations WHERE block_number > $1", [value]);
  await db.query("DELETE FROM graduations WHERE block_number > $1", [value]);
  await db.query("DELETE FROM trades WHERE block_number > $1", [value]);
  await db.query("DELETE FROM launches WHERE block_number > $1", [value]);
  await db.query("DELETE FROM sync_points WHERE chain_id = $1 AND block_number > $2", [chainId, value]);
  await db.query(
    "UPDATE indexer_state SET next_block = $2, updated_at = NOW() WHERE chain_id = $1",
    [chainId, (blockNumber + 1n).toString()]
  );
}

type ProofRow = {
  block_number: string;
  transaction_hash: Hash;
  log_index: number;
};

type RegistrationRow = ProofRow & {
  token: string;
  creator: string;
  market: string;
  launch_id: string;
  name: string;
  symbol: string;
};

type MigrationRow = ProofRow & {
  market: string;
  adapter: string;
  pool: string;
  eth_amount: string;
  token_amount: string;
  liquidity: string;
};

type Evidence = {
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  timestamp: string;
};

function evidence(row: ProofRow, blockHash: string | null, timestamp: Date | null): Evidence | null {
  const blockNumber = Number(row.block_number);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < Number(historicalStartBlock) ||
      !hashPattern.test(row.transaction_hash) || !blockHash || !hashPattern.test(blockHash) ||
      !Number.isInteger(row.log_index) || row.log_index < 0 || !timestamp || !Number.isFinite(timestamp.getTime())) return null;
  return {
    blockNumber,
    blockHash: blockHash.toLowerCase(),
    transactionHash: row.transaction_hash.toLowerCase(),
    logIndex: row.log_index,
    timestamp: timestamp.toISOString()
  };
}

type StoredHistorical = RegistrationRow & {
  block_hash: string | null;
  created_at: Date | null;
  migration_block_number: string | null;
  migration_block_hash: string | null;
  migration_transaction_hash: Hash | null;
  migration_log_index: number | null;
  migration_timestamp: Date | null;
};

/** Read a single PostgreSQL snapshot so an index rollback cannot split evidence and checkpoint. */
export async function readHistoricalLaunches(
  db: Pick<PoolClient, "query">,
  query: HistoricalQuery,
  verified: HistoricalCheckpoint,
  stale: boolean,
  now = Date.now()
) {
  const result = await db.query<{
    block_number: string;
    block_hash: string;
    block_timestamp: Date | null;
  }>(
    `SELECT s.block_number, s.block_hash, s.block_timestamp
     FROM sync_points s
     JOIN indexer_state i ON i.chain_id = s.chain_id AND s.block_number = i.next_block - 1
     WHERE s.chain_id = $1 AND i.factory = $2 AND i.start_block = $3`,
    [historicalChainId, historicalFactory, historicalStartBlock.toString()]
  );
  const point = result.rows[0];
  const blockNumber = Number(point?.block_number);
  if (!point || !Number.isSafeInteger(blockNumber) || blockNumber < Number(historicalStartBlock) ||
      !hashPattern.test(point.block_hash) || !point.block_timestamp ||
      point.block_timestamp.getTime() > verified.verifiedAt + 30_000 ||
      point.block_timestamp.getTime() !== Number(verified.blockTimestamp) * 1_000 ||
      BigInt(point.block_number) !== verified.blockNumber || point.block_hash.toLowerCase() !== verified.blockHash) return null;

  const isExact = "token" in query;
  const limit = isExact ? 1 : query.limit;
  const before = isExact ? undefined : query.before;
  const rows = await db.query<StoredHistorical>(
    `SELECT l.token, l.creator, l.market, l.launch_id, l.name, l.symbol,
            l.transaction_hash, l.block_number, l.log_index, l.block_hash, l.created_at,
            m.transaction_hash AS migration_transaction_hash,
            m.block_number AS migration_block_number, m.log_index AS migration_log_index,
            m.block_hash AS migration_block_hash, m.occurred_at AS migration_timestamp
     FROM launches l
     LEFT JOIN liquidity_migrations m ON m.market = l.market AND m.block_number <= $1
     WHERE l.protocol_version = 6 AND l.block_number BETWEEN $2 AND $1
       AND ($3::text IS NULL OR l.token = $3)
       AND ($4::bigint IS NULL OR (l.block_number, l.log_index) < ($4, $5::integer))
     ORDER BY l.block_number DESC, l.log_index DESC
     LIMIT $6`,
    [point.block_number, historicalStartBlock.toString(), isExact ? query.token : null,
      before?.blockNumber ?? null, before?.logIndex ?? null, limit + 1]
  );

  const launches = [];
  for (const row of rows.rows.slice(0, limit)) {
    const registration = evidence(row, row.block_hash, row.created_at);
    if (!registration || !addressPattern.test(row.token) || !addressPattern.test(row.creator) ||
        !addressPattern.test(row.market) || !/^\d{1,78}$/.test(row.launch_id)) return null;
    let lifecycleEvidence = null;
    if (row.migration_transaction_hash) {
      lifecycleEvidence = evidence({
        block_number: row.migration_block_number!,
        transaction_hash: row.migration_transaction_hash,
        log_index: row.migration_log_index!
      }, row.migration_block_hash, row.migration_timestamp);
      if (lifecycleEvidence && (lifecycleEvidence.blockNumber < registration.blockNumber ||
          (lifecycleEvidence.blockNumber === registration.blockNumber && lifecycleEvidence.logIndex <= registration.logIndex))) return null;
    }
    launches.push({
      token: row.token,
      creator: row.creator,
      curve: row.market,
      launchId: row.launch_id,
      name: row.name,
      symbol: row.symbol,
      registration,
      lifecycle: lifecycleEvidence ? "graduated" as const : "unknown" as const,
      lifecycleEvidence,
      pool: null,
      custody: null
    });
  }
  const last = launches.at(-1);
  return {
    schemaVersion: 1 as const,
    chainId: historicalChainId,
    factory: historicalFactory,
    checkpoint: {
      blockNumber,
      blockHash: point.block_hash.toLowerCase(),
      timestamp: point.block_timestamp.toISOString(),
      observedAt: new Date(verified.verifiedAt).toISOString(),
      stale: stale || now - point.block_timestamp.getTime() > 300_000,
      finality: "l2-confirmed" as const
    },
    launches,
    nextCursor: rows.rows.length > limit && last ? `${last.registration.blockNumber}.${last.registration.logIndex}` : null
  };
}

export type HistoricalProofRpc = {
  getTransactionReceipt(request: { hash: Hash }): Promise<Pick<
    TransactionReceipt, "status" | "transactionHash" | "blockNumber" | "blockHash" | "logs"
  >>;
  getBlock(request: { blockNumber: bigint }): Promise<{
    number: bigint | null;
    hash: Hash | null;
    timestamp: bigint;
  }>;
};

function missingProof(error: unknown) {
  return error instanceof Error && ["BlockNotFoundError", "TransactionReceiptNotFoundError"].includes(error.name);
}

export async function readWithArchive<T>(primary: () => Promise<T>, archive?: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (!archive || (classifySyncFailure(error) !== "upstream" && !missingProof(error))) throw error;
    return archive();
  }
}

async function receiptProof(primary: HistoricalProofRpc, archive: HistoricalProofRpc | undefined, row: ProofRow, emitter: string) {
  const blockNumber = BigInt(row.block_number);
  const [receipt, block] = await Promise.all([
    readWithArchive(() => primary.getTransactionReceipt({ hash: row.transaction_hash }),
      archive && (() => archive.getTransactionReceipt({ hash: row.transaction_hash }))),
    readWithArchive(() => primary.getBlock({ blockNumber }), archive && (() => archive.getBlock({ blockNumber })))
  ]);
  if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== row.transaction_hash.toLowerCase() ||
      receipt.blockNumber !== blockNumber || block.number !== blockNumber ||
      !block.hash || receipt.blockHash.toLowerCase() !== block.hash.toLowerCase()) {
    throw new Error("Receipt and canonical block disagree for historical launch evidence");
  }
  const matches = receipt.logs.filter((log) => log.logIndex === row.log_index);
  const log = matches[0];
  if (matches.length !== 1 || !log || log.address.toLowerCase() !== emitter || log.removed ||
      log.blockNumber !== blockNumber || log.blockHash?.toLowerCase() !== block.hash.toLowerCase() ||
      log.transactionHash?.toLowerCase() !== row.transaction_hash.toLowerCase()) {
    throw new Error("Historical launch receipt did not prove the indexed event");
  }
  return { data: log.data, topics: log.topics, blockHash: block.hash.toLowerCase(), timestamp: block.timestamp };
}

/** Prove only bounded stored event identities. Existing PostgreSQL rows resume without rewriting history. */
export async function proveHistoricalRows(db: Pick<PoolClient, "query">, primary: HistoricalProofRpc, archive?: HistoricalProofRpc) {
  const registrations = await db.query<RegistrationRow>(
    `SELECT block_number, transaction_hash, log_index, token, creator, market, launch_id, name, symbol
     FROM launches WHERE protocol_version = 6 AND block_number >= $1 AND block_hash IS NULL
     ORDER BY block_number DESC, log_index DESC LIMIT $2`,
    [historicalStartBlock.toString(), historicalPageLimit]
  );
  for (const row of registrations.rows) {
    const proof = await receiptProof(primary, archive, row, historicalFactory);
    const event = decodeEventLog({ abi: [tokenLaunchedEvent], ...proof });
    if (event.args.token.toLowerCase() !== row.token || event.args.creator.toLowerCase() !== row.creator ||
        event.args.market.toLowerCase() !== row.market || event.args.launchId.toString() !== row.launch_id ||
        event.args.name !== row.name || event.args.symbol !== row.symbol) {
      throw new Error("Factory event does not match indexed historical registration");
    }
    await db.query(
      `UPDATE launches SET block_hash = $1, created_at = to_timestamp($2::double precision)
       WHERE token = $3 AND block_number = $4 AND transaction_hash = $5 AND log_index = $6 AND block_hash IS NULL`,
      [proof.blockHash, proof.timestamp.toString(), row.token, row.block_number, row.transaction_hash, row.log_index]
    );
  }

  const migrations = await db.query<MigrationRow>(
    `SELECT m.block_number, m.transaction_hash, m.log_index, m.market, m.adapter, m.pool,
            m.eth_amount, m.token_amount, m.liquidity
     FROM liquidity_migrations m JOIN launches l ON l.market = m.market AND l.block_hash IS NOT NULL
     WHERE m.block_hash IS NULL
     ORDER BY m.block_number DESC, m.log_index DESC LIMIT $1`,
    [historicalPageLimit]
  );
  for (const row of migrations.rows) {
    const proof = await receiptProof(primary, archive, row, row.market);
    const event = decodeEventLog({ abi: [marketEvents[2]], ...proof });
    if (event.args.adapter.toLowerCase() !== row.adapter || event.args.pool.toLowerCase() !== row.pool ||
        event.args.ethAmount === 0n || event.args.ethAmount.toString() !== row.eth_amount ||
        event.args.tokenAmount === 0n || event.args.tokenAmount.toString() !== row.token_amount ||
        event.args.liquidity === 0n || event.args.liquidity.toString() !== row.liquidity) {
      throw new Error("Migration event does not match indexed historical settlement");
    }
    await db.query(
      `UPDATE liquidity_migrations SET block_hash = $1, occurred_at = to_timestamp($2::double precision)
       WHERE market = $3 AND block_number = $4 AND transaction_hash = $5 AND log_index = $6 AND block_hash IS NULL`,
      [proof.blockHash, proof.timestamp.toString(), row.market, row.block_number, row.transaction_hash, row.log_index]
    );
  }
  // A full batch may leave additional rows to prove at the next poll, even at the same checkpoint.
  return registrations.rows.length < historicalPageLimit && migrations.rows.length < historicalPageLimit;
}
