import {
  compareRmtNftCheckpointToCanonicalHash,
  planRmtNftActivityScan
} from '@rmt/shared/nft/activity-ingestion';
import {
  decodeVerifiedRmtNftActivityLog,
  RMT_ERC1155_TRANSFER_BATCH_TOPIC,
  RMT_ERC1155_TRANSFER_SINGLE_TOPIC,
  RMT_ERC721_TRANSFER_TOPIC,
  type RmtNftActivityEvent,
  type RmtNftRawLog
} from '@rmt/shared/nft/activity-domain';
import { createPublicClient, getAddress, http, type Address, type Hex } from 'viem';
import { robinhoodChain } from '@rmt/shared/chains';
import type { Pool } from 'pg';
import type { NftIndexerConfig } from './config.js';
import { NFT_INDEXER_SOURCES } from './sources.js';
import { verifyReviewedNftSources, type SourceVerificationRpc, type VerifiedNftSource } from './source-verification.js';
import {
  initializeVerifiedSources,
  persistProcessedRange,
  recordSourceError,
  recordSourceSuccess,
  readCheckpoint,
  retainedSyncPoints,
  rollbackToCommonAncestor
} from './storage.js';

type RpcLog = {
  address: Address; topics: readonly Hex[]; data: Hex; transactionHash: Hex | null; blockHash: Hex | null;
  blockNumber: Hex | null; logIndex: Hex | null; removed?: boolean;
};

export type NftIndexerRpc = SourceVerificationRpc & {
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<{ hash: Hex }>;
  getLogs(input: { address: Address; fromBlock: bigint; toBlock: bigint; topics: readonly Hex[] }): Promise<readonly RpcLog[]>;
};

export function activityTopicsForStandard(standard: VerifiedNftSource['standard']): readonly Hex[] {
  return standard === 'ERC721'
    ? [RMT_ERC721_TRANSFER_TOPIC]
    : [RMT_ERC1155_TRANSFER_SINGLE_TOPIC, RMT_ERC1155_TRANSFER_BATCH_TOPIC];
}

export function createNftIndexerRpc(rpcUrl: string): NftIndexerRpc {
  const client = createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl) });
  return {
    getChainId: () => client.getChainId(),
    getTransactionReceipt: async (input) => {
      const receipt = await client.getTransactionReceipt(input);
      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        contractAddress: receipt.contractAddress ?? null,
        to: receipt.to ?? null
      };
    },
    getBytecode: (input) => client.getBytecode(input),
    readContract: (input) => client.readContract(input),
    getBlockNumber: () => client.getBlockNumber(),
    getBlock: async (input) => {
      const block = await client.getBlock(input);
      if (!block.hash) throw new Error(`Canonical block ${input.blockNumber} has no hash`);
      return { hash: block.hash };
    },
    getLogs: async (input) => {
      const result = await client.request({
        method: 'eth_getLogs',
        params: [{
          address: input.address,
          fromBlock: `0x${input.fromBlock.toString(16)}`,
          toBlock: `0x${input.toBlock.toString(16)}`,
          topics: [input.topics]
        }]
      });
      return result as readonly RpcLog[];
    }
  };
}

export type NftIndexerWorkerStatus = Readonly<{
  running: boolean;
  verifiedSourceCount: number;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastError: string | null;
  reorgsRecovered: number;
}>;

export class NftIndexerWorker {
  private timer: NodeJS.Timeout | null = null;
  private cyclePromise: Promise<void> | null = null;
  private verifiedSources: readonly VerifiedNftSource[] = [];
  private state: NftIndexerWorkerStatus = {
    running: false, verifiedSourceCount: 0, lastCycleStartedAt: null,
    lastCycleCompletedAt: null, lastError: null, reorgsRecovered: 0
  };

  constructor(private readonly pool: Pool, private readonly config: NftIndexerConfig, private readonly rpc: NftIndexerRpc) {}

  get status() { return this.state; }

  async verifySources() {
    this.verifiedSources = await verifyReviewedNftSources(this.rpc, NFT_INDEXER_SOURCES);
    await initializeVerifiedSources(this.pool, this.verifiedSources);
    this.state = { ...this.state, verifiedSourceCount: this.verifiedSources.length };
  }

  private async recoverIfReorged(source: VerifiedNftSource) {
    const checkpoint = await readCheckpoint(this.pool, source);
    if (!checkpoint.lastProcessedBlock) return checkpoint;
    let canonicalHash: Hex | null = null;
    try {
      canonicalHash = (await this.rpc.getBlock({ blockNumber: checkpoint.lastProcessedBlock.number })).hash;
    } catch {
      canonicalHash = null;
    }
    if (compareRmtNftCheckpointToCanonicalHash(checkpoint, canonicalHash) === 'CANONICAL') return checkpoint;

    const retained = await retainedSyncPoints(this.pool, source);
    for (const candidate of retained) {
      if (candidate.number === checkpoint.lastProcessedBlock.number) continue;
      let current: Hex;
      try {
        current = (await this.rpc.getBlock({ blockNumber: candidate.number })).hash;
      } catch {
        continue;
      }
      if (current.toLowerCase() !== candidate.hash.toLowerCase()) continue;
      await rollbackToCommonAncestor(this.pool, source, candidate);
      this.state = { ...this.state, reorgsRecovered: this.state.reorgsRecovered + 1 };
      return readCheckpoint(this.pool, source);
    }
    throw new Error(`REORG_DETECTED: no retained common canonical ancestor for ${source.collectionAddress}`);
  }

  private decodeLogs(source: VerifiedNftSource, logs: readonly RpcLog[]) {
    const events: RmtNftActivityEvent[] = [];
    for (const log of logs) {
      const raw: RmtNftRawLog = {
        chainId: 4663,
        address: getAddress(log.address),
        topics: log.topics,
        data: log.data,
        transactionHash: log.transactionHash,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber === null ? null : BigInt(log.blockNumber),
        logIndex: log.logIndex === null ? null : Number(BigInt(log.logIndex)),
        removed: log.removed
      };
      const decoded = decodeVerifiedRmtNftActivityLog(raw, {
        projectId: source.projectId, collectionAddress: source.collectionAddress, standard: source.standard
      });
      if (decoded.status !== 'DECODED') throw new Error(`Rejected NFT activity log: ${decoded.reason}`);
      events.push(decoded.event);
    }
    return events.sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
  }

  private async processSource(source: VerifiedNftSource, chainHead: bigint) {
    const checkpoint = await this.recoverIfReorged(source);
    const plan = planRmtNftActivityScan({
      checkpoint,
      chainHead,
      finalityDepth: BigInt(this.config.finalityDepth),
      maxBlocksPerBatch: BigInt(this.config.batchSize),
      maxBatches: this.config.maxBatchesPerCycle
    });
    let expectedNextBlock = checkpoint.nextBlock;
    for (const range of plan.ranges) {
      const logs = await this.rpc.getLogs({
        address: source.collectionAddress,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        topics: activityTopicsForStandard(source.standard)
      });
      const events = this.decodeLogs(source, logs);
      const end = await this.rpc.getBlock({ blockNumber: range.toBlock });
      await persistProcessedRange({
        pool: this.pool, source, expectedNextBlock, toBlock: range.toBlock, toBlockHash: end.hash, events
      });
      expectedNextBlock = range.toBlock + 1n;
    }
    return plan.safeHead === null || expectedNextBlock > plan.safeHead ? 'SYNCED' as const : 'BACKFILLING' as const;
  }

  async runCycle() {
    if (this.cyclePromise) return this.cyclePromise;
    this.cyclePromise = (async () => {
      this.state = { ...this.state, lastCycleStartedAt: new Date().toISOString(), lastError: null };
      try {
        let chainHead: bigint;
        try {
          chainHead = await this.rpc.getBlockNumber();
        } catch (error) {
          await Promise.all(this.verifiedSources.map((source) => recordSourceError(this.pool, source, error)));
          throw error;
        }
        for (const source of this.verifiedSources) {
          try {
            const sourceStatus = await this.processSource(source, chainHead);
            await recordSourceSuccess(this.pool, source, sourceStatus);
          } catch (error) {
            await recordSourceError(this.pool, source, error);
            throw error;
          }
        }
        this.state = { ...this.state, lastCycleCompletedAt: new Date().toISOString() };
      } catch (error) {
        this.state = { ...this.state, lastError: error instanceof Error ? error.message : 'unknown error' };
        throw error;
      } finally {
        this.cyclePromise = null;
      }
    })();
    return this.cyclePromise;
  }

  start() {
    if (this.timer) return;
    this.state = { ...this.state, running: true };
    const schedule = () => {
      if (!this.state.running) return;
      this.timer = setTimeout(() => {
        void this.runCycle().catch((error) => console.error(JSON.stringify({ event: 'nft_indexer_cycle_failed', error: error instanceof Error ? error.message : 'unknown' }))).finally(schedule);
      }, this.config.pollIntervalMs);
    };
    void this.runCycle().catch((error) => console.error(JSON.stringify({ event: 'nft_indexer_cycle_failed', error: error instanceof Error ? error.message : 'unknown' }))).finally(schedule);
  }

  async stop() {
    this.state = { ...this.state, running: false };
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.cyclePromise;
  }
}
