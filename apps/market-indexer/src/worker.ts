import type { Pool, PoolClient } from "pg";
import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  type Block,
  type PublicClient
} from "viem";
import type { MarketIndexerConfig } from "./config.js";
import type { RawMarketLog } from "./decoder.js";
import { findReorgAncestor, replayMarketLogs, type SyncPoint } from "./replay.js";
import { migrateMarketIndexer, rollbackSourceAfter } from "./schema.js";
import {
  MARKET_INDEXER_CHAIN_ID,
  marketSources,
  type MarketSource
} from "./sources.js";
import {
  readMarketIndexerTelemetry,
  type MarketIndexerTelemetry
} from "./telemetry.js";

export type WorkerStatus = {
  running: boolean;
  cycleSequence: number;
  verifiedSources: string[];
  indexedThrough: Record<string, string | null>;
  lastSyncAt: string | null;
  lastError: string | null;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastCycleDurationMs: number | null;
  lastFinalizedHead: string | null;
  telemetry: MarketIndexerTelemetry | null;
};

const robinhoodChain = defineChain({
  id: MARKET_INDEXER_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com/"] } }
});

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_096);
}

function asRawLog(log: {
  address: `0x${string}`;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  blockNumber: bigint | null;
  blockHash: `0x${string}` | null;
  transactionHash: `0x${string}` | null;
  transactionIndex: number | null;
  logIndex: number | null;
  removed?: boolean;
}): RawMarketLog {
  if (
    log.blockNumber === null ||
    log.blockHash === null ||
    log.transactionHash === null ||
    log.transactionIndex === null ||
    log.logIndex === null
  ) {
    throw new Error("RPC returned an unconfirmed market log");
  }
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    removed: log.removed
  };
}

async function insertPool(
  client: PoolClient,
  pool: ReturnType<typeof replayMarketLogs>[number]
) {
  const result = await client.query(
    `INSERT INTO market_pools (
       chain_id, source_id, protocol, protocol_version, pool_key, pool_address,
       token0, token1, fee, tick_spacing, hooks, transaction_hash,
       transaction_index, log_index, block_number, block_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (chain_id, source_id, pool_key) DO UPDATE SET
       pool_address = EXCLUDED.pool_address
     WHERE market_pools.transaction_hash = EXCLUDED.transaction_hash
       AND market_pools.log_index = EXCLUDED.log_index
       AND market_pools.block_hash = EXCLUDED.block_hash`,
    [
      MARKET_INDEXER_CHAIN_ID,
      pool.sourceId,
      pool.protocol,
      pool.version,
      pool.poolKey,
      pool.poolAddress,
      pool.token0,
      pool.token1,
      pool.fee,
      pool.tickSpacing,
      pool.hooks,
      pool.transactionHash,
      pool.transactionIndex,
      pool.logIndex,
      pool.blockNumber.toString(),
      pool.blockHash
    ]
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `pool identity conflict for ${pool.sourceId}:${pool.poolKey}`
    );
  }
}

export class MarketIndexerWorker {
  readonly status: WorkerStatus = {
    running: false,
    cycleSequence: 0,
    verifiedSources: [],
    indexedThrough: Object.fromEntries(marketSources.map((source) => [source.id, null])),
    lastSyncAt: null,
    lastError: null,
    lastCycleStartedAt: null,
    lastCycleCompletedAt: null,
    lastCycleDurationMs: null,
    lastFinalizedHead: null,
    telemetry: null
  };

  private readonly rpc: PublicClient;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastHeartbeatLogAt = 0;
  private lastHeartbeatError: string | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly config: MarketIndexerConfig
  ) {
    this.rpc = createPublicClient({
      chain: robinhoodChain,
      transport: http(config.rpcUrl, {
        retryCount: 2,
        retryDelay: 500,
        timeout: 15_000
      })
    });
  }

  async verifySources() {
    const chainId = await this.rpc.getChainId();
    if (chainId !== MARKET_INDEXER_CHAIN_ID) {
      throw new Error(
        `MARKET_INDEXER_RPC_URL returned chain ${chainId}, expected ${MARKET_INDEXER_CHAIN_ID}`
      );
    }
    for (const source of marketSources) {
      const [receipt, current] = await Promise.all([
        this.rpc.getTransactionReceipt({
          hash: source.deploymentTransaction
        }),
        this.rpc.getBytecode({ address: source.contract })
      ]);
      if (receipt.status !== "success" || receipt.blockNumber !== source.startBlock) {
        throw new Error(`${source.id} deployment transaction or block does not match`);
      }
      if (
        receipt.contractAddress &&
        receipt.contractAddress.toLowerCase() !== source.contract.toLowerCase()
      ) {
        throw new Error(`${source.id} deployment transaction created a different contract`);
      }
      if (!current || current === "0x" || keccak256(current) !== source.runtimeCodeHash) {
        throw new Error(`${source.id} runtime bytecode does not match the reviewed manifest`);
      }
      let historical:
        | readonly [`0x${string}` | undefined, `0x${string}` | undefined]
        | null = null;
      try {
        historical = await Promise.all([
          this.rpc.getBytecode({
            address: source.contract,
            blockNumber: source.startBlock
          }),
          this.rpc.getBytecode({
            address: source.contract,
            blockNumber: source.startBlock - 1n
          })
        ]);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "market_source_archive_check_unavailable",
            sourceId: source.id,
            error: errorText(error)
          })
        );
      }
      if (historical) {
        const [atDeployment, beforeDeployment] = historical;
        if (!atDeployment || atDeployment === "0x") {
          throw new Error(`${source.id} has no code at its pinned deployment block`);
        }
        if (beforeDeployment && beforeDeployment !== "0x") {
          throw new Error(`${source.id} start block is later than deployment`);
        }
      }
      this.status.verifiedSources.push(source.id);
    }
  }

  private async reconcileSource(source: MarketSource) {
    const result = await this.pool.query<{
      block_number: string;
      block_hash: string;
    }>(
      `SELECT block_number, block_hash
       FROM market_indexer_sync_points
       WHERE chain_id = $1 AND source_id = $2
       ORDER BY block_number DESC
       LIMIT 64`,
      [MARKET_INDEXER_CHAIN_ID, source.id]
    );
    const points: SyncPoint[] = result.rows.map((row) => ({
      blockNumber: BigInt(row.block_number),
      blockHash: row.block_hash
    }));
    if (points.length === 0) return;
    const newest = points[0]!;
    const newestBlock = await this.rpc.getBlock({ blockNumber: newest.blockNumber });
    if (newestBlock.hash?.toLowerCase() === newest.blockHash.toLowerCase()) return;

    const ancestor = await findReorgAncestor(points.slice(1), async (blockNumber) => {
      const block = await this.rpc.getBlock({ blockNumber });
      return block.hash ?? null;
    });
    const rollbackTo = ancestor ?? source.startBlock - 1n;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await rollbackSourceAfter(client, source.id, rollbackTo);
      await client.query("COMMIT");
      this.status.indexedThrough[source.id] = rollbackTo.toString();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async indexSource(source: MarketSource, finalizedHead: bigint) {
    await this.reconcileSource(source);
    const state = await this.pool.query<{ next_block: string }>(
      `SELECT next_block FROM market_indexer_source_state
       WHERE chain_id = $1 AND source_id = $2`,
      [MARKET_INDEXER_CHAIN_ID, source.id]
    );
    const row = state.rows[0];
    if (!row) throw new Error(`missing state for ${source.id}`);
    const fromBlock = BigInt(row.next_block);
    if (fromBlock > finalizedHead) {
      await this.pool.query(
        `UPDATE market_indexer_source_state
         SET status = 'shadow-ready', last_sync_at = NOW(), last_error = NULL, updated_at = NOW()
         WHERE chain_id = $1 AND source_id = $2`,
        [MARKET_INDEXER_CHAIN_ID, source.id]
      );
      return;
    }
    const toBlock =
      fromBlock + BigInt(this.config.batchSize - 1) < finalizedHead
        ? fromBlock + BigInt(this.config.batchSize - 1)
        : finalizedHead;
    const [logs, block] = await Promise.all([
      this.rpc.getLogs({
        address: source.contract,
        event: source.event,
        fromBlock,
        toBlock,
        strict: true
      }),
      this.rpc.getBlock({ blockNumber: toBlock })
    ]);
    if (!block.hash || !block.parentHash) {
      throw new Error(`RPC omitted checkpoint provenance for ${source.id}`);
    }
    const decoded = replayMarketLogs(source, logs.map(asRawLog));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const pool of decoded) await insertPool(client, pool);
      await client.query(
        `INSERT INTO market_indexer_sync_points (
           chain_id, source_id, block_number, block_hash, parent_hash
         ) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (chain_id, source_id, block_number) DO NOTHING`,
        [
          MARKET_INDEXER_CHAIN_ID,
          source.id,
          toBlock.toString(),
          block.hash.toLowerCase(),
          block.parentHash.toLowerCase()
        ]
      );
      await client.query(
        `UPDATE market_indexer_source_state
         SET next_block = $3, status = $4, last_sync_at = NOW(),
             last_error = NULL, updated_at = NOW()
         WHERE chain_id = $1 AND source_id = $2`,
        [
          MARKET_INDEXER_CHAIN_ID,
          source.id,
          (toBlock + 1n).toString(),
          toBlock === finalizedHead ? "shadow-ready" : "backfilling"
        ]
      );
      await client.query("COMMIT");
      this.status.indexedThrough[source.id] = toBlock.toString();
      this.status.lastSyncAt = new Date().toISOString();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async restoreRebuildableStateIfNeeded() {
    if (this.config.storageMode !== "rebuildable") return;
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM market_indexer_source_state
       WHERE chain_id = $1`,
      [MARKET_INDEXER_CHAIN_ID]
    );
    if (Number(result.rows[0]?.count ?? 0) === marketSources.length) return;
    console.warn(
      JSON.stringify({
        event: "market_indexer_rebuildable_state_reset",
        reason: "source state missing after database recovery"
      })
    );
    await migrateMarketIndexer(this.pool, "rebuildable");
  }

  private async assertDatabaseWithinLimit() {
    if (this.config.databaseSizeLimitBytes === null) return;
    const result = await this.pool.query<{ bytes: string }>(
      "SELECT pg_database_size(current_database()) AS bytes"
    );
    const bytes = Number(result.rows[0]?.bytes);
    if (!Number.isSafeInteger(bytes)) {
      throw new Error("PostgreSQL returned an invalid database size");
    }
    if (bytes >= this.config.databaseSizeLimitBytes) {
      throw new Error(
        `market indexer database size limit reached: ${bytes} >= ` +
          this.config.databaseSizeLimitBytes
      );
    }
  }

  private async refreshTelemetry(finalizedHead: bigint | null) {
    const telemetry = await readMarketIndexerTelemetry(
      this.pool,
      finalizedHead,
      this.config.databaseSizeLimitBytes
    );
    this.status.telemetry = telemetry;
    this.status.lastFinalizedHead = telemetry.finalizedHead;
    for (const source of telemetry.sources) {
      this.status.indexedThrough[source.sourceId] = source.indexedThrough;
    }
  }

  private logHeartbeat() {
    const now = Date.now();
    const errorChanged = this.status.lastError !== this.lastHeartbeatError;
    if (
      this.lastHeartbeatLogAt !== 0 &&
      now - this.lastHeartbeatLogAt < this.config.heartbeatIntervalMs &&
      !errorChanged
    ) {
      return;
    }
    this.lastHeartbeatLogAt = now;
    this.lastHeartbeatError = this.status.lastError;
    const telemetry = this.status.telemetry;
    console.info(
      JSON.stringify({
        event: "market_indexer_heartbeat",
        mode: "shadow",
        authoritative: false,
        servingProductionTraffic: false,
        cycleSequence: this.status.cycleSequence,
        lastCycleCompletedAt: this.status.lastCycleCompletedAt,
        lastCycleDurationMs: this.status.lastCycleDurationMs,
        finalizedHead: this.status.lastFinalizedHead,
        totalPools: telemetry?.totalPools ?? null,
        database: telemetry?.database ?? null,
        sources:
          telemetry?.sources.map((source) => ({
            sourceId: source.sourceId,
            status: source.status,
            indexedThrough: source.indexedThrough,
            lagBlocks: source.lagBlocks,
            poolCount: source.poolCount,
            lastSyncAt: source.lastSyncAt,
            error: source.error
          })) ?? [],
        error: this.status.lastError
      })
    );
  }

  async tick() {
    if (this.status.running || this.stopped) return;
    this.status.running = true;
    this.status.cycleSequence += 1;
    const startedAt = Date.now();
    this.status.lastCycleStartedAt = new Date(startedAt).toISOString();
    let finalizedHead: bigint | null = null;
    let thrown: unknown = null;
    try {
      await this.assertDatabaseWithinLimit();
      await this.restoreRebuildableStateIfNeeded();
      const head = await this.rpc.getBlockNumber();
      const confirmations = BigInt(this.config.confirmations);
      if (head <= confirmations) throw new Error("chain head is below confirmation depth");
      finalizedHead = head - confirmations;
      let failure: Error | null = null;
      for (const source of marketSources) {
        try {
          await this.indexSource(source, finalizedHead);
        } catch (error) {
          const message = errorText(error);
          await this.pool.query(
            `UPDATE market_indexer_source_state
             SET status = 'error', last_error = $3, updated_at = NOW()
             WHERE chain_id = $1 AND source_id = $2`,
            [MARKET_INDEXER_CHAIN_ID, source.id, message]
          );
          failure ??= new Error(`${source.id}: ${message}`);
        }
      }
      this.status.lastError = failure?.message ?? null;
    } catch (error) {
      thrown = error;
      this.status.lastError = errorText(error);
    } finally {
      try {
        await this.refreshTelemetry(finalizedHead);
      } catch (error) {
        const message = `telemetry: ${errorText(error)}`;
        this.status.lastError = this.status.lastError
          ? `${this.status.lastError}; ${message}`.slice(0, 4_096)
          : message;
      }
      const completedAt = Date.now();
      this.status.lastCycleCompletedAt = new Date(completedAt).toISOString();
      this.status.lastCycleDurationMs = completedAt - startedAt;
      this.status.running = false;
      this.logHeartbeat();
    }
    if (thrown) throw thrown;
  }

  start() {
    const schedule = async () => {
      if (this.stopped) return;
      try {
        await this.tick();
      } catch (error) {
        this.status.lastError = errorText(error);
      } finally {
        if (!this.stopped) {
          this.timer = setTimeout(schedule, this.config.pollIntervalMs);
        }
      }
    };
    void schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
