import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaNetPerformanceRecord,
  type PaperArenaNetPerformanceRecord,
} from "./paper-arena-net-performance.ts";

export const RMT_ARENA_NET_LEADERBOARD_POLICY_V1 = "RMT_ARENA_NET_LEADERBOARD_V1" as const;

export type PaperArenaNetLeaderboardView = "OVERALL" | "AGENT" | "HUMAN";

export interface PaperArenaNetRankedEntry {
  rank: number;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  netPerformanceHash: string;
  netReturnQuoteAtomic: string;
  netReturnBps: string;
  netMaxDrawdownBps: number;
  fillCount: number;
  latestNetLiquidationNavQuoteAtomic: string;
  latestExternalCostQuoteAtomic: string;
  capturedAt: number;
}

export interface PaperArenaNetProvisionalEntry {
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  netPerformanceHash: string;
  eligibilityReasons: string[];
  capturedAt: number;
}

export interface PaperArenaNetLeaderboardRecord {
  schemaVersion: 1;
  leaderboardPolicy: typeof RMT_ARENA_NET_LEADERBOARD_POLICY_V1;
  seasonId: string;
  streamId: string;
  quoteAssetId: string;
  startingNavQuoteAtomic: string;
  basePerformancePolicyHash: string;
  externalCostPolicyHash: string | null;
  view: PaperArenaNetLeaderboardView;
  netPerformances: PaperArenaNetPerformanceRecord[];
  rankedEntries: PaperArenaNetRankedEntry[];
  provisionalEntries: PaperArenaNetProvisionalEntry[];
  capturedAt: number;
  leaderboardHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertAtomic(value: string, field: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${field} must be an unsigned base-10 integer string`);
}

function assertSignedAtomic(value: string, field: string): void {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") fail(`${field} must be a canonical signed base-10 integer string`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function viewAllows(view: PaperArenaNetLeaderboardView, type: "AGENT" | "HUMAN"): boolean {
  return view === "OVERALL" || view === type;
}

function identity(record: PaperArenaNetPerformanceRecord): string {
  const entry = record.basePerformance.entry;
  return `${entry.participantType}:${entry.participantId}`;
}

function sameCompetition(left: PaperArenaNetPerformanceRecord, right: PaperArenaNetPerformanceRecord): void {
  const leftBase = left.basePerformance;
  const rightBase = right.basePerformance;
  if (hashCanonicalPayload(leftBase.policy) !== hashCanonicalPayload(rightBase.policy)) fail("arena net leaderboard contains mixed base performance policies");
  if (hashCanonicalPayload(leftBase.entry.season) !== hashCanonicalPayload(rightBase.entry.season)) fail("arena net leaderboard contains mixed seasons");
  if (leftBase.entry.streamId !== rightBase.entry.streamId) fail("arena net leaderboard contains mixed streams");
  if (leftBase.entry.quoteAssetId !== rightBase.entry.quoteAssetId) fail("arena net leaderboard contains mixed quote assets");
  if (leftBase.entry.startingNavQuoteAtomic !== rightBase.entry.startingNavQuoteAtomic) fail("arena net leaderboard contains mixed starting capital");
  if (left.externalCostPolicyHash !== null && right.externalCostPolicyHash !== null && left.externalCostPolicyHash !== right.externalCostPolicyHash) {
    fail("arena net leaderboard contains mixed external-cost policies");
  }
}

function compareEligible(left: PaperArenaNetPerformanceRecord, right: PaperArenaNetPerformanceRecord): number {
  const leftReturn = BigInt(left.metrics.netReturnQuoteAtomic);
  const rightReturn = BigInt(right.metrics.netReturnQuoteAtomic);
  if (leftReturn !== rightReturn) return leftReturn > rightReturn ? -1 : 1;
  if (left.metrics.netMaxDrawdownBps !== right.metrics.netMaxDrawdownBps) return left.metrics.netMaxDrawdownBps - right.metrics.netMaxDrawdownBps;
  if (left.metrics.fillCount !== right.metrics.fillCount) return left.metrics.fillCount - right.metrics.fillCount;
  const leftEntry = left.basePerformance.entry;
  const rightEntry = right.basePerformance.entry;
  const idOrder = leftEntry.participantId.localeCompare(rightEntry.participantId);
  if (idOrder !== 0) return idOrder;
  return leftEntry.participantType.localeCompare(rightEntry.participantType);
}

function compareProvisional(left: PaperArenaNetPerformanceRecord, right: PaperArenaNetPerformanceRecord): number {
  const leftEntry = left.basePerformance.entry;
  const rightEntry = right.basePerformance.entry;
  const typeOrder = leftEntry.participantType.localeCompare(rightEntry.participantType);
  if (typeOrder !== 0) return typeOrder;
  return leftEntry.participantId.localeCompare(rightEntry.participantId);
}

function derive(input: {
  netPerformances: PaperArenaNetPerformanceRecord[];
  view: PaperArenaNetLeaderboardView;
}): Omit<PaperArenaNetLeaderboardRecord, "leaderboardHash"> {
  if (!Array.isArray(input.netPerformances) || input.netPerformances.length === 0) fail("arena net leaderboard requires at least one net performance record");
  if (input.view !== "OVERALL" && input.view !== "AGENT" && input.view !== "HUMAN") fail("arena net leaderboard view is invalid");
  input.netPerformances.forEach(assertPaperArenaNetPerformanceRecord);
  const first = input.netPerformances[0]!;
  for (const performance of input.netPerformances.slice(1)) sameCompetition(first, performance);

  const identities = new Set<string>();
  for (const performance of input.netPerformances) {
    const key = identity(performance);
    if (identities.has(key)) fail("arena net leaderboard contains duplicate participant performance");
    identities.add(key);
  }

  const netPerformances = input.netPerformances.map((performance) => structuredClone(performance));
  const visible = netPerformances.filter((performance) => viewAllows(input.view, performance.basePerformance.entry.participantType));
  const eligible = visible.filter((performance) => performance.eligibility === "ELIGIBLE").sort(compareEligible);
  const provisional = visible.filter((performance) => performance.eligibility === "PROVISIONAL").sort(compareProvisional);
  const rankedEntries = eligible.map((performance, index): PaperArenaNetRankedEntry => {
    const entry = performance.basePerformance.entry;
    return {
      rank: index + 1,
      participantType: entry.participantType,
      participantId: entry.participantId,
      netPerformanceHash: performance.netPerformanceHash,
      netReturnQuoteAtomic: performance.metrics.netReturnQuoteAtomic,
      netReturnBps: performance.metrics.netReturnBps,
      netMaxDrawdownBps: performance.metrics.netMaxDrawdownBps,
      fillCount: performance.metrics.fillCount,
      latestNetLiquidationNavQuoteAtomic: performance.metrics.latestNetLiquidationNavQuoteAtomic,
      latestExternalCostQuoteAtomic: performance.metrics.latestExternalCostQuoteAtomic,
      capturedAt: performance.capturedAt,
    };
  });
  const provisionalEntries = provisional.map((performance): PaperArenaNetProvisionalEntry => {
    const entry = performance.basePerformance.entry;
    return {
      participantType: entry.participantType,
      participantId: entry.participantId,
      netPerformanceHash: performance.netPerformanceHash,
      eligibilityReasons: structuredClone(performance.eligibilityReasons),
      capturedAt: performance.capturedAt,
    };
  });
  const nonNullCostPolicies = [...new Set(netPerformances.map((value) => value.externalCostPolicyHash).filter((value): value is string => value !== null))];
  if (nonNullCostPolicies.length > 1) fail("arena net leaderboard contains mixed external-cost policies");
  const firstBase = first.basePerformance;
  const capturedAt = visible.length > 0
    ? Math.max(...visible.map((performance) => performance.capturedAt))
    : Math.max(...netPerformances.map((performance) => performance.capturedAt));

  return {
    schemaVersion: 1,
    leaderboardPolicy: RMT_ARENA_NET_LEADERBOARD_POLICY_V1,
    seasonId: firstBase.entry.season.seasonId,
    streamId: firstBase.entry.streamId,
    quoteAssetId: firstBase.entry.quoteAssetId,
    startingNavQuoteAtomic: firstBase.entry.startingNavQuoteAtomic,
    basePerformancePolicyHash: hashCanonicalPayload(firstBase.policy),
    externalCostPolicyHash: nonNullCostPolicies[0] ?? null,
    view: input.view,
    netPerformances,
    rankedEntries,
    provisionalEntries,
    capturedAt,
  };
}

export function assertPaperArenaNetLeaderboardRecord(record: PaperArenaNetLeaderboardRecord): void {
  if (record.schemaVersion !== 1 || record.leaderboardPolicy !== RMT_ARENA_NET_LEADERBOARD_POLICY_V1) fail("unsupported arena net leaderboard policy");
  assertNonEmpty(record.seasonId, "arena net leaderboard seasonId");
  assertNonEmpty(record.streamId, "arena net leaderboard streamId");
  assertNonEmpty(record.quoteAssetId, "arena net leaderboard quoteAssetId");
  assertAtomic(record.startingNavQuoteAtomic, "arena net leaderboard starting NAV");
  assertHash(record.basePerformancePolicyHash, "arena net leaderboard basePerformancePolicyHash");
  if (record.externalCostPolicyHash !== null) assertHash(record.externalCostPolicyHash, "arena net leaderboard externalCostPolicyHash");
  assertTimestamp(record.capturedAt, "arena net leaderboard capturedAt");
  if (!Array.isArray(record.netPerformances) || record.netPerformances.length === 0) fail("arena net leaderboard requires source net performances");
  record.netPerformances.forEach(assertPaperArenaNetPerformanceRecord);

  for (let index = 0; index < record.rankedEntries.length; index += 1) {
    const entry = record.rankedEntries[index]!;
    if (entry.rank !== index + 1) fail("arena net leaderboard ranks are not contiguous");
    if (!viewAllows(record.view, entry.participantType)) fail("arena net ranked entry is outside leaderboard view");
    assertNonEmpty(entry.participantId, "arena net ranked participantId");
    assertHash(entry.netPerformanceHash, "arena net ranked performanceHash");
    assertSignedAtomic(entry.netReturnQuoteAtomic, "arena net ranked return amount");
    assertSignedAtomic(entry.netReturnBps, "arena net ranked return bps");
    if (!Number.isSafeInteger(entry.netMaxDrawdownBps) || entry.netMaxDrawdownBps < 0 || entry.netMaxDrawdownBps > 10_000) fail("arena net ranked drawdown is invalid");
    if (!Number.isSafeInteger(entry.fillCount) || entry.fillCount < 0) fail("arena net ranked fill count is invalid");
    assertAtomic(entry.latestNetLiquidationNavQuoteAtomic, "arena net ranked NAV");
    assertAtomic(entry.latestExternalCostQuoteAtomic, "arena net ranked external cost");
    assertTimestamp(entry.capturedAt, "arena net ranked capturedAt");
  }
  for (const entry of record.provisionalEntries) {
    if (!viewAllows(record.view, entry.participantType)) fail("arena net provisional entry is outside leaderboard view");
    assertNonEmpty(entry.participantId, "arena net provisional participantId");
    assertHash(entry.netPerformanceHash, "arena net provisional performanceHash");
    if (entry.eligibilityReasons.length === 0) fail("arena net provisional entry requires eligibility reasons");
    assertTimestamp(entry.capturedAt, "arena net provisional capturedAt");
  }

  const rebuilt = derive({ netPerformances: record.netPerformances, view: record.view });
  const { leaderboardHash, ...payload } = record;
  if (hashCanonicalPayload(rebuilt) !== hashCanonicalPayload(payload)) fail("arena net leaderboard payload is not correctly derived from source net performances");
  assertHash(leaderboardHash, "arena net leaderboardHash");
  if (leaderboardHash !== hashCanonicalPayload(payload)) fail("arena net leaderboard hash mismatch");
}

export function buildPaperArenaNetLeaderboard(input: {
  netPerformances: PaperArenaNetPerformanceRecord[];
  view?: PaperArenaNetLeaderboardView;
}): PaperArenaNetLeaderboardRecord {
  const payload = derive({ netPerformances: input.netPerformances, view: input.view ?? "OVERALL" });
  const record: PaperArenaNetLeaderboardRecord = { ...payload, leaderboardHash: hashCanonicalPayload(payload) };
  assertPaperArenaNetLeaderboardRecord(record);
  return record;
}
