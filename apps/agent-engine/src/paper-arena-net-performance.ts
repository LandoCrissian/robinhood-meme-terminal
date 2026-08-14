import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaPerformanceRecord,
  type PaperArenaEligibilityReason,
  type PaperArenaPerformanceRecord,
} from "./paper-arena-performance.ts";
import {
  assertPaperExternalCostValuationRecord,
  type PaperExternalCostValuationRecord,
} from "./paper-external-cost-valuation.ts";

export interface PaperArenaNetPerformanceMetrics {
  startingNavQuoteAtomic: string;
  latestGrossLiquidationNavQuoteAtomic: string;
  latestExternalCostQuoteAtomic: string;
  latestNetLiquidationNavQuoteAtomic: string;
  netReturnQuoteAtomic: string;
  netReturnBps: string;
  netMaxDrawdownBps: number;
  grossTradingPnlQuoteAtomicExcludingExternalCosts: string;
  netTradingPnlQuoteAtomic: string;
  fillCount: number;
  valuationCount: number;
  elapsedMs: number;
}

export interface PaperArenaNetPerformanceRecord {
  schemaVersion: 1;
  policyVersion: "RMT_ARENA_NET_PERFORMANCE_V1";
  basePerformance: PaperArenaPerformanceRecord;
  externalCostValuations: PaperExternalCostValuationRecord[];
  externalCostPolicyHash: string | null;
  eligibility: "ELIGIBLE" | "PROVISIONAL";
  eligibilityReasons: Exclude<PaperArenaEligibilityReason, "UNCONVERTED_EXTERNAL_COSTS">[];
  metrics: PaperArenaNetPerformanceMetrics;
  capturedAt: number;
  netPerformanceHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertSignedAtomic(value: string, field: string): void {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") fail(`${field} must be a canonical signed base-10 integer string`);
}

function assertAtomic(value: string, field: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${field} must be an unsigned base-10 integer string`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) fail("invalid net-performance division operands");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function signedBps(delta: bigint, base: bigint): string {
  if (base <= 0n) fail("net-performance starting NAV must be positive");
  return (delta * 10_000n / base).toString();
}

function costPolicyHash(values: PaperExternalCostValuationRecord[]): string | null {
  if (values.length === 0) return null;
  const hashes = new Set(values.map((value) => hashCanonicalPayload(value.policy)));
  if (hashes.size !== 1) fail("arena net performance contains mixed external-cost policies");
  return [...hashes][0]!;
}

function costForBook(
  bookHash: string,
  eventCount: number,
  values: PaperExternalCostValuationRecord[],
): bigint {
  const matches = values.filter((value) => value.positionBook.bookHash === bookHash);
  if (eventCount === 0) {
    if (matches.length > 1) fail("arena net performance contains duplicate zero-cost valuation for position book");
    if (matches.length === 1 && matches[0]!.totalExternalCostQuoteAtomic !== "0") fail("arena net performance zero-cost book has non-zero external cost valuation");
    return 0n;
  }
  if (matches.length !== 1) fail("arena net performance requires exactly one external-cost valuation for each cost-bearing position book");
  return BigInt(matches[0]!.totalExternalCostQuoteAtomic);
}

function derive(input: {
  basePerformance: PaperArenaPerformanceRecord;
  externalCostValuations: PaperExternalCostValuationRecord[];
}): Omit<PaperArenaNetPerformanceRecord, "netPerformanceHash"> {
  assertPaperArenaPerformanceRecord(input.basePerformance);
  input.externalCostValuations.forEach(assertPaperExternalCostValuationRecord);
  const valuations = input.basePerformance.valuations;
  const quoteAssetId = input.basePerformance.entry.quoteAssetId;
  const expectedBookHashes = new Set(valuations.map((valuation) => valuation.valuation.positionBook.bookHash));
  for (const cost of input.externalCostValuations) {
    if (cost.quoteAssetId !== quoteAssetId) fail("arena net performance external-cost quote asset mismatch");
    if (!expectedBookHashes.has(cost.positionBook.bookHash)) fail("arena net performance external-cost valuation does not belong to performance history");
  }
  const policyHash = costPolicyHash(input.externalCostValuations);
  const start = BigInt(input.basePerformance.entry.startingNavQuoteAtomic);
  let peakNet = start;
  let maxDrawdown = 0n;
  const netSeries = valuations.map((valuation) => {
    const book = valuation.valuation.positionBook;
    const cost = costForBook(book.bookHash, book.externalCostEvents.length, input.externalCostValuations);
    const grossNav = BigInt(valuation.valuation.liquidationNavQuoteAtomic);
    if (cost > grossNav) fail("arena net performance external costs exceed gross liquidation NAV");
    const netNav = grossNav - cost;
    if (netNav > peakNet) {
      peakNet = netNav;
    } else {
      const drawdown = ceilDiv((peakNet - netNav) * 10_000n, peakNet);
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    return { valuation, cost, grossNav, netNav };
  });
  if (maxDrawdown > 10_000n) fail("arena net performance drawdown exceeds 10000 bps");
  const latest = netSeries[netSeries.length - 1]!;
  const netReturn = latest.netNav - start;
  const grossTradingPnl = BigInt(input.basePerformance.metrics.tradingPnlQuoteAtomicExcludingExternalCosts);
  const netTradingPnl = grossTradingPnl - latest.cost;
  const reasons = input.basePerformance.eligibilityReasons.filter((reason): reason is Exclude<PaperArenaEligibilityReason, "UNCONVERTED_EXTERNAL_COSTS"> => reason !== "UNCONVERTED_EXTERNAL_COSTS");
  return {
    schemaVersion: 1,
    policyVersion: "RMT_ARENA_NET_PERFORMANCE_V1",
    basePerformance: structuredClone(input.basePerformance),
    externalCostValuations: input.externalCostValuations.map((value) => structuredClone(value)),
    externalCostPolicyHash: policyHash,
    eligibility: reasons.length === 0 ? "ELIGIBLE" : "PROVISIONAL",
    eligibilityReasons: reasons,
    metrics: {
      startingNavQuoteAtomic: input.basePerformance.entry.startingNavQuoteAtomic,
      latestGrossLiquidationNavQuoteAtomic: latest.grossNav.toString(),
      latestExternalCostQuoteAtomic: latest.cost.toString(),
      latestNetLiquidationNavQuoteAtomic: latest.netNav.toString(),
      netReturnQuoteAtomic: netReturn.toString(),
      netReturnBps: signedBps(netReturn, start),
      netMaxDrawdownBps: Number(maxDrawdown),
      grossTradingPnlQuoteAtomicExcludingExternalCosts: grossTradingPnl.toString(),
      netTradingPnlQuoteAtomic: netTradingPnl.toString(),
      fillCount: input.basePerformance.metrics.fillCount,
      valuationCount: input.basePerformance.metrics.valuationCount,
      elapsedMs: input.basePerformance.metrics.elapsedMs,
    },
    capturedAt: input.basePerformance.capturedAt,
  };
}

export function assertPaperArenaNetPerformanceRecord(record: PaperArenaNetPerformanceRecord): void {
  if (record.schemaVersion !== 1 || record.policyVersion !== "RMT_ARENA_NET_PERFORMANCE_V1") fail("unsupported arena net-performance policy");
  assertAtomic(record.metrics.startingNavQuoteAtomic, "arena net starting NAV");
  assertAtomic(record.metrics.latestGrossLiquidationNavQuoteAtomic, "arena net gross NAV");
  assertAtomic(record.metrics.latestExternalCostQuoteAtomic, "arena net external cost");
  assertAtomic(record.metrics.latestNetLiquidationNavQuoteAtomic, "arena net NAV");
  assertSignedAtomic(record.metrics.netReturnQuoteAtomic, "arena net return quote amount");
  assertSignedAtomic(record.metrics.netReturnBps, "arena net return bps");
  if (!Number.isSafeInteger(record.metrics.netMaxDrawdownBps) || record.metrics.netMaxDrawdownBps < 0 || record.metrics.netMaxDrawdownBps > 10_000) fail("arena net drawdown is invalid");
  assertSignedAtomic(record.metrics.grossTradingPnlQuoteAtomicExcludingExternalCosts, "arena net gross trading PnL");
  assertSignedAtomic(record.metrics.netTradingPnlQuoteAtomic, "arena net trading PnL");
  if (!Number.isSafeInteger(record.metrics.fillCount) || record.metrics.fillCount < 0) fail("arena net fill count is invalid");
  if (!Number.isSafeInteger(record.metrics.valuationCount) || record.metrics.valuationCount <= 0) fail("arena net valuation count is invalid");
  if (!Number.isSafeInteger(record.metrics.elapsedMs) || record.metrics.elapsedMs < 0) fail("arena net elapsed time is invalid");
  if (record.externalCostPolicyHash !== null) assertHash(record.externalCostPolicyHash, "arena net externalCostPolicyHash");
  const rebuilt = derive({ basePerformance: record.basePerformance, externalCostValuations: record.externalCostValuations });
  const { netPerformanceHash, ...payload } = record;
  if (hashCanonicalPayload(rebuilt) !== hashCanonicalPayload(payload)) fail("arena net performance payload mismatch");
  assertHash(netPerformanceHash, "arena netPerformanceHash");
  if (netPerformanceHash !== hashCanonicalPayload(payload)) fail("arena net performance hash mismatch");
}

export function buildPaperArenaNetPerformance(input: {
  basePerformance: PaperArenaPerformanceRecord;
  externalCostValuations?: PaperExternalCostValuationRecord[];
}): PaperArenaNetPerformanceRecord {
  const payload = derive({
    basePerformance: input.basePerformance,
    externalCostValuations: input.externalCostValuations ?? [],
  });
  const record: PaperArenaNetPerformanceRecord = { ...payload, netPerformanceHash: hashCanonicalPayload(payload) };
  assertPaperArenaNetPerformanceRecord(record);
  return record;
}
