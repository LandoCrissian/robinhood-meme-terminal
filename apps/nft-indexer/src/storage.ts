import type { Pool, PoolClient } from 'pg';
import type { RmtNftActivityEvent, RmtNftTokenMovement } from '@rmt/shared/nft/activity-domain';
import type { RmtNftActivityCheckpoint } from '@rmt/shared/nft/activity-ingestion';
import type { VerifiedNftSource } from './source-verification.js';

const lower = (value: string) => value.toLowerCase();

export type StoredSourceState = {
  source: VerifiedNftSource;
  checkpoint: RmtNftActivityCheckpoint;
};

export async function initializeVerifiedSources(pool: Pool, sources: readonly VerifiedNftSource[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const source of sources) {
      const address = lower(source.collectionAddress);
      await client.query(
        `INSERT INTO nft_indexer_source_state
          (chain_id,project_id,collection_address,standard,start_block,next_block,deployment_transaction,verified_at)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7)
         ON CONFLICT (chain_id,collection_address) DO UPDATE SET verified_at=EXCLUDED.verified_at`,
        [source.chainId, source.projectId, address, source.standard, source.startBlock.toString(), source.deploymentTransaction, source.verifiedAt]
      );
      const existing = await client.query<{
        project_id: string; standard: string; start_block: string; deployment_transaction: string;
      }>(`SELECT project_id,standard,start_block::text,deployment_transaction FROM nft_indexer_source_state WHERE chain_id=$1 AND collection_address=$2`, [source.chainId, address]);
      const row = existing.rows[0];
      if (!row || row.project_id !== source.projectId || row.standard !== source.standard
        || row.start_block !== source.startBlock.toString()
        || lower(row.deployment_transaction) !== lower(source.deploymentTransaction)) {
        throw new Error('Persisted NFT source provenance conflicts with the reviewed source');
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readCheckpoint(pool: Pool, source: VerifiedNftSource): Promise<RmtNftActivityCheckpoint> {
  const result = await pool.query<{
    next_block: string; last_processed_block: string | null; last_processed_hash: `0x${string}` | null;
  }>(`SELECT next_block::text,last_processed_block::text,last_processed_hash FROM nft_indexer_source_state WHERE chain_id=$1 AND collection_address=$2`, [source.chainId, lower(source.collectionAddress)]);
  const row = result.rows[0];
  if (!row) throw new Error('Verified NFT source has no durable checkpoint');
  return {
    schemaVersion: 1,
    chainId: 4663,
    projectId: source.projectId,
    collectionAddress: source.collectionAddress,
    standard: source.standard,
    nextBlock: BigInt(row.next_block),
    lastProcessedBlock: row.last_processed_block === null || row.last_processed_hash === null ? null : {
      number: BigInt(row.last_processed_block), hash: row.last_processed_hash
    }
  };
}

async function existingEvent(client: PoolClient, event: RmtNftActivityEvent) {
  const result = await client.query<{
    project_id: string; standard: string; block_number: string; block_hash: string;
    source_event: string; operator: string | null; market_meaning: string;
  }>(`SELECT project_id,standard,block_number::text,block_hash,source_event,operator,market_meaning
      FROM nft_activity_events WHERE chain_id=$1 AND collection_address=$2 AND transaction_hash=$3 AND log_index=$4`,
    [event.chainId, lower(event.collectionAddress), lower(event.transactionHash), event.logIndex]);
  return result.rows[0] ?? null;
}

function sameEvent(row: NonNullable<Awaited<ReturnType<typeof existingEvent>>>, event: RmtNftActivityEvent) {
  return row.project_id === event.projectId && row.standard === event.standard
    && row.block_number === event.blockNumber.toString() && lower(row.block_hash) === lower(event.blockHash)
    && row.source_event === event.sourceEvent && (row.operator === null ? event.operator === null : lower(row.operator) === lower(event.operator ?? ''))
    && row.market_meaning === event.marketMeaning;
}

async function applyOwnership(client: PoolClient, event: RmtNftActivityEvent, movement: RmtNftTokenMovement) {
  const collection = lower(event.collectionAddress);
  const tokenId = movement.tokenId.toString();
  if (event.standard === 'ERC721') {
    if (movement.amount !== 1n) throw new Error('ERC721 activity must move exactly one token instance');
    const current = await client.query<{ owner_address: string }>(
      `SELECT owner_address FROM nft_erc721_ownership WHERE chain_id=$1 AND collection_address=$2 AND token_id=$3 FOR UPDATE`,
      [event.chainId, collection, tokenId]
    );
    const owner = current.rows[0]?.owner_address ?? null;
    if (movement.kind === 'MINT') {
      if (owner !== null) throw new Error('ERC721 mint conflicts with existing ownership');
      await client.query(`INSERT INTO nft_erc721_ownership(chain_id,collection_address,token_id,owner_address) VALUES($1,$2,$3,$4)`,
        [event.chainId, collection, tokenId, lower(movement.to)]);
      return;
    }
    if (owner === null || lower(owner) !== lower(movement.from)) throw new Error('ERC721 transfer sender is not the current owner');
    if (movement.kind === 'BURN') {
      await client.query(`DELETE FROM nft_erc721_ownership WHERE chain_id=$1 AND collection_address=$2 AND token_id=$3`, [event.chainId, collection, tokenId]);
    } else {
      await client.query(`UPDATE nft_erc721_ownership SET owner_address=$4 WHERE chain_id=$1 AND collection_address=$2 AND token_id=$3`,
        [event.chainId, collection, tokenId, lower(movement.to)]);
    }
    return;
  }

  const mutate = async (account: string, delta: bigint) => {
    const canonical = lower(account);
    const current = await client.query<{ balance: string }>(
      `SELECT balance::text FROM nft_erc1155_balances WHERE chain_id=$1 AND collection_address=$2 AND token_id=$3 AND account_address=$4 FOR UPDATE`,
      [event.chainId, collection, tokenId, canonical]
    );
    const previous = BigInt(current.rows[0]?.balance ?? '0');
    const next = previous + delta;
    if (next < 0n) throw new Error('ERC1155 transfer would underflow the sender balance');
    if (next === 0n) {
      await client.query(`DELETE FROM nft_erc1155_balances WHERE chain_id=$1 AND collection_address=$2 AND token_id=$3 AND account_address=$4`,
        [event.chainId, collection, tokenId, canonical]);
    } else {
      await client.query(`INSERT INTO nft_erc1155_balances(chain_id,collection_address,token_id,account_address,balance)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(chain_id,collection_address,token_id,account_address) DO UPDATE SET balance=EXCLUDED.balance`,
        [event.chainId, collection, tokenId, canonical, next.toString()]);
    }
  };
  if (movement.kind !== 'MINT') await mutate(movement.from, -movement.amount);
  if (movement.kind !== 'BURN') await mutate(movement.to, movement.amount);
}

async function persistEvent(client: PoolClient, event: RmtNftActivityEvent) {
  const inserted = await client.query(
    `INSERT INTO nft_activity_events
      (chain_id,project_id,collection_address,standard,transaction_hash,log_index,block_number,block_hash,source_event,operator,market_meaning)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING 1`,
    [event.chainId, event.projectId, lower(event.collectionAddress), event.standard, lower(event.transactionHash), event.logIndex,
      event.blockNumber.toString(), lower(event.blockHash), event.sourceEvent, event.operator ? lower(event.operator) : null, event.marketMeaning]
  );
  if (inserted.rowCount === 0) {
    const row = await existingEvent(client, event);
    if (!row || !sameEvent(row, event)) throw new Error('Conflicting NFT event provenance for an existing logical identity');
    const movements = await client.query<{ movement_index: number; token_id: string; amount: string; from_address: string; to_address: string; kind: string }>(
      `SELECT movement_index,token_id::text,amount::text,from_address,to_address,kind FROM nft_activity_movements
       WHERE chain_id=$1 AND collection_address=$2 AND transaction_hash=$3 AND log_index=$4 ORDER BY movement_index`,
      [event.chainId, lower(event.collectionAddress), lower(event.transactionHash), event.logIndex]
    );
    const identical = movements.rows.length === event.movements.length && movements.rows.every((movement, index) => {
      const expected = event.movements[index]!;
      return movement.movement_index === index && movement.token_id === expected.tokenId.toString()
        && movement.amount === expected.amount.toString() && lower(movement.from_address) === lower(expected.from)
        && lower(movement.to_address) === lower(expected.to) && movement.kind === expected.kind;
    });
    if (!identical) throw new Error('Conflicting NFT movements for an existing logical event');
    return false;
  }
  for (const [index, movement] of event.movements.entries()) {
    await client.query(`INSERT INTO nft_activity_movements
      (chain_id,collection_address,transaction_hash,log_index,movement_index,token_id,amount,from_address,to_address,kind)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [event.chainId, lower(event.collectionAddress), lower(event.transactionHash), event.logIndex, index,
        movement.tokenId.toString(), movement.amount.toString(), lower(movement.from), lower(movement.to), movement.kind]);
    await applyOwnership(client, event, movement);
  }
  return true;
}

export async function persistProcessedRange(input: {
  pool: Pool; source: VerifiedNftSource; expectedNextBlock: bigint; toBlock: bigint; toBlockHash: `0x${string}`;
  events: readonly RmtNftActivityEvent[]; beforeCheckpoint?: () => Promise<void>;
}) {
  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ next_block: string }>(
      `SELECT next_block::text FROM nft_indexer_source_state WHERE chain_id=$1 AND collection_address=$2 FOR UPDATE`,
      [input.source.chainId, lower(input.source.collectionAddress)]
    );
    if (locked.rows[0]?.next_block !== input.expectedNextBlock.toString()) throw new Error('NFT checkpoint changed concurrently');
    for (const event of input.events) {
      if (event.blockNumber < input.expectedNextBlock || event.blockNumber > input.toBlock) throw new Error('NFT event falls outside the atomic range');
      await persistEvent(client, event);
    }
    await input.beforeCheckpoint?.();
    await client.query(`INSERT INTO nft_indexer_sync_points(chain_id,collection_address,block_number,block_hash)
      VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,collection_address,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash`,
      [input.source.chainId, lower(input.source.collectionAddress), input.toBlock.toString(), lower(input.toBlockHash)]);
    await client.query(`UPDATE nft_indexer_source_state SET next_block=$3,last_processed_block=$4,last_processed_hash=$5
      WHERE chain_id=$1 AND collection_address=$2`,
      [input.source.chainId, lower(input.source.collectionAddress), (input.toBlock + 1n).toString(), input.toBlock.toString(), lower(input.toBlockHash)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function retainedSyncPoints(pool: Pool, source: VerifiedNftSource) {
  const result = await pool.query<{ block_number: string; block_hash: `0x${string}` }>(
    `SELECT block_number::text,block_hash FROM nft_indexer_sync_points WHERE chain_id=$1 AND collection_address=$2 ORDER BY block_number DESC`,
    [source.chainId, lower(source.collectionAddress)]
  );
  return result.rows.map((row) => ({ number: BigInt(row.block_number), hash: row.block_hash }));
}

async function rebuildOwnership(client: PoolClient, source: VerifiedNftSource) {
  const collection = lower(source.collectionAddress);
  await client.query(`DELETE FROM nft_erc721_ownership WHERE chain_id=$1 AND collection_address=$2`, [source.chainId, collection]);
  await client.query(`DELETE FROM nft_erc1155_balances WHERE chain_id=$1 AND collection_address=$2`, [source.chainId, collection]);
  const rows = await client.query<{
    project_id: string; standard: 'ERC721' | 'ERC1155'; transaction_hash: `0x${string}`; log_index: number;
    block_number: string; block_hash: `0x${string}`; source_event: RmtNftActivityEvent['sourceEvent']; operator: `0x${string}` | null;
    movement_index: number; token_id: string; amount: string; from_address: `0x${string}`; to_address: `0x${string}`; kind: RmtNftTokenMovement['kind'];
  }>(`SELECT e.project_id,e.standard,e.transaction_hash,e.log_index,e.block_number::text,e.block_hash,e.source_event,e.operator,
      m.movement_index,m.token_id::text,m.amount::text,m.from_address,m.to_address,m.kind
      FROM nft_activity_events e JOIN nft_activity_movements m USING(chain_id,collection_address,transaction_hash,log_index)
      WHERE e.chain_id=$1 AND e.collection_address=$2 ORDER BY e.block_number,e.log_index,m.movement_index`, [source.chainId, collection]);
  for (const row of rows.rows) {
    const event = {
      schemaVersion: 1, chainId: 4663, projectId: row.project_id, collectionAddress: source.collectionAddress,
      standard: row.standard, transactionHash: row.transaction_hash, logIndex: row.log_index,
      blockNumber: BigInt(row.block_number), blockHash: row.block_hash, sourceEvent: row.source_event,
      operator: row.operator, movements: [], marketMeaning: 'NOT_ESTABLISHED'
    } as const satisfies RmtNftActivityEvent;
    await applyOwnership(client, event, {
      tokenId: BigInt(row.token_id), amount: BigInt(row.amount), from: row.from_address,
      to: row.to_address, kind: row.kind
    });
  }
}

export async function rollbackToCommonAncestor(pool: Pool, source: VerifiedNftSource, ancestor: { number: bigint; hash: `0x${string}` }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const collection = lower(source.collectionAddress);
    await client.query(`SELECT 1 FROM nft_indexer_source_state WHERE chain_id=$1 AND collection_address=$2 FOR UPDATE`, [source.chainId, collection]);
    await client.query(`DELETE FROM nft_activity_events WHERE chain_id=$1 AND collection_address=$2 AND block_number>$3`, [source.chainId, collection, ancestor.number.toString()]);
    await client.query(`DELETE FROM nft_indexer_sync_points WHERE chain_id=$1 AND collection_address=$2 AND block_number>$3`, [source.chainId, collection, ancestor.number.toString()]);
    await rebuildOwnership(client, source);
    await client.query(`UPDATE nft_indexer_source_state SET next_block=$3,last_processed_block=$4,last_processed_hash=$5
      WHERE chain_id=$1 AND collection_address=$2`, [source.chainId, collection, (ancestor.number + 1n).toString(), ancestor.number.toString(), lower(ancestor.hash)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
