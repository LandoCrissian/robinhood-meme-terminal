import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaEntryRecord,
  type PaperArenaEntryRecord,
} from "./paper-arena-entry.ts";
import {
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";

export type PaperArenaEligibilityReason =
  | "INSUFFICIENT_VALUATIONS"
  | "INSUFFICIENT_ELAPSED_TIME"
  | "UNCONVERTED_EXTERNAL_COSTS";

export interface PaperArenaPerformancePolicy {
  policyVersion: string;
  minimumValuations: number;
  minimumElapsedMs: number;
}

export interface PaperArenaPerformanceMetrics {
  startingNavQuoteAtomic: string;
  latestLiquidationNavQuoteAtomic: string;
  peakLiquidationNavQuoteAtomic: string;
  returnQuoteAtomicExcludingExternalCosts: string;
  returnBpsExcludingExternalCosts: string;
  maxDrawdownBps: number;
  realizedPnlQuoteAtomic: string;
  unrealizedPnlQuoteAtomic: string;
  tradingPnlQuoteAtomicExcludingExternalCosts: string;
  fillCount: number;
  valuationCount: number;
  elapsedMs: number;
}

export interface PaperArenaPerformanceRecord {
  schemaVersion: 1;
  policy: PaperArenaPerformancePolicy;
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  eligibility: "ELIGIBLE" | "PROVISIONAL";
  eligibilityReasons: PaperArenaEligibilityReason[];
  metrics: PaperArenaPerformanceMetrics;
  capturedAt: number;
  performanceHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertAtomic(value: string, field: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${field} must be an unsigned base-10 integer string`);
}

function assertSignedAtomic(value: string, field: string): void {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") fail(`${field} must be a canonical signed base-10 integer string`);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) fail("invalid arena division operands");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function signedBps(delta: bigint, base: bigint): string {
  if (base <= 0n) fail("arena starting NAV must be positive");
  return (delta * 10_000n / base).toString();
}

function hasExternalCosts(valuation: PaperCanonicalValuationRecord): boolean {
  return Object.values(valuation.valuation.externalCostsByAsset).some((amount) => BigInt(amount) > 0n);
}

function validateTimeline(entry: PaperArenaEntryRecord, valuations: PaperCanonicalValuationRecord[]): void {
  if (valuations.length === 0) fail("paper arena performance requires at least one canonical valuation");
  let previousTime = -1;
  let previousRevision = entry.revision;
  for (const valuation of valuations) {
    assertPaperCanonicalValuationRecord(valuation);
    if (valuation.streamId !== entry.streamId) fail("paper arena valuation stream differs from entry");
    if (valuation.valuation.accountId !== entry.account.accountId) fail("paper arena valuation account differs from entry");
    if (valuation.valuation.quoteAssetId !== entry.quoteAssetId) fail("paper arena valuation quote asset differs from entry");
    const account = valuation.valuation.accountSnapshot;
    if (account.participantType !== entry.participantType || account.participantId !== entry.participantId) fail("paper arena valuation participant differs from entry");
    if (account.seasonId !== entry.season.seasonId) fail("paper arena valuation season differs from entry");
    if (valuation.revision < entry.revision || valuation.revision < previousRevision) fail("paper arena valuation revision moved backward");
    if (valuation.valuation.valuedAt < entry.enteredAt) fail("paper arena valuation predates entry");
    if (valuation.valuation.valuedAt <= previousTime) fail("paper arena valuation timestamps must be strictly increasing");
    if (entry.season.endsAt !== undefined && valuation.valuation.valuedAt > entry.season.endsAt) fail("paper arena valuation is outside season window");
    previousTime = valuation.valuation.valuedAt;
    previousRevision = valuation.revision;
  }
}

function derive(input: {
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  policy: PaperArenaPerformancePolicy;
}): Omit<PaperArenaPerformanceRecord, "performanceHash"> {
  assertPaperArenaEntryRecord(input.entry);
  assertNonEmpty(input.policy.policyVersion, "paper arena performance policyVersion");
  assertPositiveSafeInteger(input.policy.minimumValuations, "paper arena minimumValuations");
  assertNonNegativeSafeInteger(input.policy.minimumElapsedMs, "paper arena minimumElapsedMs");
  validateTimeline(input.entry, input.valuations);
  const valuations = input.valuations.map((valuation) => structuredClone(valuation));
  const start = BigInt(input.entry.startingNavQuoteAtomic);
  if (start <= 0n) fail("paper arena starting NAV must be positive");
  let peak = start;
  let maxDrawdownBps = 0n;
  for (const valuation of valuations) {
    const nav = BigInt(valuation.valuation.liquidationNavQuoteAtomic);
    if (nav > peak) {
      peak = nav;
      continue;
    }
    const drawdown = ceilDiv((peak - nav) * 10_000n, peak);
    if (drawdown > maxDrawdownBps) maxDrawdownBps = drawdown;
  }
  if (maxDrawdownBps > 10_000n) fail("paper arena max drawdown exceeds 10000 bps");
  const latest = valuations[valuations.length - 1]!;
  const latestNav = BigInt(latest.valuation.liquidationNavQuoteAtomic);
  const returnQuote = latestNav - start;
  const elapsedMs = latest.valuation.valuedAt - input.entry.enteredAt;
  const reasons: PaperArenaEligibilityReason[] = [];
  if (valuations.length < input.policy.minimumValuations) reasons.push("INSUFFICIENT_VALUATIONS");
  if (elapsedMs < input.policy.minimumElapsedMs) reasons.push("INSUFFICIENT_ELAPSED_TIME");
  if (hasExternalCosts(latest)) reasons.push("UNCONVERTED_EXTERNAL_COSTS");
  const metrics: PaperArenaPerformanceMetrics = {
    startingNavQuoteAtomic: input.entry.startingNavQuoteAtomic,
    latestLiquidationNavQuoteAtomic: latest.valuation.liquidationNavQuoteAtomic,
    peakLiquidationNavQuoteAtomic: peak.toString(),
    returnQuoteAtomicExcludingExternalCosts: returnQuote.toString(),
    returnBpsExcludingExternalCosts: signedBps(returnQuote, start),
    maxDrawdownBps: Number(maxDrawdownBps),
    realizedPnlQuoteAtomic: latest.valuation.realizedPnlQuoteAtomic,
    unrealizedPnlQuoteAtomic: latest.valuation.unrealizedPnlQuoteAtomic,
    tradingPnlQuoteAtomicExcludingExternalCosts: latest.valuation.totalPnlQuoteAtomicExcludingExternalCosts,
    fillCount: latest.valuation.positionBook.fillCount,
    valuationCount: valuations.length,
    elapsedMs,
  };
  return {
    schemaVersion: 1,
    policy: structuredClone(input.policy),
    entry: structuredClone(input.entry),
    valuations,
    eligibility: reasons.length === 0 ? "ELIGIBLE" : "PROVISIONAL",
    eligibilityReasons: reasons,
    metrics,
    capturedAt: latest.valuation.valuedAt,
  };
}

export function assertPaperArenaPerformanceRecord(record: PaperArenaPerformanceRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper arena performance schema version");
  assertAtomic(record.metrics.startingNavQuoteAtomic, "paper arena starting NAV");
  assertAtomic(record.metrics.latestLiquidationNavQuoteAtomic, "paper arena latest NAV");
  assertAtomic(record.metrics.peakLiquidationNavQuoteAtomic, "paper arena peak NAV");
  assertSignedAtomic(record.metrics.returnQuoteAtomicExcludingExternalCosts, "paper arena return quote amount");
  assertSignedAtomic(record.metrics.returnBpsExcludingExternalCosts, "paper arena return bps");
  assertNonNegativeSafeInteger(record.metrics.maxDrawdownBps, "paper arena maxDrawdownBps");
  if (record.metrics.maxDrawdownBps > 10_000) fail("paper arena maxDrawdownBps exceeds 10000");
  assertSignedAtomic(record.metrics.realizedPnlQuoteAtomic, "paper arena realized PnL");
  assertSignedAtomic(record.metrics.unrealizedPnlQuoteAtomic, "paper arena unrealized PnL");
  assertSignedAtomic(record.metrics.tradingPnlQuoteAtomicExcludingExternalCosts, "paper arena trading PnL");
  assertNonNegativeSafeInteger(record.metrics.fillCount, "paper arena fillCount");
  assertPositiveSafeInteger(record.metrics.valuationCount, "paper arena valuationCount");
  assertNonNegativeSafeInteger(record.metrics.elapsedMs, "paper arena elapsedMs");
  const rebuilt = derive({ entry: record.entry, valuations: record.valuations, policy: record.policy });
  const { performanceHash: _performanceHash, ...recordPayload } = record;
  if (hashCanonicalPayload(rebuilt) !== hashCanonicalPayload(recordPayload)) fail("paper arena performance payload mismatch");
  if (!/^0x[0-9a-f]{64}$/.test(record.performanceHash)) fail("paper arena performanceHash must be a sha256 hex hash");
  if (record.performanceHash !== hashCanonicalPayload(recordPayload)) fail("paper arena performance hash mismatch");
}

export function buildPaperArenaPerformance(input: {
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  policy: PaperArenaPerformancePolicy;
}): PaperArenaPerformanceRecord {
  const payload = derive(input);
  const record: PaperArenaPerformanceRecord = { ...payload, performanceHash: hashCanonicalPayload(payload) };
  assertPaperArenaPerformanceRecord(record);
  return record;
}
