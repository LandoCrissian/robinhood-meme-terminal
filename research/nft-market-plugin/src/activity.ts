import { normalizeAddress, type NftCollectionId } from "./domain.ts";

export type NftSaleObservation = {
  collection: NftCollectionId;
  tokenId: string;
  buyer: string;
  seller: string;
  paymentUsd: number | null;
  timestampMs: number;
  transactionHash: string;
};

export type OrganicActivityAssessment = {
  score: number;
  confidence: "high" | "mixed" | "low" | "unavailable";
  signals: string[];
  distinctBuyers: number;
  distinctSellers: number;
  selfTrades: number;
  rapidRoundTrips: number;
  dominantCounterpartyShare: number | null;
};

export function assessOrganicActivity(sales: NftSaleObservation[], windowMs = 24 * 60 * 60 * 1_000): OrganicActivityAssessment {
  if (sales.length === 0) return {
    score: 0,
    confidence: "unavailable",
    signals: ["no_recent_sales"],
    distinctBuyers: 0,
    distinctSellers: 0,
    selfTrades: 0,
    rapidRoundTrips: 0,
    dominantCounterpartyShare: null
  };
  const ordered = [...sales].sort((a, b) => a.timestampMs - b.timestampMs);
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  const pairCounts = new Map<string, number>();
  let selfTrades = 0;
  let rapidRoundTrips = 0;
  const priorByToken = new Map<string, NftSaleObservation>();
  for (const sale of ordered) {
    const buyer = normalizeAddress(sale.buyer);
    const seller = normalizeAddress(sale.seller);
    buyers.add(buyer);
    sellers.add(seller);
    if (buyer === seller) selfTrades += 1;
    const pair = [buyer, seller].sort().join(":");
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    const tokenKey = `${sale.collection.contract.toLowerCase()}:${sale.tokenId}`;
    const previous = priorByToken.get(tokenKey);
    if (
      previous
      && sale.timestampMs - previous.timestampMs <= windowMs
      && normalizeAddress(previous.buyer) === seller
      && normalizeAddress(previous.seller) === buyer
    ) rapidRoundTrips += 1;
    priorByToken.set(tokenKey, sale);
  }
  const dominant = Math.max(...pairCounts.values()) / sales.length;
  let score = 100;
  const signals: string[] = [];
  if (selfTrades > 0) {
    score -= Math.min(45, Math.round((selfTrades / sales.length) * 100));
    signals.push("self_trade_evidence");
  }
  if (rapidRoundTrips > 0) {
    score -= Math.min(35, Math.round((rapidRoundTrips / sales.length) * 80));
    signals.push("rapid_round_trip_evidence");
  }
  if (dominant >= 0.5) {
    score -= Math.min(30, Math.round(dominant * 40));
    signals.push("counterparty_concentration");
  }
  const diversity = Math.min(buyers.size, sellers.size) / sales.length;
  if (sales.length >= 5 && diversity < 0.25) {
    score -= 15;
    signals.push("low_counterparty_diversity");
  }
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    confidence: score >= 80 ? "high" : score >= 50 ? "mixed" : "low",
    signals: signals.length > 0 ? signals : ["no_structural_wash_signal_detected"],
    distinctBuyers: buyers.size,
    distinctSellers: sellers.size,
    selfTrades,
    rapidRoundTrips,
    dominantCounterpartyShare: dominant
  };
}
