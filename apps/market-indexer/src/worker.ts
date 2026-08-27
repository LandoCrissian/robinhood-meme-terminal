import type { Pool, PoolClient } from "pg";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Hex,
  type PublicClient
} from "viem";
import type { MarketIndexerConfig } from "./config.js";
import {
  compactBlockNumber,
  hexBytes,
  packPoolAttributes,
  packPoolProvenance,
  packSyncProvenance,
  sourceCodeForId
} from "./compact-storage.js";
import type { RawMarketLog } from "./decoder.js";
import { findReorgAncestor, replayMarketLogs, type SyncPoint } from "./replay.js";
import {
  migrateMarketIndexer,
  retainLatestSourceSyncPoints,
  rollbackSourceAfter
} from "./schema.js";
import {
  MARKET_INDEXER_CHAIN_ID,
  marketSources,
  UP_CL_POOL_IMPLEMENTATION,
  UP_V2_POOL_IMPLEMENTATION,
  UP_VOTER,
  type MarketSource
} from "./sources.js";
import {
  readMarketIndexerTelemetry,
  type MarketIndexerTelemetry
} from "./telemetry.js";
import { isUpSource, readUpPoolEvidence } from "./up-enrichment.js";
import {
  enqueueCanonicalTokenIdentityCandidates,
  readCanonicalTokenIdentityReconciliationStatus,
  refreshCanonicalTokenIdentityIndex,
  type TokenIdentityReconciliationStatus
} from "./token-identity-index.js";

export type WorkerStatus = {
  running: boolean;
  cycleSequence: number;
  verifiedSources: string[];
  verifiedDependencies: string[];
  indexedThrough: Record<string, string | null>;
  lastSyncAt: string | null;
  lastError: string | null;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastCycleDurationMs: number | null;
  lastFinalizedHead: string | null;
  tokenIdentityReconciliation: TokenIdentityReconciliationStatus | null;
  telemetry: MarketIndexerTelemetry | null;
};

const robinhoodChain = defineChain({
  id: MARKET_INDEXER_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com/"] } }
});

const upFactoryDependencyAbi = parseAbi([
  "function implementation() view returns (address)",
  "function poolImplementation() view returns (address)"
]);

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
       source_code, pool_key, token0, token1, attributes, provenance,
       block_number, log_index
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source_code, pool_key) DO UPDATE SET
       pool_key = EXCLUDED.pool_key
     WHERE market_pools.token0 = EXCLUDED.token0
       AND market_pools.token1 = EXCLUDED.token1
       AND market_pools.attributes IS NOT DISTINCT FROM EXCLUDED.attributes
       AND market_pools.provenance = EXCLUDED.provenance
       AND market_pools.block_number = EXCLUDED.block_number
       AND market_pools.log_index = EXCLUDED.log_index`,
    [
      sourceCodeForId(pool.sourceId),
      hexBytes(pool.poolKey, pool.version === 4 ? 32 : 20, "pool key"),
      hexBytes(pool.token0, 20, "token0"),
      hexBytes(pool.token1, 20, "token1"),
      packPoolAttributes(pool),
      packPoolProvenance(pool.transactionHash, pool.blockHash),
      compactBlockNumber(pool.blockNumber),
      pool.logIndex,
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
    verifiedDependencies: [],
    indexedThrough: Object.fromEntries(marketSources.map((source) => [source.id, null])),
    lastSyncAt: null,
    lastError: null,
    lastCycleStartedAt: null,
    lastCycleCompletedAt: null,
    lastCycleDurationMs: null,
    lastFinalizedHead: null,
    tokenIdentityReconciliation: null,
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
    this.status.verifiedSources = [];
    this.status.verifiedDependencies = [];
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
      const deployedAddress = receipt.contractAddress?.toLowerCase() ?? null;
      const expectedAddress = source.contract.toLowerCase();
      if (
        (source.protocol === "up" && deployedAddress !== expectedAddress) ||
        (source.protocol !== "up" &&
          deployedAddress !== null &&
          deployedAddress !== expectedAddress)
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
    const voterReceipt = await this.rpc.getTransactionReceipt({
      hash: UP_VOTER.deploymentTransaction
    });
    if (
      voterReceipt.status !== "success" ||
      voterReceipt.blockNumber !== UP_VOTER.startBlock ||
      voterReceipt.contractAddress?.toLowerCase() !==
        UP_VOTER.contract.toLowerCase()
    ) {
      throw new Error("up-voter deployment transaction or block does not match");
    }
    for (const dependency of [
      UP_VOTER,
      UP_V2_POOL_IMPLEMENTATION,
      UP_CL_POOL_IMPLEMENTATION
    ]) {
      const code = await this.rpc.getBytecode({ address: dependency.contract });
      if (!code || code === "0x" || keccak256(code) !== dependency.runtimeCodeHash) {
        throw new Error(`${dependency.id} runtime bytecode does not match`);
      }
      this.status.verifiedDependencies.push(dependency.id);
    }
    const upV2 = marketSources.find((source) => source.id === "up-v2")!;
    const upCl = marketSources.find((source) => source.id === "up-cl")!;
    const [v2Implementation, clImplementation] = await Promise.all([
      this.rpc.readContract({
        address: upV2.contract,
        abi: upFactoryDependencyAbi,
        functionName: "implementation"
      }),
      this.rpc.readContract({
        address: upCl.contract,
        abi: upFactoryDependencyAbi,
        functionName: "poolImplementation"
      })
    ]);
    if (
      v2Implementation.toLowerCase() !==
        UP_V2_POOL_IMPLEMENTATION.contract.toLowerCase() ||
      clImplementation.toLowerCase() !==
        UP_CL_POOL_IMPLEMENTATION.contract.toLowerCase()
    ) {
      throw new Error("up factory pool implementation drift");
    }
  }

  private async refreshUpPoolEvidence(
    finalizedHead: bigint,
    finalizedHash: Hex
  ) {
    const result = await this.pool.query<{
      source_id: string;
      pool_address: string;
      stable: boolean | null;
    }>(
      `SELECT manifest.source_id,
              '0x' || encode(pools.pool_key, 'hex') AS pool_address,
              CASE WHEN pools.source_code = 6 THEN get_byte(pools.attributes, 0) = 1 ELSE NULL END AS stable
       FROM market_pools AS pools
       JOIN market_indexer_source_state AS manifest
         ON manifest.source_code = pools.source_code
       LEFT JOIN market_pool_state AS state
         ON state.source_code = pools.source_code
        AND state.pool_key = pools.pool_key
       WHERE pools.source_code IN (6, 7)
       ORDER BY state.observed_block ASC NULLS FIRST,
                state.observed_at ASC NULLS FIRST,
                pools.block_number ASC,
                pools.log_index ASC
       LIMIT $1`,
      [this.config.enrichmentBatchSize]
    );
    let firstFailure: Error | null = null;
    for (const row of result.rows) {
      const source = marketSources.find(
        (candidate) => candidate.id === row.source_id
      );
      if (!source || !isUpSource(source)) {
        throw new Error(`unsupported up evidence source ${row.source_id}`);
      }
      const poolAddress = getAddress(row.pool_address);
      try {
        const evidence = await readUpPoolEvidence(
          this.rpc,
          source,
          poolAddress,
          row.stable,
          finalizedHead,
          finalizedHash
        );
        await this.pool.query(
          `INSERT INTO market_pool_state (
             source_code, pool_key, status, live_fee, fee_denominator,
             gauge_address, gauge_alive, gauge_weight, gauge_claimable,
             fees_address, bribe_address, last_error, observed_block,
             observed_block_hash, observed_at
           ) VALUES ($1,$2,'ready',$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,NOW())
           ON CONFLICT (source_code, pool_key) DO UPDATE SET
             status = EXCLUDED.status,
             live_fee = EXCLUDED.live_fee,
             fee_denominator = EXCLUDED.fee_denominator,
             gauge_address = EXCLUDED.gauge_address,
             gauge_alive = EXCLUDED.gauge_alive,
             gauge_weight = EXCLUDED.gauge_weight,
             gauge_claimable = EXCLUDED.gauge_claimable,
             fees_address = EXCLUDED.fees_address,
             bribe_address = EXCLUDED.bribe_address,
             last_error = NULL,
             observed_block = EXCLUDED.observed_block,
             observed_block_hash = EXCLUDED.observed_block_hash,
             observed_at = NOW()`,
          [
            sourceCodeForId(evidence.sourceId),
            hexBytes(evidence.poolAddress, 20, "up pool address"),
            evidence.liveFee,
            evidence.feeDenominator,
            evidence.gaugeAddress === null ? null : hexBytes(evidence.gaugeAddress, 20, "gauge address"),
            evidence.gaugeAlive,
            evidence.gaugeWeight,
            evidence.gaugeClaimable,
            evidence.feesAddress === null ? null : hexBytes(evidence.feesAddress, 20, "fees address"),
            evidence.bribeAddress === null ? null : hexBytes(evidence.bribeAddress, 20, "bribe address"),
            compactBlockNumber(evidence.observedBlock),
            hexBytes(evidence.observedBlockHash, 32, "observed block hash")
          ]
        );
      } catch (error) {
        const message = errorText(error) || "unknown up enrichment failure";
        firstFailure ??= new Error(`${source.id}:${poolAddress}: ${message}`);
        await this.pool.query(
          `INSERT INTO market_pool_state (
             source_code, pool_key, status, live_fee, fee_denominator,
             gauge_address, gauge_alive, gauge_weight, gauge_claimable,
             fees_address, bribe_address, last_error, observed_block,
             observed_block_hash, observed_at
           ) VALUES ($1,$2,'error',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$3,$4,$5,NOW())
           ON CONFLICT (source_code, pool_key) DO UPDATE SET
             status = EXCLUDED.status,
             live_fee = NULL,
             fee_denominator = NULL,
             gauge_address = NULL,
             gauge_alive = NULL,
             gauge_weight = NULL,
             gauge_claimable = NULL,
             fees_address = NULL,
             bribe_address = NULL,
             last_error = EXCLUDED.last_error,
             observed_block = EXCLUDED.observed_block,
             observed_block_hash = EXCLUDED.observed_block_hash,
             observed_at = NOW()`,
          [
            sourceCodeForId(source.id),
            hexBytes(poolAddress.toLowerCase(), 20, "up pool address"),
            message,
            compactBlockNumber(finalizedHead),
            hexBytes(finalizedHash.toLowerCase(), 32, "finalized block hash")
          ]
        );
      }
    }
    if (firstFailure) throw firstFailure;
  }

  private async reconcileSource(source: MarketSource) {
    const result = await this.pool.query<{
      block_number: string;
      block_hash: string;
    }>(
      `SELECT block_number::text,
              '0x' || encode(substring(provenance FROM 1 FOR 32), 'hex') AS block_hash
       FROM market_indexer_sync_points
       WHERE source_code = $1
       ORDER BY block_number DESC
       LIMIT 64`,
      [sourceCodeForId(source.id)]
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
           source_code, block_number, provenance
         ) VALUES ($1,$2,$3)
         ON CONFLICT (source_code, block_number) DO NOTHING`,
        [
          sourceCodeForId(source.id),
          compactBlockNumber(toBlock),
          packSyncProvenance(block.hash.toLowerCase(), block.parentHash.toLowerCase())
        ]
      );
      await retainLatestSourceSyncPoints(client, source.id);
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
      if (decoded.length > 0) {
        await enqueueCanonicalTokenIdentityCandidates(
          this.pool,
          decoded.flatMap((market) => [market.token0, market.token1]),
          decoded.length
        );
      }
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
        stateReadyPools: telemetry?.stateReadyPools ?? null,
        stateErrorPools: telemetry?.stateErrorPools ?? null,
        database: telemetry?.database ?? null,
        tokenIdentityReconciliation: this.status.tokenIdentityReconciliation,
        sources:
          telemetry?.sources.map((source) => ({
            sourceId: source.sourceId,
            status: source.status,
            indexedThrough: source.indexedThrough,
            lagBlocks: source.lagBlocks,
            poolCount: source.poolCount,
            stateReadyCount: source.stateReadyCount,
            stateErrorCount: source.stateErrorCount,
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
      const finalizedBlock = await this.rpc.getBlock({
        blockNumber: finalizedHead
      });
      if (!finalizedBlock.hash) {
        throw new Error("RPC omitted the finalized block hash");
      }
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
      try {
        await this.refreshUpPoolEvidence(finalizedHead, finalizedBlock.hash);
      } catch (error) {
        failure ??= new Error(`up enrichment: ${errorText(error)}`);
      }
      try {
        const identityRefresh = await refreshCanonicalTokenIdentityIndex(
          this.pool,
          this.rpc,
          this.config.tokenIdentityBatchSize,
          finalizedHead,
          finalizedBlock.hash
        );
        this.status.tokenIdentityReconciliation = identityRefresh.reconciliation;
      } catch (error) {
        failure ??= new Error(`token identity index: ${errorText(error)}`);
        try {
          this.status.tokenIdentityReconciliation =
            await readCanonicalTokenIdentityReconciliationStatus(this.pool);
        } catch {
          // The primary token-identity error above remains the truthful failure.
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
