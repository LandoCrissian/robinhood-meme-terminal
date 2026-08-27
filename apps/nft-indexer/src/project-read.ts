import type { Pool } from "pg";
import type { RmtNftProjectOnchainRead } from "@rmt/shared/nft/project-market";
import { rmtCuratedNftProject } from "@rmt/shared/nft/project-registry";
import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import { getAddress, type Address, type Hex } from "viem";

const MAX_ACTIVITY = 20;

export class NftProjectNotFoundError extends Error {}

export async function readNftProjectOnchain(
  pool: Pool,
  projectId: string,
  now: Date = new Date(),
): Promise<RmtNftProjectOnchainRead> {
  const project = rmtCuratedNftProject(projectId);
  if (!project || project.status !== "ACTIVE") throw new NftProjectNotFoundError("NFT project is not publicly admitted.");
  const source = RMT_NFT_ACTIVITY_SOURCES.find((item) => item.projectId === project.projectId);
  if (!source) throw new NftProjectNotFoundError("NFT project has no reviewed activity source.");

  const state = await pool.query<{ status: "BACKFILLING" | "SYNCED" | "ERROR"; last_sync_at: Date | null }>(
    `SELECT status,last_sync_at FROM nft_indexer_source_state
     WHERE chain_id=$1 AND project_id=$2 AND lower(collection_address)=lower($3) AND standard=$4`,
    [source.chainId, source.projectId, source.collectionAddress, source.standard],
  );
  const row = state.rows[0];
  if (!row) throw new NftProjectNotFoundError("NFT project source is not initialized.");
  const availability = row.status === "SYNCED" ? "AVAILABLE" : row.status === "BACKFILLING" ? "PARTIAL" : "UNAVAILABLE";

  let holderCount: string | null = null;
  let circulatingTokenCount: string | null = null;
  if (row.status === "SYNCED" && source.standard === "ERC721") {
    const counts = await pool.query<{ holder_count: string; token_count: string }>(
      `SELECT count(DISTINCT owner_address)::text AS holder_count,count(*)::text AS token_count
       FROM nft_erc721_ownership WHERE chain_id=$1 AND lower(collection_address)=lower($2)`,
      [source.chainId, source.collectionAddress],
    );
    holderCount = counts.rows[0]?.holder_count ?? "0";
    circulatingTokenCount = counts.rows[0]?.token_count ?? "0";
  }

  const activity = row.status === "ERROR" ? { rows: [] } : await pool.query<{
    transaction_hash: Hex; block_number: string; block_hash: Hex; log_index: number;
    movement_index: number; kind: "MINT" | "TRANSFER" | "BURN"; from_address: Address;
    to_address: Address; token_id: string; amount: string; market_meaning: "NOT_ESTABLISHED";
  }>(
    `SELECT e.transaction_hash,e.block_number::text,e.block_hash,e.log_index,m.movement_index,m.kind,
       m.from_address,m.to_address,m.token_id::text,m.amount::text,e.market_meaning
     FROM nft_activity_events e JOIN nft_activity_movements m
       USING(chain_id,collection_address,transaction_hash,log_index)
     WHERE e.chain_id=$1 AND e.project_id=$2 AND lower(e.collection_address)=lower($3)
     ORDER BY e.block_number DESC,e.log_index DESC,m.movement_index DESC LIMIT $4`,
    [source.chainId, source.projectId, source.collectionAddress, MAX_ACTIVITY],
  );

  return {
    schemaVersion: 1,
    projectId: project.projectId,
    chainId: source.chainId,
    collectionAddress: source.collectionAddress,
    collectionStandard: source.standard,
    sourceStatus: row.status,
    availability,
    completeness: row.status === "SYNCED" ? "COMPLETE" : row.status === "BACKFILLING" ? "PARTIAL" : "UNAVAILABLE",
    holderCount,
    circulatingTokenCount,
    recentActivity: activity.rows.map((item) => ({
      transactionHash: item.transaction_hash,
      blockNumber: item.block_number,
      blockHash: item.block_hash,
      logIndex: item.log_index,
      movementIndex: item.movement_index,
      kind: item.kind,
      from: getAddress(item.from_address),
      to: getAddress(item.to_address),
      tokenId: item.token_id,
      amount: item.amount,
      marketMeaning: item.market_meaning,
    })),
    asOf: (row.last_sync_at ?? now).toISOString(),
  };
}
