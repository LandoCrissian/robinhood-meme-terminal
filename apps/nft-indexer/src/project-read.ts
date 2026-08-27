import type { Pool } from "pg";
import type { RmtNftProjectOnchainRead } from "@rmt/shared/nft/project-market";
import type {
  RmtNftInventoryItem,
  RmtNftItemRead,
  RmtNftProjectInventoryRead,
} from "@rmt/shared/nft/project-inventory";
import { rmtCuratedNftProject } from "@rmt/shared/nft/project-registry";
import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import { getAddress, isAddressEqual, zeroAddress, type Address, type Hex } from "viem";
import { resolveOnchainTokenMetadata } from "./metadata.js";

const MAX_ACTIVITY = 20;
export const DEFAULT_INVENTORY_LIMIT = 24;
export const MAX_INVENTORY_LIMIT = 48;
const MIN_FRESHNESS_MS = 5 * 60 * 1_000;
const MAX_UINT256 = (1n << 256n) - 1n;

export class NftProjectNotFoundError extends Error {}
export class NftProjectReadInputError extends Error {}

export type NftInventoryRpc = {
  readTokenUri(input: { address: Address; tokenId: bigint }): Promise<unknown>;
  readTokenBoundAccount(input: { address: Address; tokenId: bigint }): Promise<unknown>;
};

type SourceState = { status: "BACKFILLING" | "SYNCED" | "ERROR"; last_sync_at: Date | null };

function reviewedProjectSource(projectId: string) {
  const project = rmtCuratedNftProject(projectId);
  if (!project || project.status !== "ACTIVE") throw new NftProjectNotFoundError("NFT project is not publicly admitted.");
  const source = RMT_NFT_ACTIVITY_SOURCES.find((item) => item.projectId === project.projectId);
  if (!source) throw new NftProjectNotFoundError("NFT project has no reviewed activity source.");
  return { project, source };
}

async function sourceState(pool: Pool, projectId: string) {
  const { project, source } = reviewedProjectSource(projectId);
  const state = await pool.query<SourceState>(
    `SELECT status,last_sync_at FROM nft_indexer_source_state
     WHERE chain_id=$1 AND project_id=$2 AND lower(collection_address)=lower($3) AND standard=$4`,
    [source.chainId, source.projectId, source.collectionAddress, source.standard],
  );
  const row = state.rows[0];
  if (!row) throw new NftProjectNotFoundError("NFT project source is not initialized.");
  return { project, source, row };
}

export function parseTokenId(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new NftProjectReadInputError("tokenId must be a canonical decimal uint256");
  const tokenId = BigInt(value);
  if (tokenId > MAX_UINT256) throw new NftProjectReadInputError("tokenId exceeds uint256");
  return tokenId;
}

function sourceFresh(row: SourceState, now: Date, pollIntervalMs: number) {
  if (!row.last_sync_at) return false;
  const age = now.getTime() - row.last_sync_at.getTime();
  return age >= 0 && age <= Math.max(pollIntervalMs * 3, MIN_FRESHNESS_MS);
}

async function mapConcurrent<T, U>(values: readonly T[], concurrency: number, mapper: (value: T) => Promise<U>): Promise<U[]> {
  const result = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await mapper(values[index]!);
    }
  }));
  return result;
}

async function metadataForToken(rpc: NftInventoryRpc, collectionAddress: Address, tokenId: bigint) {
  try {
    return resolveOnchainTokenMetadata(await rpc.readTokenUri({ address: collectionAddress, tokenId }));
  } catch {
    return resolveOnchainTokenMetadata(undefined);
  }
}

export async function readNftProjectInventory(input: {
  pool: Pool;
  rpc: NftInventoryRpc;
  projectId: string;
  afterTokenId?: string;
  limit?: number;
  pollIntervalMs: number;
  now?: Date;
}): Promise<RmtNftProjectInventoryRead> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? DEFAULT_INVENTORY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_INVENTORY_LIMIT) {
    throw new NftProjectReadInputError(`limit must be between 1 and ${MAX_INVENTORY_LIMIT}`);
  }
  const after = input.afterTokenId === undefined ? -1n : parseTokenId(input.afterTokenId);
  const { source, row } = await sourceState(input.pool, input.projectId);
  const base = {
    schemaVersion: 1 as const,
    projectId: source.projectId,
    chainId: source.chainId,
    collectionAddress: source.collectionAddress,
    collectionStandard: source.standard,
    asOf: row.last_sync_at?.toISOString() ?? null,
  };
  if (row.status === "BACKFILLING") return { ...base, availability: "PARTIAL", availabilityReason: "SOURCE_BACKFILLING", items: [], nextCursor: null };
  if (row.status === "ERROR") return { ...base, availability: "UNAVAILABLE", availabilityReason: "SOURCE_ERROR", items: [], nextCursor: null };
  if (!sourceFresh(row, now, input.pollIntervalMs)) return { ...base, availability: "UNAVAILABLE", availabilityReason: "SOURCE_STALE", items: [], nextCursor: null };
  if (source.standard !== "ERC721") return { ...base, availability: "UNAVAILABLE", availabilityReason: "SOURCE_STALE", items: [], nextCursor: null };

  const ownership = await input.pool.query<{ token_id: string; owner_address: string }>(
    `SELECT token_id::text,owner_address FROM nft_erc721_ownership
     WHERE chain_id=$1 AND lower(collection_address)=lower($2) AND token_id>$3
     ORDER BY token_id ASC LIMIT $4`,
    [source.chainId, source.collectionAddress, after.toString(), limit + 1],
  );
  const page = ownership.rows.slice(0, limit);
  const items = await mapConcurrent(page, 6, async (item): Promise<RmtNftInventoryItem> => ({
    tokenId: item.token_id,
    owner: getAddress(item.owner_address),
    metadata: await metadataForToken(input.rpc, source.collectionAddress, BigInt(item.token_id)),
  }));
  return {
    ...base,
    availability: "AVAILABLE",
    availabilityReason: null,
    items,
    nextCursor: ownership.rows.length > limit ? page.at(-1)!.token_id : null,
  };
}

export async function readNftProjectItem(input: {
  pool: Pool;
  rpc: NftInventoryRpc;
  projectId: string;
  tokenId: string;
  pollIntervalMs: number;
  now?: Date;
}): Promise<RmtNftItemRead> {
  const tokenId = parseTokenId(input.tokenId);
  const { source, row } = await sourceState(input.pool, input.projectId);
  if (source.standard !== "ERC721" || row.status !== "SYNCED" || !sourceFresh(row, input.now ?? new Date(), input.pollIntervalMs) || !row.last_sync_at) {
    throw new Error("Canonical NFT inventory is unavailable.");
  }
  const ownership = await input.pool.query<{ owner_address: string }>(
    `SELECT owner_address FROM nft_erc721_ownership
     WHERE chain_id=$1 AND lower(collection_address)=lower($2) AND token_id=$3`,
    [source.chainId, source.collectionAddress, tokenId.toString()],
  );
  const owner = ownership.rows[0];
  if (!owner) throw new NftProjectNotFoundError("NFT item is absent from current canonical ownership.");
  const [metadata, rawAccount] = await Promise.all([
    metadataForToken(input.rpc, source.collectionAddress, tokenId),
    input.rpc.readTokenBoundAccount({ address: source.collectionAddress, tokenId }),
  ]);
  if (typeof rawAccount !== "string") throw new Error("Token-bound account response is invalid.");
  const accountAddress = getAddress(rawAccount);
  if (isAddressEqual(accountAddress, zeroAddress)) throw new Error("Token-bound account response is zero.");
  return {
    schemaVersion: 1,
    projectId: source.projectId,
    chainId: source.chainId,
    collectionAddress: source.collectionAddress,
    collectionStandard: "ERC721",
    tokenId: tokenId.toString(),
    owner: getAddress(owner.owner_address),
    metadata,
    tokenBoundAccount: {
      authority: "ONCHAIN_ERC6551_ACCOUNT",
      chainId: source.chainId,
      collectionAddress: source.collectionAddress,
      tokenId: tokenId.toString(),
      accountAddress,
    },
    asOf: row.last_sync_at.toISOString(),
  };
}

export async function readNftProjectOnchain(
  pool: Pool,
  projectId: string,
  now: Date = new Date(),
): Promise<RmtNftProjectOnchainRead> {
  const { project, source, row } = await sourceState(pool, projectId);
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
