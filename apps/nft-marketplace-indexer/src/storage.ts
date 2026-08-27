import type { Pool, PoolClient } from "pg";
import type {
  RmtNftCollectionMarketplaceIdentity,
  RmtNftListingEvidence,
  RmtNftOfferEvidence,
  RmtNftSaleEvidence,
} from "@rmt/shared/nft/marketplace-evidence";
import { assertSlugReplacement } from "./identity.js";
import { boundedError, canonicalJson } from "./evidence-utils.js";
import { isAddressEqual } from "viem";
import { seaportOrderHash } from "@rmt/shared/nft/seaport-order-hash";
import { SEAPORT_1_6_ADDRESS } from "./constants.js";
type Order = RmtNftListingEvidence | RmtNftOfferEvidence;
const json = (_key: string, value: unknown) => canonicalJson(value);
function protocolData(order: Order) {
  return order.protocolData
    ? JSON.parse(
        JSON.stringify(order.protocolData, (_k, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      )
    : null;
}
function assertEvidenceIdentity(
  identity: RmtNftCollectionMarketplaceIdentity,
  evidence: Order | RmtNftSaleEvidence,
) {
  if (
    evidence.provider !== identity.provider ||
    evidence.chainId !== identity.chainId ||
    evidence.projectId !== identity.projectId ||
    !isAddressEqual(evidence.collectionAddress, identity.collectionAddress)
  )
    throw new Error("Marketplace evidence does not match its admitted source.");
  if (evidence.evidenceKind === "SALE") {
    if (evidence.quantity <= 0n || evidence.tokenId < 0n)
      throw new Error("Marketplace sale numeric values are invalid.");
    return;
  }
  if (
    evidence.collectionStandard !== identity.collectionStandard ||
    !isAddressEqual(evidence.protocolAddress, SEAPORT_1_6_ADDRESS)
  )
    throw new Error("Marketplace order does not match its admitted source.");
  if (
    evidence.quantity <= 0n ||
    evidence.grossAmount < 0n ||
    evidence.remainingQuantity < 0n ||
    (evidence.tokenId !== null && evidence.tokenId < 0n)
  )
    throw new Error("Marketplace order numeric values are invalid.");
  if (
    evidence.orderIdentityStatus === "ORDER_IDENTITY_VERIFIED" &&
    (!evidence.protocolData ||
      seaportOrderHash(evidence.protocolData).toLowerCase() !==
        evidence.orderHash.toLowerCase())
  )
    throw new Error("Marketplace order identity is not durable-verifiable.");
  if (evidence.protocolData) {
    if (
      !isAddressEqual(evidence.maker, evidence.protocolData.offerer) ||
      evidence.startTime !== evidence.protocolData.startTime ||
      evidence.endTime !== evidence.protocolData.endTime
    )
      throw new Error(
        "Marketplace order projection conflicts with protocol data.",
      );
    const nftItems =
      evidence.evidenceKind === "LISTING"
        ? evidence.protocolData.offer
        : evidence.protocolData.consideration;
    const matchingNft = nftItems.find(
      (item) =>
        [2, 3, 4, 5].includes(item.itemType) &&
        isAddressEqual(item.token, identity.collectionAddress) &&
        (evidence.tokenId === null ||
          item.identifierOrCriteria === evidence.tokenId),
    );
    if (!matchingNft || matchingNft.startAmount !== evidence.quantity)
      throw new Error(
        "Marketplace NFT projection conflicts with protocol data.",
      );
  }
}
export async function readIdentity(
  pool: Pool,
  address: string,
): Promise<RmtNftCollectionMarketplaceIdentity | null> {
  const result = await pool.query(
    "SELECT * FROM nft_marketplace_collection_identity WHERE provider=$1 AND chain_id=4663 AND lower(collection_address)=lower($2)",
    ["OPENSEA", address],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    provider: "OPENSEA",
    chainId: 4663,
    projectId: row.project_id,
    collectionAddress: row.collection_address,
    collectionStandard: row.collection_standard,
    providerChain: "robinhood",
    providerCollectionSlug: row.collection_slug,
    scope: row.scope,
    memberContracts: row.member_contracts,
    verifiedAt: new Date(row.verified_at).toISOString(),
    provenance: {
      provider: "OPENSEA",
      retrievedAt: new Date(row.verified_at).toISOString(),
      rawEvidenceDigest: row.evidence_digest,
    },
  };
}
export async function persistIdentity(
  pool: Pool,
  identity: RmtNftCollectionMarketplaceIdentity,
  revalidated = true,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT collection_slug FROM nft_marketplace_collection_identity WHERE provider='OPENSEA' AND chain_id=4663 AND lower(collection_address)=lower($1) FOR UPDATE",
      [identity.collectionAddress],
    );
    const previous = existing.rows[0]
      ? ({
          ...identity,
          providerCollectionSlug: existing.rows[0].collection_slug,
        } as RmtNftCollectionMarketplaceIdentity)
      : null;
    assertSlugReplacement(previous, identity, revalidated);
    await client.query(
      `INSERT INTO nft_marketplace_collection_identity(provider,chain_id,project_id,collection_address,collection_standard,provider_chain,collection_slug,scope,member_contracts,verified_at,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT(provider,chain_id,collection_address) DO UPDATE SET project_id=EXCLUDED.project_id,collection_standard=EXCLUDED.collection_standard,provider_chain=EXCLUDED.provider_chain,collection_slug=EXCLUDED.collection_slug,scope=EXCLUDED.scope,member_contracts=EXCLUDED.member_contracts,verified_at=EXCLUDED.verified_at,evidence_digest=EXCLUDED.evidence_digest`,
      [
        "OPENSEA",
        4663,
        identity.projectId,
        identity.collectionAddress,
        identity.collectionStandard,
        "robinhood",
        identity.providerCollectionSlug,
        identity.scope,
        json("members", identity.memberContracts),
        identity.verifiedAt,
        identity.provenance.rawEvidenceDigest,
      ],
    );
    await client.query(
      `INSERT INTO nft_marketplace_source_state(provider,chain_id,project_id,collection_address,status) VALUES('OPENSEA',4663,$1,$2,'BACKFILLING') ON CONFLICT DO NOTHING`,
      [identity.projectId, identity.collectionAddress],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function persistOrder(client: PoolClient, order: Order) {
  const existing = await client.query(
    "SELECT project_id,collection_address,evidence_kind,maker FROM nft_marketplace_orders WHERE provider=$1 AND chain_id=$2 AND protocol_address=$3 AND order_hash=$4 FOR UPDATE",
    [order.provider, order.chainId, order.protocolAddress, order.orderHash],
  );
  const row = existing.rows[0];
  if (
    row &&
    (row.project_id !== order.projectId ||
      row.collection_address.toLowerCase() !==
        order.collectionAddress.toLowerCase() ||
      row.evidence_kind !== order.evidenceKind ||
      row.maker.toLowerCase() !== order.maker.toLowerCase())
  )
    throw new Error("Conflicting immutable OpenSea order provenance.");
  const criteria = order.evidenceKind === "OFFER" ? order.criteria : null;
  await client.query(
    `INSERT INTO nft_marketplace_orders(provider,chain_id,protocol_address,order_hash,project_id,collection_address,evidence_kind,order_scope,token_id,criteria,maker,payment_kind,payment_address,payment_symbol,payment_decimals,gross_amount,quantity,start_time,end_time,remaining_quantity,provider_status,normalized_status,order_identity_status,protocol_data,evidence_digest,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26,$26) ON CONFLICT(provider,chain_id,protocol_address,order_hash) DO UPDATE SET remaining_quantity=EXCLUDED.remaining_quantity,provider_status=EXCLUDED.provider_status,normalized_status=EXCLUDED.normalized_status,evidence_digest=EXCLUDED.evidence_digest,last_seen_at=EXCLUDED.last_seen_at`,
    [
      order.provider,
      order.chainId,
      order.protocolAddress,
      order.orderHash,
      order.projectId,
      order.collectionAddress,
      order.evidenceKind,
      order.scope,
      order.tokenId?.toString() ?? null,
      criteria ? json("criteria", criteria) : null,
      order.maker,
      order.paymentAsset.kind,
      order.paymentAsset.address,
      order.paymentAsset.symbol,
      order.paymentAsset.decimals,
      order.grossAmount.toString(),
      order.quantity.toString(),
      order.startTime.toString(),
      order.endTime.toString(),
      order.remainingQuantity.toString(),
      order.providerStatus,
      order.status,
      order.orderIdentityStatus,
      protocolData(order) ? json("protocol", protocolData(order)) : null,
      order.provenance.rawEvidenceDigest,
      order.provenance.retrievedAt,
    ],
  );
  await client.query(
    `INSERT INTO nft_marketplace_order_snapshots(provider,chain_id,protocol_address,order_hash,evidence_digest,observed_at,provider_status,normalized_status,remaining_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [
      order.provider,
      order.chainId,
      order.protocolAddress,
      order.orderHash,
      order.provenance.rawEvidenceDigest,
      order.provenance.retrievedAt,
      order.providerStatus,
      order.status,
      order.remainingQuantity.toString(),
    ],
  );
}
async function persistSale(client: PoolClient, sale: RmtNftSaleEvidence) {
  await client.query(
    `INSERT INTO nft_marketplace_sales(provider,chain_id,evidence_digest,project_id,collection_address,token_id,quantity,seller,buyer,payment_kind,payment_address,payment_symbol,payment_decimals,gross_amount,transaction_hash,order_hash,protocol_address,event_timestamp,authority,settlement_status,retrieved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT DO NOTHING`,
    [
      sale.provider,
      sale.chainId,
      sale.provenance.rawEvidenceDigest,
      sale.projectId,
      sale.collectionAddress,
      sale.tokenId.toString(),
      sale.quantity.toString(),
      sale.seller,
      sale.buyer,
      sale.paymentAsset?.kind ?? null,
      sale.paymentAsset?.address ?? null,
      sale.paymentAsset?.symbol ?? null,
      sale.paymentAsset?.decimals ?? null,
      sale.grossAmount?.toString() ?? null,
      sale.transactionHash,
      sale.orderHash,
      sale.protocolAddress,
      sale.eventTimestamp,
      sale.authority,
      sale.settlementVerificationStatus,
      sale.provenance.retrievedAt,
    ],
  );
}
export async function persistPage(
  pool: Pool,
  identity: RmtNftCollectionMarketplaceIdentity,
  queryIdentity: string,
  evidence: readonly (Order | RmtNftSaleEvidence)[],
  nextCursor: string | null,
) {
  if (!queryIdentity || queryIdentity.length > 512)
    throw new Error("Marketplace query identity is invalid.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admitted = await client.query(
      "SELECT project_id,collection_standard,collection_slug,scope FROM nft_marketplace_collection_identity WHERE provider='OPENSEA' AND chain_id=4663 AND lower(collection_address)=lower($1) FOR SHARE",
      [identity.collectionAddress],
    );
    const admittedRow = admitted.rows[0];
    if (
      !admittedRow ||
      admittedRow.project_id !== identity.projectId ||
      admittedRow.collection_standard !== identity.collectionStandard ||
      admittedRow.collection_slug !== identity.providerCollectionSlug ||
      admittedRow.scope !== identity.scope
    )
      throw new Error(
        "Marketplace page identity is not durably admitted and verified.",
      );
    for (const item of evidence) {
      assertEvidenceIdentity(identity, item);
      item.evidenceKind === "SALE"
        ? await persistSale(client, item)
        : await persistOrder(client, item);
    }
    await client.query(
      `INSERT INTO nft_marketplace_cursors(provider,chain_id,collection_address,query_identity,next_cursor,updated_at) VALUES('OPENSEA',4663,$1,$2,$3,now()) ON CONFLICT(provider,chain_id,collection_address,query_identity) DO UPDATE SET next_cursor=EXCLUDED.next_cursor,updated_at=EXCLUDED.updated_at`,
      [identity.collectionAddress, queryIdentity, nextCursor],
    );
    await client.query(
      `UPDATE nft_marketplace_source_state SET last_successful_poll=now(),last_provider_error=NULL,updated_at=now() WHERE provider='OPENSEA' AND chain_id=4663 AND collection_address=$1`,
      [identity.collectionAddress],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function cursor(
  pool: Pool,
  address: string,
  queryIdentity: string,
) {
  const result = await pool.query(
    "SELECT next_cursor FROM nft_marketplace_cursors WHERE provider=$1 AND chain_id=4663 AND collection_address=$2 AND query_identity=$3",
    ["OPENSEA", address, queryIdentity],
  );
  return result.rows[0]?.next_cursor as string | null | undefined;
}
export async function recordSourceError(
  pool: Pool,
  address: string,
  error: unknown,
) {
  await pool.query(
    `UPDATE nft_marketplace_source_state SET status='ERROR',last_provider_error=$2,updated_at=now() WHERE provider='OPENSEA' AND chain_id=4663 AND collection_address=$1`,
    [address, boundedError(error)],
  );
}
export async function recordSourceSuccess(
  pool: Pool,
  address: string,
  backfilling: boolean,
) {
  await pool.query(
    `UPDATE nft_marketplace_source_state SET status=$2,last_successful_poll=now(),last_provider_error=NULL,updated_at=now() WHERE provider='OPENSEA' AND chain_id=4663 AND collection_address=$1`,
    [address, backfilling ? "BACKFILLING" : "SYNCED"],
  );
}
export async function statusRows(pool: Pool) {
  return (
    await pool.query(
      "SELECT provider,collection_address,status,last_successful_poll,last_provider_error FROM nft_marketplace_source_state ORDER BY collection_address",
    )
  ).rows;
}
export async function lowestNormalizedListingAmount(
  pool: Pool,
  address: string,
) {
  const result = await pool.query(
    `SELECT gross_amount FROM nft_marketplace_orders WHERE provider='OPENSEA' AND chain_id=4663 AND lower(collection_address)=lower($1) AND evidence_kind='LISTING' AND normalized_status='ACTIVE' AND payment_kind='NATIVE' ORDER BY gross_amount ASC LIMIT 1`,
    [address],
  );
  return result.rows[0]?.gross_amount as string | undefined;
}
