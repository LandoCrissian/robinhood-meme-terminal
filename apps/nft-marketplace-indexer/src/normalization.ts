import {
  getAddress,
  isAddress,
  isAddressEqual,
  isHex,
  type Address,
  type Hex,
} from "viem";
import type {
  RmtNftCollectionMarketplaceIdentity,
  RmtNftListingEvidence,
  RmtNftOfferEvidence,
  RmtNftSaleEvidence,
  RmtLowestNormalizedOpenSeaListing,
  RmtNftMarketplaceOrderStatus,
  RmtNftPaymentAsset,
} from "@rmt/shared/nft/marketplace-evidence";
import {
  parseSeaportOrderComponents,
  seaportOrderHash,
} from "@rmt/shared/nft/seaport-order-hash";
import { evidenceDigest } from "./evidence-utils.js";
import {
  OPENSEA_CHAIN,
  ROBINHOOD_WETH_ADDRESS,
  SEAPORT_1_6_ADDRESS,
  ZERO_ADDRESS,
} from "./constants.js";
type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, l: string) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${l} is required.`);
  return v;
};
const uint = (v: unknown, l: string) => {
  if (
    (typeof v !== "string" && typeof v !== "number") ||
    !/^\d+$/.test(String(v))
  )
    throw new Error(`${l} must be uint256.`);
  return BigInt(v);
};
const addr = (v: unknown, l: string) => {
  if (typeof v !== "string" || !isAddress(v, { strict: false }))
    throw new Error(`${l} must be an address.`);
  return getAddress(v);
};
const hex32 = (v: unknown, l: string) => {
  if (typeof v !== "string" || !isHex(v) || v.length !== 66)
    throw new Error(`${l} must be bytes32.`);
  return v as Hex;
};
function status(raw: unknown): RmtNftMarketplaceOrderStatus {
  if (typeof raw !== "string") return "UNKNOWN";
  const value = raw.toUpperCase();
  return ["ACTIVE", "INACTIVE", "FULFILLED", "EXPIRED", "CANCELLED"].includes(
    value,
  )
    ? (value as RmtNftMarketplaceOrderStatus)
    : "UNKNOWN";
}
function provenance(raw: unknown, retrievedAt: string) {
  return {
    provider: "OPENSEA" as const,
    retrievedAt: new Date(retrievedAt).toISOString(),
    rawEvidenceDigest: evidenceDigest(raw),
  };
}
function common(
  identity: RmtNftCollectionMarketplaceIdentity,
  raw: unknown,
  retrievedAt: string,
) {
  if (!rec(raw)) throw new Error("OpenSea order must be an object.");
  if (raw.chain !== OPENSEA_CHAIN)
    throw new Error("OpenSea order is for the wrong chain.");
  const protocol = addr(raw.protocol_address, "protocol_address");
  if (!isAddressEqual(protocol, SEAPORT_1_6_ADDRESS))
    throw new Error("OpenSea order is not canonical Seaport 1.6.");
  const orderHash = hex32(raw.order_hash, "order_hash");
  if (!rec(raw.protocol_data))
    throw new Error("ORDER_IDENTITY_UNVERIFIED: protocol_data is required.");
  const components = parseSeaportOrderComponents(raw.protocol_data.parameters);
  if (seaportOrderHash(components).toLowerCase() !== orderHash.toLowerCase())
    throw new Error(
      "OpenSea order hash does not match canonical Seaport OrderComponents.",
    );
  return {
    raw,
    components,
    protocol,
    orderHash,
    providerStatus: typeof raw.status === "string" ? raw.status : "UNKNOWN",
    status: status(raw.status),
    remainingQuantity: uint(raw.remaining_quantity ?? 0, "remaining_quantity"),
    provenance: provenance(raw, retrievedAt),
    identity,
  };
}
function price(
  raw: Rec,
  componentsToken: Address,
): { asset: RmtNftPaymentAsset; amount: bigint } {
  if (!rec(raw.price)) throw new Error("OpenSea order price is required.");
  const current = rec(raw.price.current) ? raw.price.current : raw.price;
  const symbol = str(current.currency, "price.currency");
  const decimals = Number(uint(current.decimals, "price.decimals"));
  if (decimals > 255) throw new Error("price.decimals is invalid.");
  const amount = uint(current.value, "price.value");
  const native = isAddressEqual(componentsToken, ZERO_ADDRESS);
  const asset: RmtNftPaymentAsset = {
    kind: native ? "NATIVE" : "ERC20",
    chainId: 4663,
    address: native ? null : componentsToken,
    symbol,
    decimals,
  };
  if (
    symbol.toUpperCase() === "WETH" &&
    !isAddressEqual(componentsToken, ROBINHOOD_WETH_ADDRESS)
  )
    throw new Error(
      "Robinhood OpenSea WETH offer uses the wrong token address.",
    );
  return { asset, amount };
}
function asset(raw: Rec, identity: RmtNftCollectionMarketplaceIdentity) {
  if (!rec(raw.asset)) throw new Error("OpenSea item asset is required.");
  const contract = addr(raw.asset.contract, "asset.contract");
  if (!isAddressEqual(contract, identity.collectionAddress))
    throw new Error("OpenSea order asset is not the admitted contract.");
  return {
    contract,
    tokenId: uint(
      raw.asset.identifier ?? raw.asset.token_id,
      "asset.identifier",
    ),
  };
}
export function normalizeListing(
  identity: RmtNftCollectionMarketplaceIdentity,
  raw: unknown,
  retrievedAt: string,
): RmtNftListingEvidence {
  const c = common(identity, raw, retrievedAt);
  const a = asset(c.raw, identity);
  const nft = c.components.offer.find(
    (item) =>
      [2, 3].includes(item.itemType) &&
      isAddressEqual(item.token, a.contract) &&
      item.identifierOrCriteria === a.tokenId,
  );
  if (!nft)
    throw new Error("Listing protocol data does not offer the admitted NFT.");
  const expectedItemType = identity.collectionStandard === "ERC721" ? 2 : 3;
  if (nft.itemType !== expectedItemType)
    throw new Error(
      "Listing item type does not match the admitted NFT standard.",
    );
  if (nft.startAmount === 0n)
    throw new Error("NFT listing quantity must be positive.");
  if (identity.collectionStandard === "ERC721" && nft.startAmount !== 1n)
    throw new Error("ERC721 marketplace quantity must equal one.");
  const paymentItem = c.components.consideration.find((item) =>
    [0, 1].includes(item.itemType),
  );
  if (!paymentItem) throw new Error("Listing has no payment consideration.");
  const p = price(c.raw, paymentItem.token);
  if (p.asset.kind !== "NATIVE")
    throw new Error("Robinhood OpenSea V1 listings must use native ETH.");
  return {
    evidenceKind: "LISTING",
    scope: "ITEM",
    provider: "OPENSEA",
    protocol: "SEAPORT_1_6",
    chainId: 4663,
    projectId: identity.projectId,
    collectionAddress: identity.collectionAddress,
    collectionStandard: identity.collectionStandard,
    tokenId: a.tokenId,
    quantity: nft.startAmount,
    maker: c.components.offerer,
    paymentAsset: p.asset,
    grossAmount: p.amount,
    startTime: c.components.startTime,
    endTime: c.components.endTime,
    orderHash: c.orderHash,
    protocolAddress: c.protocol,
    providerStatus: c.providerStatus,
    status: c.status,
    remainingQuantity: c.remainingQuantity,
    orderIdentityStatus: "ORDER_IDENTITY_VERIFIED",
    protocolData: c.components,
    provenance: c.provenance,
  };
}
function offerScope(raw: Rec, identity: RmtNftCollectionMarketplaceIdentity) {
  const hasAsset = rec(raw.asset);
  const criteria = rec(raw.criteria) ? raw.criteria : null;
  const hasTraits =
    !!criteria &&
    ((Array.isArray(criteria.traits) && criteria.traits.length > 0) ||
      (Array.isArray(criteria.numeric_traits) &&
        criteria.numeric_traits.length > 0));
  if (hasAsset && criteria)
    throw new Error("OpenSea offer has ambiguous asset and criteria.");
  if (hasAsset)
    return {
      scope: "ITEM" as const,
      tokenId: asset(raw, identity).tokenId,
      criteria: null,
    };
  if (!criteria)
    throw new Error("OpenSea offer lacks item or collection criteria.");
  if (
    typeof criteria.encoded_token_ids === "string" &&
    criteria.encoded_token_ids.length > 0
  )
    throw new Error("OpenSea encoded token criteria is ambiguous in V1.");
  if (
    !rec(criteria.collection) ||
    criteria.collection.slug !== identity.providerCollectionSlug
  )
    throw new Error("Offer criteria targets the wrong OpenSea collection.");
  if (rec(criteria.contract)) {
    const contract = addr(
      criteria.contract.address,
      "criteria.contract.address",
    );
    if (!isAddressEqual(contract, identity.collectionAddress))
      throw new Error("Offer criteria targets the wrong contract.");
  } else if (identity.scope === "MULTI_CONTRACT_COLLECTION_SCOPE")
    throw new Error(
      "A broad multi-contract collection offer cannot be attributed to the admitted contract.",
    );
  return {
    scope: hasTraits ? ("TRAIT" as const) : ("COLLECTION" as const),
    tokenId: null,
    criteria,
  };
}
export function normalizeOffer(
  identity: RmtNftCollectionMarketplaceIdentity,
  raw: unknown,
  retrievedAt: string,
): RmtNftOfferEvidence {
  const c = common(identity, raw, retrievedAt);
  const scoped = offerScope(c.raw, identity);
  const paymentItem = c.components.offer.find((item) =>
    [0, 1].includes(item.itemType),
  );
  if (!paymentItem) throw new Error("Offer has no payment offer item.");
  const p = price(c.raw, paymentItem.token);
  const nft = c.components.consideration.find(
    (item) =>
      [2, 3, 4, 5].includes(item.itemType) &&
      isAddressEqual(item.token, identity.collectionAddress),
  );
  if (!nft)
    throw new Error(
      "Offer protocol data does not target the admitted collection.",
    );
  const expectedItemTypes =
    identity.collectionStandard === "ERC721" ? [2, 4] : [3, 5];
  if (!expectedItemTypes.includes(nft.itemType))
    throw new Error(
      "Offer item type does not match the admitted NFT standard.",
    );
  if (scoped.scope === "ITEM") {
    if (
      ![2, 3].includes(nft.itemType) ||
      nft.identifierOrCriteria !== scoped.tokenId
    )
      throw new Error("Item-offer protocol data does not match its exact NFT.");
  } else if (![4, 5].includes(nft.itemType)) {
    throw new Error("Criteria offer must use a Seaport criteria item type.");
  }
  if (nft.startAmount === 0n)
    throw new Error("NFT offer quantity must be positive.");
  if (identity.collectionStandard === "ERC721" && nft.startAmount !== 1n)
    throw new Error("ERC721 marketplace quantity must equal one.");
  return {
    evidenceKind: "OFFER",
    scope: scoped.scope,
    criteria: scoped.criteria,
    provider: "OPENSEA",
    protocol: "SEAPORT_1_6",
    chainId: 4663,
    projectId: identity.projectId,
    collectionAddress: identity.collectionAddress,
    collectionStandard: identity.collectionStandard,
    tokenId: scoped.tokenId,
    quantity: nft.startAmount,
    maker: c.components.offerer,
    paymentAsset: p.asset,
    grossAmount: p.amount,
    startTime: c.components.startTime,
    endTime: c.components.endTime,
    orderHash: c.orderHash,
    protocolAddress: c.protocol,
    providerStatus: c.providerStatus,
    status: c.status,
    remainingQuantity: c.remainingQuantity,
    orderIdentityStatus: "ORDER_IDENTITY_VERIFIED",
    protocolData: c.components,
    provenance: c.provenance,
  };
}
export function normalizeSale(
  identity: RmtNftCollectionMarketplaceIdentity,
  raw: unknown,
  retrievedAt: string,
): RmtNftSaleEvidence | null {
  if (!rec(raw)) throw new Error("OpenSea event must be an object.");
  if (raw.event_type !== "sale") return null;
  if (raw.chain !== OPENSEA_CHAIN)
    throw new Error("OpenSea sale is for the wrong chain.");
  if (!rec(raw.nft)) throw new Error("OpenSea sale NFT is required.");
  const contract = addr(raw.nft.contract, "nft.contract");
  if (!isAddressEqual(contract, identity.collectionAddress))
    throw new Error("OpenSea sale is for the wrong contract.");
  const protocolAddress =
    raw.protocol_address == null
      ? null
      : addr(raw.protocol_address, "protocol_address");
  if (protocolAddress && !isAddressEqual(protocolAddress, SEAPORT_1_6_ADDRESS))
    throw new Error("OpenSea sale is not canonical Seaport 1.6.");
  let paymentAsset: RmtNftPaymentAsset | null = null,
    grossAmount: bigint | null = null;
  if (rec(raw.payment)) {
    const token = addr(
      raw.payment.token_address ?? ZERO_ADDRESS,
      "payment.token_address",
    );
    const native = isAddressEqual(token, ZERO_ADDRESS);
    paymentAsset = {
      kind: native ? "NATIVE" : "ERC20",
      chainId: 4663,
      address: native ? null : token,
      symbol: str(raw.payment.symbol, "payment.symbol"),
      decimals: Number(uint(raw.payment.decimals, "payment.decimals")),
    };
    grossAmount = uint(raw.payment.quantity, "payment.quantity");
  }
  const transactionHash =
    typeof raw.transaction === "string"
      ? hex32(raw.transaction, "transaction")
      : rec(raw.transaction) && raw.transaction.hash != null
        ? hex32(raw.transaction.hash, "transaction.hash")
        : null;
  const orderHash =
    raw.order_hash == null ? null : hex32(raw.order_hash, "order_hash");
  const eventTimestampRaw = raw.event_timestamp ?? raw.closing_date;
  const eventTimestamp =
    typeof eventTimestampRaw === "number"
      ? new Date(eventTimestampRaw * 1000).toISOString()
      : str(eventTimestampRaw, "event_timestamp");
  if (!Number.isFinite(Date.parse(eventTimestamp)))
    throw new Error("event_timestamp must be a timestamp.");
  return {
    evidenceKind: "SALE",
    authority: "PROVIDER_REPORTED_SALE",
    settlementVerificationStatus: "NOT_VERIFIED",
    provider: "OPENSEA",
    protocol: protocolAddress ? "SEAPORT_1_6" : null,
    chainId: 4663,
    projectId: identity.projectId,
    collectionAddress: identity.collectionAddress,
    tokenId: uint(raw.nft.identifier, "nft.identifier"),
    quantity: uint(raw.quantity ?? 1, "quantity"),
    seller: addr(raw.seller ?? raw.maker, "seller"),
    buyer: addr(raw.buyer ?? raw.taker, "buyer"),
    paymentAsset,
    grossAmount,
    transactionHash,
    orderHash,
    protocolAddress,
    eventTimestamp: new Date(eventTimestamp).toISOString(),
    provenance: provenance(raw, retrievedAt),
  };
}
export function lowestNormalizedOpenSeaListing(
  listings: readonly RmtNftListingEvidence[],
): RmtLowestNormalizedOpenSeaListing | null {
  const active = listings.filter(
    (v) => v.status === "ACTIVE" && v.paymentAsset.kind === "NATIVE",
  );
  if (!active.length) return null;
  const lowest = active.reduce((a, b) =>
    a.grossAmount <= b.grossAmount ? a : b,
  );
  return {
    authority: "LOWEST_NORMALIZED_OPENSEA_LISTING",
    rmtVerifiedFloor: false,
    collectionAddress: lowest.collectionAddress,
    paymentAsset: lowest.paymentAsset,
    grossAmount: lowest.grossAmount,
    orderHash: lowest.orderHash,
  };
}
export function openSeaReportedFloor(
  identity: RmtNftCollectionMarketplaceIdentity,
  statsRaw: unknown,
) {
  if (identity.scope !== "EXACT_CONTRACT_SCOPE") return null;
  if (
    !rec(statsRaw) ||
    !rec(statsRaw.total) ||
    typeof statsRaw.total.floor_price !== "number" ||
    !Number.isFinite(statsRaw.total.floor_price)
  )
    return null;
  return {
    authority: "OPENSEA_REPORTED_FLOOR" as const,
    rmtVerifiedFloor: false,
    providerCollectionSlug: identity.providerCollectionSlug,
    value: String(statsRaw.total.floor_price),
  };
}
