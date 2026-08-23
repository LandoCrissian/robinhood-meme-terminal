import { nftCollectionId, normalizeAddress, normalizeHash32, ROBINHOOD_CHAIN_ID, type NftCollectionId, type NftItemId } from "../domain.ts";
import type { SourceRegistration } from "../adapters.ts";

export const OPENSEA_API_BASE = "https://api.opensea.io/api/v2" as const;
export const OPENSEA_CHAIN_SLUG = "robinhood" as const;
export const SEAPORT_1_6 = "0x0000000000000068f116a894984e2db1123eb395" as const;
export const ROBINHOOD_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;

export const OPEN_SEA_SEAPORT: SourceRegistration = {
  sourceId: "opensea-seaport",
  displayName: "OpenSea / Seaport 1.6",
  chainId: ROBINHOOD_CHAIN_ID,
  admission: "verification_ready",
  identityState: "verified",
  capabilities: ["catalogue", "listings", "item_offers", "collection_offers", "trait_offers", "sweep"],
  protocol: "seaport-1.6",
  contractAddresses: [SEAPORT_1_6, ROBINHOOD_WETH],
  apiKind: "public_supported",
  evidence: [
    "https://opensea.io/blog/articles/robinhood-chain-is-live-on-opensea",
    "https://github.com/ProjectOpenSea/opensea-sdk/blob/main/CHANGELOG.md",
    "https://robinhoodchain.blockscout.com/address/0x0000000000000068F116a894984e2DB1123eB395",
    "https://docs.opensea.io/reference/get_best_listings_collection",
    "https://docs.opensea.io/reference/generate_listing_fulfillment_data_v2",
    "https://docs.opensea.io/reference/generate_offer_fulfillment_data_v2"
  ],
  blockers: [
    "No RMT NFT authorization codec is admitted.",
    "No RMT NFT wallet-submission path is admitted.",
    "Every fulfillment payload still requires independent local Seaport verification and simulation."
  ]
};

export function openSeaHeaders(apiKey: string) {
  if (!apiKey.trim()) throw new Error("OpenSea API key is required");
  return Object.freeze({ Accept: "application/json", "x-api-key": apiKey });
}

export function bestCollectionListingsUrl(slug: string, limit = 200, cursor?: string | null) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(slug)) throw new Error("OpenSea collection slug is invalid");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("OpenSea listing page limit is invalid");
  const url = new URL(`${OPENSEA_API_BASE}/listings/collection/${encodeURIComponent(slug)}/best`);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("next", cursor);
  return url.toString();
}

export function collectionOffersUrl(slug: string, limit = 200, cursor?: string | null) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(slug)) throw new Error("OpenSea collection slug is invalid");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("OpenSea offer page limit is invalid");
  const url = new URL(`${OPENSEA_API_BASE}/offers/collection/${encodeURIComponent(slug)}`);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("next", cursor);
  return url.toString();
}

export function itemOffersUrl(slug: string, tokenId: string, limit = 200, cursor?: string | null) {
  const base = collectionOffersUrl(slug, limit, cursor);
  const token = BigInt(tokenId).toString();
  const url = new URL(base);
  url.pathname = `${OPENSEA_API_BASE.replace("https://api.opensea.io", "")}/offers/collection/${encodeURIComponent(slug)}/nfts/${encodeURIComponent(token)}`;
  return url.toString();
}

export function listingFulfillmentUrl() {
  return `${OPENSEA_API_BASE}/listings/fulfillment_data`;
}

export function offerFulfillmentUrl() {
  return `${OPENSEA_API_BASE}/offers/fulfillment_data`;
}

export type SeaportOrderObservation = {
  chain: string;
  protocolAddress: string;
  orderHash: string;
  offerer: string;
  zone: string;
  conduitKey: string;
  startTimeSeconds: string;
  endTimeSeconds: string;
  orderStatus: "ACTIVE" | "INACTIVE" | "FULFILLED" | "EXPIRED" | "CANCELLED";
};

export function assertRobinhoodSeaportObservation(order: SeaportOrderObservation, nowMs: number) {
  if (order.chain.toLowerCase() !== OPENSEA_CHAIN_SLUG) throw new Error("OpenSea order is on the wrong chain");
  if (normalizeAddress(order.protocolAddress) !== SEAPORT_1_6) throw new Error("OpenSea order uses an unreviewed Seaport contract");
  normalizeHash32(order.orderHash);
  normalizeAddress(order.offerer);
  normalizeAddress(order.zone);
  normalizeHash32(order.conduitKey);
  const startMs = Number(BigInt(order.startTimeSeconds) * 1_000n);
  const endMs = Number(BigInt(order.endTimeSeconds) * 1_000n);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs > nowMs || endMs <= nowMs) throw new Error("OpenSea order is not currently active");
  if (order.orderStatus !== "ACTIVE") throw new Error("OpenSea order status is not active");
  return true;
}

export type SeaportVerificationContext = {
  expectedItem: NftItemId;
  expectedCollection: NftCollectionId;
  expectedRecipient: string;
  expectedPaymentToken: "native" | string;
  expectedGrossAmountAtomic: string;
  expectedOrderHash: string;
  expectedProtocolAddress: string;
};

export const SEAPORT_STRICT_VERIFICATION_CHECKLIST = Object.freeze([
  "chain_id_exact_4663",
  "seaport_runtime_and_protocol_address_exact",
  "order_hash_exact",
  "order_status_active_and_counter_not_invalidated",
  "offerer_signature_or_eip1271_exact",
  "start_end_time_current",
  "zone_and_zone_hash_semantics_reviewed",
  "conduit_key_resolved_to_reviewed_spender",
  "nft_contract_token_id_and_quantity_exact",
  "criteria_root_and_proof_exact_when_applicable",
  "seller_ownership_or_erc1155_balance_sufficient",
  "seller_nft_approval_exact",
  "payment_token_and_amount_exact",
  "buyer_balance_and_weth_allowance_sufficient_for_offers",
  "all_consideration_recipients_and_amounts_accounted_for",
  "creator_fee_optional_vs_required_disclosed",
  "recipient_exact",
  "calldata_target_value_and_selector_exact",
  "unknown_extra_call_or_consideration_rejected",
  "eth_call_or_trace_simulation_successful_at_fresh_block",
  "quote_expiry_and_observed_block_fresh",
  "post_submit_receipt_reconciles_expected_item_and_payment"
] as const);

export function robinhoodCollection(contract: string) {
  return nftCollectionId(contract);
}
