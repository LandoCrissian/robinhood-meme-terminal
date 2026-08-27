import type { Pool } from "pg";
import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import type { RmtNftProjectMarketplaceRead, RmtNftPaymentAssetVolume } from "@rmt/shared/nft/project-market";
import { rmtCuratedNftProject } from "@rmt/shared/nft/project-registry";
import { getAddress, type Address, type Hex } from "viem";
import { SEAPORT_1_6_ADDRESS } from "./constants.js";

const MAX_SALES = 20;
export class NftMarketplaceProjectNotFoundError extends Error {}

type SaleRow = {
  token_id: string; quantity: string; seller: Address; buyer: Address;
  payment_kind: "NATIVE" | "ERC20" | null; payment_address: Address | null;
  payment_symbol: string | null; payment_decimals: number | null; gross_amount: string | null;
  transaction_hash: Hex | null; order_hash: Hex | null; event_timestamp: Date;
  authority: "PROVIDER_REPORTED_SALE"; settlement_status: "NOT_VERIFIED";
};

export function marketplaceListingFreshnessMs(pollIntervalMs: number) {
  return Math.max(pollIntervalMs * 3, 5 * 60_000);
}

export function marketplaceSourceFreshnessMs(pollIntervalMs: number) {
  return Math.max(pollIntervalMs * 3, 5 * 60_000);
}

export async function readNftProjectMarketplace(
  pool: Pool,
  projectId: string,
  pollIntervalMs: number,
  now: Date = new Date(),
): Promise<RmtNftProjectMarketplaceRead> {
  const project = rmtCuratedNftProject(projectId);
  if (!project || project.status !== "ACTIVE") throw new NftMarketplaceProjectNotFoundError("NFT project is not publicly admitted.");
  const source = RMT_NFT_ACTIVITY_SOURCES.find((item) => item.projectId === project.projectId);
  if (!source) throw new NftMarketplaceProjectNotFoundError("NFT project has no marketplace-admitted source.");

  const identityResult = await pool.query<{
    project_id: string; collection_address: Address; collection_standard: "ERC721" | "ERC1155";
    collection_slug: string; scope: "EXACT_CONTRACT_SCOPE" | "MULTI_CONTRACT_COLLECTION_SCOPE";
    status: "BACKFILLING" | "SYNCED" | "ERROR";
    last_successful_poll: Date | null;
  }>(
    `SELECT i.project_id,i.collection_address,i.collection_standard,i.collection_slug,i.scope,s.status,s.last_successful_poll
     FROM nft_marketplace_collection_identity i JOIN nft_marketplace_source_state s
       USING(provider,chain_id,collection_address)
     WHERE i.provider='OPENSEA' AND i.chain_id=4663 AND i.project_id=$1
       AND lower(i.collection_address)=lower($2) AND i.collection_standard=$3`,
    [source.projectId, source.collectionAddress, source.standard],
  );
  const identity = identityResult.rows[0];
  if (!identity) throw new NftMarketplaceProjectNotFoundError("Marketplace identity is unavailable.");

  const asOf = identity.last_successful_poll?.toISOString() ?? null;
  const sourceUnavailableReason = identity.status === "ERROR"
    ? "SOURCE_ERROR"
    : identity.last_successful_poll === null
      ? "SOURCE_NOT_READY"
      : identity.last_successful_poll.getTime() < now.getTime() - marketplaceSourceFreshnessMs(pollIntervalMs)
        ? "SOURCE_STALE"
        : null;
  if (sourceUnavailableReason) {
    return {
      schemaVersion: 1,
      projectId: project.projectId,
      chainId: 4663,
      collectionAddress: getAddress(identity.collection_address),
      provider: "OPENSEA",
      protocol: "SEAPORT_1_6",
      availability: "UNAVAILABLE",
      availabilityReason: sourceUnavailableReason,
      sourceStatus: identity.status,
      identityScope: identity.scope,
      providerCollectionSlug: identity.collection_slug,
      lowestNormalizedListing: null,
      recentProviderSales: [],
      volume24hByPaymentAsset: [],
      asOf,
    };
  }

  const freshnessCutoff = new Date(now.getTime() - marketplaceListingFreshnessMs(pollIntervalMs));
  const listingResult = await pool.query<{
    order_hash: Hex; protocol_address: Address; token_id: string; quantity: string; gross_amount: string;
    payment_kind: "NATIVE"; payment_symbol: string; payment_decimals: number; maker: Address; exact_revalidated_at: Date;
  }>(
    `SELECT order_hash,protocol_address,token_id::text,quantity::text,gross_amount::text,payment_kind,
       payment_symbol,payment_decimals,maker,exact_revalidated_at
     FROM nft_marketplace_orders WHERE provider='OPENSEA' AND chain_id=4663 AND project_id=$1
       AND lower(collection_address)=lower($2) AND evidence_kind='LISTING'
       AND lower(protocol_address)=lower($3) AND normalized_status='ACTIVE' AND remaining_quantity>0
       AND payment_kind='NATIVE' AND order_identity_status='ORDER_IDENTITY_VERIFIED'
       AND exact_revalidated_at IS NOT NULL AND exact_revalidated_at >= $4
     ORDER BY gross_amount ASC,order_hash ASC LIMIT 1`,
    [source.projectId, source.collectionAddress, SEAPORT_1_6_ADDRESS, freshnessCutoff.toISOString()],
  );
  const listing = listingResult.rows[0] ?? null;

  const salesResult = await pool.query<SaleRow>(
    `SELECT token_id::text,quantity::text,seller,buyer,payment_kind,payment_address,payment_symbol,
       payment_decimals,gross_amount::text,transaction_hash,order_hash,event_timestamp,authority,settlement_status
     FROM nft_marketplace_sales WHERE provider='OPENSEA' AND chain_id=4663 AND project_id=$1
       AND lower(collection_address)=lower($2)
     ORDER BY event_timestamp DESC,evidence_digest DESC LIMIT $3`,
    [source.projectId, source.collectionAddress, MAX_SALES],
  );

  const volumes = new Map<string, RmtNftPaymentAssetVolume>();
  const volumeRows = (await pool.query<SaleRow>(
    `SELECT payment_kind,payment_address,payment_symbol,payment_decimals,gross_amount::text
     FROM nft_marketplace_sales WHERE provider='OPENSEA' AND chain_id=4663 AND project_id=$1
       AND lower(collection_address)=lower($2) AND event_timestamp >= $3
       AND payment_kind IS NOT NULL AND payment_symbol IS NOT NULL AND payment_decimals IS NOT NULL AND gross_amount IS NOT NULL`,
    [source.projectId, source.collectionAddress, new Date(now.getTime() - 86_400_000).toISOString()],
  )).rows;
  for (const sale of volumeRows) {
    if (!sale.payment_kind || sale.payment_symbol === null || sale.payment_decimals === null || sale.gross_amount === null) continue;
    const address = sale.payment_kind === "ERC20" && sale.payment_address ? getAddress(sale.payment_address) : null;
    if (sale.payment_kind === "ERC20" && !address) continue;
    const key = `${sale.payment_kind}:${address?.toLowerCase() ?? "native"}:${sale.payment_decimals}:${sale.payment_symbol}`;
    const previous = volumes.get(key);
    const paymentAsset = { kind: sale.payment_kind, chainId: 4663 as const, address, symbol: sale.payment_symbol, decimals: sale.payment_decimals };
    volumes.set(key, {
      authority: "OPENSEA_REPORTED_24H_VOLUME",
      paymentAsset,
      grossAmount: (BigInt(previous?.grossAmount ?? "0") + BigInt(sale.gross_amount)).toString(),
      saleCount: (previous?.saleCount ?? 0) + 1,
    });
  }

  const staleCandidate = listing ? false : (await pool.query(
    `SELECT 1 FROM nft_marketplace_orders WHERE provider='OPENSEA' AND chain_id=4663 AND project_id=$1
      AND lower(collection_address)=lower($2) AND evidence_kind='LISTING' AND normalized_status='ACTIVE'
      AND remaining_quantity>0 AND payment_kind='NATIVE' AND order_identity_status='ORDER_IDENTITY_VERIFIED' LIMIT 1`,
    [source.projectId, source.collectionAddress],
  )).rowCount! > 0;
  const availability = identity.status === "BACKFILLING" ? "PARTIAL" : "AVAILABLE";

  return {
    schemaVersion: 1,
    projectId: project.projectId,
    chainId: 4663,
    collectionAddress: getAddress(identity.collection_address),
    provider: "OPENSEA",
    protocol: "SEAPORT_1_6",
    availability,
    availabilityReason: staleCandidate ? "STALE" : null,
    sourceStatus: identity.status,
    identityScope: identity.scope,
    providerCollectionSlug: identity.collection_slug,
    lowestNormalizedListing: listing ? {
      authority: "LOWEST_NORMALIZED_OPENSEA_LISTING",
      rmtExecutable: false,
      orderHash: listing.order_hash,
      protocolAddress: getAddress(listing.protocol_address),
      tokenId: listing.token_id,
      quantity: listing.quantity,
      grossAmount: listing.gross_amount,
      paymentAsset: { kind: "NATIVE", chainId: 4663, address: null, symbol: listing.payment_symbol, decimals: listing.payment_decimals },
      maker: getAddress(listing.maker),
      exactRevalidatedAt: listing.exact_revalidated_at.toISOString(),
    } : null,
    recentProviderSales: salesResult.rows.map((sale) => ({
      authority: sale.authority,
      settlementVerificationStatus: sale.settlement_status,
      tokenId: sale.token_id,
      quantity: sale.quantity,
      seller: getAddress(sale.seller),
      buyer: getAddress(sale.buyer),
      paymentAsset: sale.payment_kind && sale.payment_symbol !== null && sale.payment_decimals !== null
        ? { kind: sale.payment_kind, chainId: 4663, address: sale.payment_kind === "ERC20" && sale.payment_address ? getAddress(sale.payment_address) : null, symbol: sale.payment_symbol, decimals: sale.payment_decimals }
        : null,
      grossAmount: sale.gross_amount,
      transactionHash: sale.transaction_hash,
      orderHash: sale.order_hash,
      eventTimestamp: sale.event_timestamp.toISOString(),
    })),
    volume24hByPaymentAsset: [...volumes.values()],
    asOf,
  };
}
