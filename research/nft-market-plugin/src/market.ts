import {
  assertOrder,
  itemKey,
  positiveAtomic,
  sameCollection,
  sameItem,
  type FeeComponent,
  type NftExecutableQuote,
  type NftItemId,
  type NftMarketOrder,
  type PaymentAsset
} from "./domain.ts";

function sumAtomic(values: string[]) {
  return values.reduce((sum, value) => sum + BigInt(positiveAtomic(value, { allowZero: true })), 0n);
}

function samePaymentAsset(left: PaymentAsset, right: PaymentAsset) {
  if (left.kind !== right.kind || left.chainId !== right.chainId) return false;
  return left.kind === "native" || (right.kind === "erc20" && left.contract.toLowerCase() === right.contract.toLowerCase());
}

export function orderFeeTotal(order: NftMarketOrder) {
  assertOrder(order);
  return sumAtomic(order.fees.filter((fee) => samePaymentAsset(fee.asset, order.paymentAsset)).map((fee) => fee.amountAtomic));
}

export function buyerTotalAtomic(order: NftMarketOrder) {
  const buyerFees = sumAtomic(order.fees
    .filter((fee) => samePaymentAsset(fee.asset, order.paymentAsset) && (fee.payer === "buyer" || fee.payer === "taker"))
    .map((fee) => fee.amountAtomic));
  return (BigInt(order.grossAmountAtomic) + buyerFees).toString();
}

export function sellerProceedsAtomic(order: NftMarketOrder) {
  const sellerFees = sumAtomic(order.fees
    .filter((fee) => samePaymentAsset(fee.asset, order.paymentAsset) && (fee.payer === "seller" || fee.payer === "maker"))
    .map((fee) => fee.amountAtomic));
  const gross = BigInt(order.grossAmountAtomic);
  return sellerFees >= gross ? "0" : (gross - sellerFees).toString();
}

export function orderCanFillItem(order: NftMarketOrder, item: NftItemId, nowMs: number) {
  if (!order.fillable || order.status !== "active" || order.startTimeMs > nowMs || order.endTimeMs <= nowMs) return false;
  if (order.criteria.kind === "item") return sameItem(order.criteria.item, item);
  if (order.criteria.kind === "collection") return sameCollection(order.criteria.collection, item);
  return sameCollection(order.criteria.collection, item);
}

export function uniqueBestListings(orders: NftMarketOrder[], nowMs: number) {
  const best = new Map<string, NftMarketOrder>();
  for (const order of orders) {
    assertOrder(order);
    if (order.kind !== "listing" || order.criteria.kind !== "item" || !orderCanFillItem(order, order.criteria.item, nowMs)) continue;
    const key = itemKey(order.criteria.item);
    const current = best.get(key);
    if (!current || BigInt(buyerTotalAtomic(order)) < BigInt(buyerTotalAtomic(current))) best.set(key, order);
  }
  return [...best.values()].sort((left, right) => {
    const diff = BigInt(buyerTotalAtomic(left)) - BigInt(buyerTotalAtomic(right));
    return diff < 0n ? -1 : diff > 0n ? 1 : left.orderId.localeCompare(right.orderId);
  });
}

export function bestAsk(orders: NftMarketOrder[], item: NftItemId, nowMs: number) {
  return orders
    .filter((order) => order.kind === "listing" && orderCanFillItem(order, item, nowMs))
    .sort((left, right) => {
      const diff = BigInt(buyerTotalAtomic(left)) - BigInt(buyerTotalAtomic(right));
      return diff < 0n ? -1 : diff > 0n ? 1 : left.orderId.localeCompare(right.orderId);
    })[0] ?? null;
}

export function bestBid(orders: NftMarketOrder[], item: NftItemId, nowMs: number) {
  return orders
    .filter((order) => order.kind !== "listing" && orderCanFillItem(order, item, nowMs))
    .sort((left, right) => {
      const diff = BigInt(sellerProceedsAtomic(right)) - BigInt(sellerProceedsAtomic(left));
      return diff < 0n ? -1 : diff > 0n ? 1 : left.orderId.localeCompare(right.orderId);
    })[0] ?? null;
}

export function planSweep(input: {
  listings: NftMarketOrder[];
  desiredCount: number;
  maxSpendAtomic: string;
  nowMs: number;
}) {
  if (!Number.isInteger(input.desiredCount) || input.desiredCount <= 0 || input.desiredCount > 100) throw new Error("Sweep count is outside bounded range");
  const budget = BigInt(positiveAtomic(input.maxSpendAtomic));
  const selected: NftMarketOrder[] = [];
  let spent = 0n;
  for (const listing of uniqueBestListings(input.listings, input.nowMs)) {
    const cost = BigInt(buyerTotalAtomic(listing));
    if (selected.length >= input.desiredCount) break;
    if (spent + cost > budget) continue;
    selected.push(listing);
    spent += cost;
  }
  return {
    selected,
    filledCount: selected.length,
    totalCostAtomic: spent.toString(),
    complete: selected.length === input.desiredCount
  };
}

export function quoteFromOrder(input: { order: NftMarketOrder; item: NftItemId; side: "buy" | "sell"; nowMs: number }): NftExecutableQuote {
  const { order, item, side, nowMs } = input;
  assertOrder(order);
  if (!orderCanFillItem(order, item, nowMs)) throw new Error("Order is not currently fillable for item");
  return {
    quoteId: `${order.venueId}:${order.orderId}:${itemKey(item)}:${side}`,
    side,
    venueId: order.venueId,
    order,
    item,
    quantityAtomic: order.quantityAtomic,
    paymentAsset: order.paymentAsset,
    grossAmountAtomic: order.grossAmountAtomic,
    feeAmountAtomic: orderFeeTotal(order).toString(),
    totalUserCostAtomic: side === "buy" ? buyerTotalAtomic(order) : null,
    sellerProceedsAtomic: side === "sell" ? sellerProceedsAtomic(order) : null,
    expiresAtMs: order.endTimeMs,
    verificationState: "verification_required",
    rmtFeeState: "not_admitted"
  };
}

export function assertNoImplicitRmtFee(fees: FeeComponent[]) {
  for (const fee of fees) {
    if (fee.kind === "rmt" && fee.enforcement !== "not_admitted") {
      throw new Error("NFT execution has no admitted RMT fee policy; do not inherit fungible execution economics");
    }
  }
  return true;
}
