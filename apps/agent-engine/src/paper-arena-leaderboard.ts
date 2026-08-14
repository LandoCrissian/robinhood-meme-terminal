import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaPerformanceRecord,
  type PaperArenaEligibilityReason,
  type PaperArenaPerformancePolicy,
  type PaperArenaPerformanceRecord,
} from "./paper-arena-performance.ts";

export const RMT_ARENA_LEADERBOARD_POLICY_V1 = "RMT_ARENA_LEADERBOARD_RETURN_DRAWDOWN_V1" as const;

export type PaperArenaLeaderboardView = "OVERALL" | "AGENT" | "HUMAN";

export interface PaperArenaRankedEntry {
  rank: number;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  performanceHash: string;
  returnBpsExcludingExternalCosts: string;
  maxDrawdownBps: number;
  fillCount: number;
  latestLiquidationNavQuoteAtomic: string;
  capturedAt: number;
}

export interface PaperArenaProvisionalEntry {
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  performanceHash: string;
  eligibilityReasons: PaperArenaEligibilityReason[];
  capturedAt: number;
}

export interface PaperArenaLeaderboardRecord {
  schemaVersion: 1;
  leaderboardPolicy: typeof RMT_ARENA_LEADERBOARD_POLICY_V1;
  performancePolicy: PaperArenaPerformancePolicy;
  seasonId: string;
  streamId: string;
  quoteAssetId: string;
  startingNavQuoteAtomic: string;
  view: PaperArenaLeaderboardView;
  performances: PaperArenaPerformanceRecord[];
  rankedEntries: PaperArenaRankedEntry[];
  provisionalEntries: PaperArenaProvisionalEntry[];
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

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
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

function viewAllows(view: PaperArenaLeaderboardView, type: "AGENT" | "HUMAN"): boolean {
  return view === "OVERALL" || view === type;
}

function performanceIdentity(record: PaperArenaPerformanceRecord): string {
  return `${record.entry.participantType}:${record.entry.participantId}`;
}

function sameCompetition(left: PaperArenaPerformanceRecord, right: PaperArenaPerformanceRecord): void {
  if (hashCanonicalPayload(left.policy) !== hashCanonicalPayload(right.policy)) fail("paper arena leaderboard contains mixed performance policies");
  if (hashCanonicalPayload(left.entry.season) !== hashCanonicalPayload(right.entry.season)) fail("paper arena leaderboard contains mixed seasons");
  if (left.entry.streamId !== right.entry.streamId) fail("paper arena leaderboard contains mixed streams");
  if (left.entry.quoteAssetId !== right.entry.quoteAssetId) fail("paper arena leaderboard contains mixed quote assets");
  if (left.entry.startingNavQuoteAtomic !== right.entry.startingNavQuoteAtomic) fail("paper arena leaderboard contains mixed starting capital");
}

function compareEligible(left: PaperArenaPerformanceRecord, right: PaperArenaPerformanceRecord): number {
  const leftReturn = BigInt(left.metrics.returnBpsExcludingExternalCosts);
  const rightReturn = BigInt(right.metrics.returnBpsExcludingExternalCosts);
  if (leftReturn !== rightReturn) return leftReturn > rightReturn ? -1 : 1;
  if (left.metrics.maxDrawdownBps !== right.metrics.maxDrawdownBps) return left.metrics.maxDrawdownBps - right.metrics.maxDrawdownBps;
  if (left.metrics.fillCount !== right.metrics.fillCount) return left.metrics.fillCount - right.metrics.fillCount;
  const participantOrder = left.entry.participantId.localeCompare(right.entry.participantId);
  if (participantOrder !== 0) return participantOrder;
  return left.entry.participantType.localeCompare(right.entry.participantType);
}

function compareProvisional(left: PaperArenaPerformanceRecord, right: PaperArenaPerformanceRecord): number {
  const typeOrder = left.entry.participantType.localeCompare(right.entry.participantType);
  if (typeOrder !== 0) return typeOrder;
  return left.entry.participantId.localeCompare(right.entry.participantId);
}

function derive(input: {
  performances: PaperArenaPerformanceRecord[];
  view: PaperArenaLeaderboardView;
}): Omit<PaperArenaLeaderboardRecord, "leaderboardHash"> {
  if (!Array.isArray(input.performances) || input.performances.length === 0) fail("paper arena leaderboard requires at least one performance record");
  if (input.view !== "OVERALL" && input.view !== "AGENT" && input.view !== "HUMAN") fail("paper arena leaderboard view is invalid");
  input.performances.forEach(assertPaperArenaPerformanceRecord);
  const first = input.performances[0]!;
  for (const performance of input.performances.slice(1)) sameCompetition(first, performance);
  const identities = new Set<string>();
  for (const performance of input.performances) {
    const identity = performanceIdentity(performance);
    if (identities.has(identity)) fail("paper arena leaderboard contains duplicate participant performance");
    identities.add(identity);
  }
  const performances = input.performances.map((performance) => structuredClone(performance));
  const visible = performances.filter((performance) => viewAllows(input.view, performance.entry.participantType));
  const eligible = visible.filter((performance) => performance.eligibility === "ELIGIBLE").sort(compareEligible);
  const provisional = visible.filter((performance) => performance.eligibility === "PROVISIONAL").sort(compareProvisional);
  const rankedEntries = eligible.map((performance, index): PaperArenaRankedEntry => ({
    rank: index + 1,
    participantType: performance.entry.participantType,
    participantId: performance.entry.participantId,
    performanceHash: performance.performanceHash,
    returnBpsExcludingExternalCosts: performance.metrics.returnBpsExcludingExternalCosts,
    maxDrawdownBps: performance.metrics.maxDrawdownBps,
    fillCount: performance.metrics.fillCount,
    latestLiquidationNavQuoteAtomic: performance.metrics.latestLiquidationNavQuoteAtomic,
    capturedAt: performance.capturedAt,
  }));
  const provisionalEntries = provisional.map((performance): PaperArenaProvisionalEntry => ({
    participantType: performance.entry.participantType,
    participantId: performance.entry.participantId,
    performanceHash: performance.performanceHash,
    eligibilityReasons: structuredClone(performance.eligibilityReasons),
    capturedAt: performance.capturedAt,
  }));
  const capturedAt = visible.length > 0
    ? Math.max(...visible.map((performance) => performance.capturedAt))
    : Math.max(...performances.map((performance) => performance.capturedAt));
  return {
    schemaVersion: 1,
    leaderboardPolicy: RMT_ARENA_LEADERBOARD_POLICY_V1,
    performancePolicy: structuredClone(first.policy),
    seasonId: first.entry.season.seasonId,
    streamId: first.entry.streamId,
    quoteAssetId: first.entry.quoteAssetId,
    startingNavQuoteAtomic: first.entry.startingNavQuoteAtomic,
    view: input.view,
    performances,
    rankedEntries,
    provisionalEntries,
    capturedAt,
  };
}

export function assertPaperArenaLeaderboardRecord(record: PaperArenaLeaderboardRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper arena leaderboard schema version");
  if (record.leaderboardPolicy !== RMT_ARENA_LEADERBOARD_POLICY_V1) fail("paper arena leaderboard policy is unsupported");
  assertNonEmpty(record.performancePolicy.policyVersion, "paper arena leaderboard performance policyVersion");
  assertPositiveSafeInteger(record.performancePolicy.minimumValuations, "paper arena leaderboard minimumValuations");
  if (!Number.isSafeInteger(record.performancePolicy.minimumElapsedMs) || record.performancePolicy.minimumElapsedMs < 0) fail("paper arena leaderboard minimumElapsedMs is invalid");
  assertNonEmpty(record.seasonId, "paper arena leaderboard seasonId");
  assertNonEmpty(record.streamId, "paper arena leaderboard streamId");
  assertNonEmpty(record.quoteAssetId, "paper arena leaderboard quoteAssetId");
  assertAtomic(record.startingNavQuoteAtomic, "paper arena leaderboard starting NAV");
  assertTimestamp(record.capturedAt, "paper arena leaderboard capturedAt");
  if (!Array.isArray(record.performances) || record.performances.length === 0) fail("paper arena leaderboard requires source performances");
  record.performances.forEach(assertPaperArenaPerformanceRecord);

  const ranks = new Set<number>();
  const identities = new Set<string>();
  for (const entry of record.rankedEntries) {
    assertPositiveSafeInteger(entry.rank, "paper arena leaderboard rank");
    if (entry.rank > record.rankedEntries.length || ranks.has(entry.rank)) fail("paper arena leaderboard ranks are not unique/contiguous");
    ranks.add(entry.rank);
    if (entry.participantType !== "AGENT" && entry.participantType !== "HUMAN") fail("paper arena ranked participant type is invalid");
    if (!viewAllows(record.view, entry.participantType)) fail("paper arena ranked entry is outside leaderboard view");
    assertNonEmpty(entry.participantId, "paper arena ranked participantId");
    const identity = `${entry.participantType}:${entry.participantId}`;
    if (identities.has(identity)) fail("paper arena leaderboard contains duplicate participant");
    identities.add(identity);
    assertHash(entry.performanceHash, "paper arena ranked performanceHash");
    assertSignedAtomic(entry.returnBpsExcludingExternalCosts, "paper arena ranked return bps");
    if (!Number.isSafeInteger(entry.maxDrawdownBps) || entry.maxDrawdownBps < 0 || entry.maxDrawdownBps > 10_000) fail("paper arena ranked drawdown is invalid");
    if (!Number.isSafeInteger(entry.fillCount) || entry.fillCount < 0) fail("paper arena ranked fillCount is invalid");
    assertAtomic(entry.latestLiquidationNavQuoteAtomic, "paper arena ranked latest NAV");
    assertTimestamp(entry.capturedAt, "paper arena ranked capturedAt");
  }
  for (let index = 0; index < record.rankedEntries.length; index += 1) {
    if (record.rankedEntries[index]!.rank !== index + 1) fail("paper arena leaderboard ranks are not contiguous");
  }
  for (const entry of record.provisionalEntries) {
    if (entry.participantType !== "AGENT" && entry.participantType !== "HUMAN") fail("paper arena provisional participant type is invalid");
    if (!viewAllows(record.view, entry.participantType)) fail("paper arena provisional entry is outside leaderboard view");
    assertNonEmpty(entry.participantId, "paper arena provisional participantId");
    const identity = `${entry.participantType}:${entry.participantId}`;
    if (identities.has(identity)) fail("paper arena leaderboard contains duplicate participant");
    identities.add(identity);
    assertHash(entry.performanceHash, "paper arena provisional performanceHash");
    if (entry.eligibilityReasons.length === 0) fail("paper arena provisional entry requires eligibility reasons");
    assertTimestamp(entry.capturedAt, "paper arena provisional capturedAt");
  }

  const rebuilt = derive({ performances: record.performances, view: record.view });
  const { leaderboardHash, ...payload } = record;
  if (hashCanonicalPayload(rebuilt) !== hashCanonicalPayload(payload)) fail("paper arena leaderboard payload is not correctly derived from source performances");
  assertHash(leaderboardHash, "paper arena leaderboardHash");
  if (leaderboardHash !== hashCanonicalPayload(payload)) fail("paper arena leaderboard hash mismatch");
}

export function buildPaperArenaLeaderboard(input: {
  performances: PaperArenaPerformanceRecord[];
  view?: PaperArenaLeaderboardView;
}): PaperArenaLeaderboardRecord {
  const payload = derive({ performances: input.performances, view: input.view ?? "OVERALL" });
  const record: PaperArenaLeaderboardRecord = { ...payload, leaderboardHash: hashCanonicalPayload(payload) };
  assertPaperArenaLeaderboardRecord(record);
  return record;
}
