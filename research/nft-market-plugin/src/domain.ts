export const ROBINHOOD_CHAIN_ID = 4_663 as const;
export const UINT256_MAX = (1n << 256n) - 1n;

export type NftStandard = "erc721" | "erc1155";
export type EvidenceState = "verified" | "reported" | "unknown" | "conflicting";
export type AvailabilityState = "current" | "stale" | "partial" | "unavailable";

export type NftCollectionId = {
  chainId: typeof ROBINHOOD_CHAIN_ID;
  contract: string;
};

export type NftItemId = NftCollectionId & {
  tokenId: string;
};

export type NftCollectionMetadata = {
  id: NftCollectionId;
  standard: NftStandard;
  name: string | null;
  symbol: string | null;
  contractUri: string | null;
  metadataState: EvidenceState;
};

export type NftItemMetadata = {
  id: NftItemId;
  standard: NftStandard;
  name: string | null;
  description: string | null;
  imageUri: string | null;
  animationUri: string | null;
  tokenUri: string | null;
  traits: Array<{ traitType: string; value: string | number }>;
  metadataState: EvidenceState;
  observedAtMs: number;
};

export type OwnershipBalance = {
  item: NftItemId;
  owner: string;
  quantityAtomic: string;
  observedRollupBlock: string;
};

export type PaymentAsset =
  | { chainId: typeof ROBINHOOD_CHAIN_ID; kind: "native"; symbol: "ETH" }
  | { chainId: typeof ROBINHOOD_CHAIN_ID; kind: "erc20"; contract: string; symbol: string | null; decimals: number | null };

export type VenueCapability =
  | "catalogue"
  | "listings"
  | "item_offers"
  | "collection_offers"
  | "trait_offers"
  | "sweep"
  | "amm_liquidity"
  | "vault_liquidity";

export type VenueAdmission =
  | "unsupported"
  | "catalogue_only"
  | "candidate"
  | "observation"
  | "quote_only"
  | "verification_ready"
  | "execution_admitted";

export type NftOrderKind =
  | "listing"
  | "item_offer"
  | "collection_offer"
  | "trait_offer"
  | "amm_buy"
  | "amm_sell"
  | "vault_redeem";

export type OrderCriteria =
  | { kind: "item"; item: NftItemId }
  | { kind: "collection"; collection: NftCollectionId }
  | { kind: "trait"; collection: NftCollectionId; traitType: string; traitValue: string };

export type FeeComponent = {
  kind: "marketplace" | "creator_royalty" | "network" | "rmt" | "other";
  recipient: string | null;
  payer: "buyer" | "seller" | "maker" | "taker" | "unknown";
  asset: PaymentAsset;
  amountAtomic: string;
  enforcement: "required_by_order" | "optional_by_venue" | "estimated_network" | "not_admitted";
  source: string;
};

export type NftMarketOrder = {
  sourceId: string;
  venueId: string;
  protocolId: string | null;
  orderId: string;
  orderHash: string | null;
  kind: NftOrderKind;
  criteria: OrderCriteria;
  maker: string;
  taker: string | null;
  paymentAsset: PaymentAsset;
  grossAmountAtomic: string;
  quantityAtomic: string;
  startTimeMs: number;
  endTimeMs: number;
  status: "active" | "inactive" | "filled" | "expired" | "cancelled" | "unknown";
  fillable: boolean;
  fees: FeeComponent[];
  observedAtMs: number;
  sourceRef: string;
};

export type NftExecutableQuote = {
  quoteId: string;
  side: "buy" | "sell";
  venueId: string;
  order: NftMarketOrder;
  item: NftItemId;
  quantityAtomic: string;
  paymentAsset: PaymentAsset;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
  totalUserCostAtomic: string | null;
  sellerProceedsAtomic: string | null;
  expiresAtMs: number;
  verificationState: "observed" | "verification_required" | "verified";
  rmtFeeState: "not_admitted" | "explicit_policy_bound";
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid NFT market data: ${message}`);
}

export function normalizeAddress(value: string) {
  invariant(ADDRESS.test(value), "EVM address is invalid");
  return value.toLowerCase();
}

export function normalizeHash32(value: string) {
  invariant(HASH32.test(value), "bytes32 value is invalid");
  return value.toLowerCase();
}

export function canonicalUint256(value: string) {
  invariant(CANONICAL_UINT.test(value), "uint256 must be a canonical decimal string");
  const parsed = BigInt(value);
  invariant(parsed >= 0n && parsed <= UINT256_MAX, "uint256 is out of range");
  return value;
}

export function positiveAtomic(value: string, options: { allowZero?: boolean } = {}) {
  canonicalUint256(value);
  invariant(options.allowZero || BigInt(value) > 0n, "atomic quantity must be positive");
  return value;
}

export function nftCollectionId(contract: string): NftCollectionId {
  return { chainId: ROBINHOOD_CHAIN_ID, contract: normalizeAddress(contract) };
}

export function nftItemId(contract: string, tokenId: string): NftItemId {
  return { ...nftCollectionId(contract), tokenId: canonicalUint256(tokenId) };
}

export function collectionKey(id: NftCollectionId) {
  invariant(id.chainId === ROBINHOOD_CHAIN_ID, "unsupported chain");
  return `eip155:${id.chainId}/erc721-or-1155:${normalizeAddress(id.contract)}`;
}

export function itemKey(id: NftItemId) {
  return `${collectionKey(id)}/token:${canonicalUint256(id.tokenId)}`;
}

export function sameCollection(left: NftCollectionId, right: NftCollectionId) {
  return left.chainId === right.chainId && normalizeAddress(left.contract) === normalizeAddress(right.contract);
}

export function sameItem(left: NftItemId, right: NftItemId) {
  return sameCollection(left, right) && canonicalUint256(left.tokenId) === canonicalUint256(right.tokenId);
}

export function assertPaymentAsset(asset: PaymentAsset) {
  invariant(asset.chainId === ROBINHOOD_CHAIN_ID, "payment asset is on the wrong chain");
  if (asset.kind === "erc20") normalizeAddress(asset.contract);
  if (asset.kind === "erc20" && asset.decimals !== null) {
    invariant(Number.isInteger(asset.decimals) && asset.decimals >= 0 && asset.decimals <= 255, "ERC-20 decimals are invalid");
  }
  return true;
}

export function assertOrder(order: NftMarketOrder) {
  invariant(order.sourceId.trim().length > 0 && order.venueId.trim().length > 0, "source or venue identity missing");
  invariant(order.orderId.trim().length > 0, "order identity missing");
  if (order.orderHash !== null) normalizeHash32(order.orderHash);
  normalizeAddress(order.maker);
  if (order.taker !== null) normalizeAddress(order.taker);
  assertPaymentAsset(order.paymentAsset);
  positiveAtomic(order.grossAmountAtomic);
  positiveAtomic(order.quantityAtomic);
  invariant(Number.isSafeInteger(order.startTimeMs) && Number.isSafeInteger(order.endTimeMs), "order time is invalid");
  invariant(order.endTimeMs > order.startTimeMs, "order end must follow start");
  positiveAtomic(order.fees.reduce((sum, fee) => sum + BigInt(positiveAtomic(fee.amountAtomic, { allowZero: true })), 0n).toString(), { allowZero: true });
  return true;
}
