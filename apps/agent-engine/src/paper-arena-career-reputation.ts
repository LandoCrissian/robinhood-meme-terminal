import {
  hashCanonicalPayload,
  normalizeHumanParticipantId,
} from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaFinalizationArchiveStore } from "./paper-arena-finalization-archive.ts";
import {
  assertPaperArenaSeasonFinalizationRecord,
  type PaperArenaSeasonFinalizationRecord,
} from "./paper-arena-season-finalization.ts";

export type PaperArenaCareerTeamOutcome = "WIN" | "LOSS" | "TIE";

export interface PaperArenaCareerSeasonRecord {
  seasonId: string;
  seasonEndsAt: number;
  finalizedAt: number;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  teamWinner: "AGENT" | "HUMAN" | "TIE";
  teamOutcome: PaperArenaCareerTeamOutcome;
  overallRank: number;
  divisionRank: number;
  quoteAssetId: string;
  netReturnQuoteAtomic: string;
  netReturnBps: string;
  maxDrawdownBps: number;
  fillCount: number;
  finalizationHash: string;
  performanceHash: string;
}

export interface PaperArenaCareerReputationRecord {
  schemaVersion: 1;
  streamId: string;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  summary: {
    seasonsCompleted: number;
    teamWins: number;
    teamLosses: number;
    teamTies: number;
    divisionWins: number;
    overallWins: number;
    podiumFinishes: number;
    bestOverallRank: number;
    currentTeamWinStreak: number;
    longestTeamWinStreak: number;
    totalFills: number;
    sumNetReturnBps: string;
    worstSeasonDrawdownBps: number;
    latestSeasonId: string;
  };
  netReturnQuoteAtomicByAsset: Record<string, string>;
  seasons: PaperArenaCareerSeasonRecord[];
  archiveDigest: string;
  reputationHash: string;
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

function assertSignedAtomic(value: string, field: string): void {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") fail(`${field} must be a canonical signed integer string`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function canonicalParticipantId(type: "AGENT" | "HUMAN", participantId: string): string {
  assertNonEmpty(participantId, "Arena career participantId");
  return type === "HUMAN" ? normalizeHumanParticipantId(participantId) : participantId.trim();
}

function identity(type: "AGENT" | "HUMAN", participantId: string): string {
  return `${type}:${participantId}`;
}

function rankFor(finalization: PaperArenaSeasonFinalizationRecord, type: "AGENT" | "HUMAN", participantId: string): { overall: number; division: number } {
  const overall = finalization.matchup.overallLeaderboard?.rankedEntries.find((entry) => (
    entry.participantType === type && entry.participantId === participantId
  ));
  const divisionBoard = type === "AGENT" ? finalization.matchup.agentLeaderboard : finalization.matchup.humanLeaderboard;
  const division = divisionBoard?.rankedEntries.find((entry) => entry.participantId === participantId);
  if (!overall || !division) fail("Arena career finalized participant is missing ranked leaderboard evidence");
  return { overall: overall.rank, division: division.rank };
}

function seasonRecord(finalization: PaperArenaSeasonFinalizationRecord, type: "AGENT" | "HUMAN", participantId: string): PaperArenaCareerSeasonRecord | null {
  assertPaperArenaSeasonFinalizationRecord(finalization);
  const rosterEntry = finalization.roster.entries.find((entry) => entry.participantType === type && entry.participantId === participantId);
  if (!rosterEntry) return null;
  const performances = finalization.finalPerformances.filter((performance) => {
    const entry = performance.basePerformance.entry;
    return entry.participantType === type && entry.participantId === participantId;
  });
  if (performances.length !== 1) fail("Arena career finalized participant requires exactly one net-performance record");
  const performance = performances[0]!;
  if (performance.eligibility !== "ELIGIBLE") fail("Arena career finalization contains non-eligible participant");
  const ranks = rankFor(finalization, type, participantId);
  const teamOutcome: PaperArenaCareerTeamOutcome = finalization.winner === "TIE"
    ? "TIE"
    : finalization.winner === type ? "WIN" : "LOSS";
  return {
    seasonId: finalization.seasonId,
    seasonEndsAt: finalization.seasonEndsAt,
    finalizedAt: finalization.finalizedAt,
    participantType: type,
    participantId,
    teamWinner: finalization.winner,
    teamOutcome,
    overallRank: ranks.overall,
    divisionRank: ranks.division,
    quoteAssetId: finalization.roster.quoteAssetId,
    netReturnQuoteAtomic: performance.metrics.netReturnQuoteAtomic,
    netReturnBps: performance.metrics.netReturnBps,
    maxDrawdownBps: performance.metrics.netMaxDrawdownBps,
    fillCount: performance.metrics.fillCount,
    finalizationHash: finalization.finalizationHash,
    performanceHash: performance.netPerformanceHash,
  };
}

function archiveDigest(finalizations: PaperArenaSeasonFinalizationRecord[]): string {
  return hashCanonicalPayload(finalizations.map((finalization) => ({
    seasonId: finalization.seasonId,
    seasonEndsAt: finalization.seasonEndsAt,
    finalizationHash: finalization.finalizationHash,
  })));
}

function deriveSummary(seasons: PaperArenaCareerSeasonRecord[]) {
  if (seasons.length === 0) fail("Arena career reputation requires at least one finalized season");
  let currentTeamWinStreak = 0;
  let longestTeamWinStreak = 0;
  let runningStreak = 0;
  let sumBps = 0n;
  let totalFills = 0;
  let worstDrawdown = 0;
  let bestRank = Number.MAX_SAFE_INTEGER;
  const byAsset = new Map<string, bigint>();
  for (const season of seasons) {
    sumBps += BigInt(season.netReturnBps);
    totalFills += season.fillCount;
    if (season.maxDrawdownBps > worstDrawdown) worstDrawdown = season.maxDrawdownBps;
    if (season.overallRank < bestRank) bestRank = season.overallRank;
    byAsset.set(season.quoteAssetId, (byAsset.get(season.quoteAssetId) ?? 0n) + BigInt(season.netReturnQuoteAtomic));
    if (season.teamOutcome === "WIN") {
      runningStreak += 1;
      if (runningStreak > longestTeamWinStreak) longestTeamWinStreak = runningStreak;
    } else {
      runningStreak = 0;
    }
  }
  currentTeamWinStreak = runningStreak;
  return {
    summary: {
      seasonsCompleted: seasons.length,
      teamWins: seasons.filter((season) => season.teamOutcome === "WIN").length,
      teamLosses: seasons.filter((season) => season.teamOutcome === "LOSS").length,
      teamTies: seasons.filter((season) => season.teamOutcome === "TIE").length,
      divisionWins: seasons.filter((season) => season.divisionRank === 1).length,
      overallWins: seasons.filter((season) => season.overallRank === 1).length,
      podiumFinishes: seasons.filter((season) => season.overallRank <= 3).length,
      bestOverallRank: bestRank,
      currentTeamWinStreak,
      longestTeamWinStreak,
      totalFills,
      sumNetReturnBps: sumBps.toString(),
      worstSeasonDrawdownBps: worstDrawdown,
      latestSeasonId: seasons[seasons.length - 1]!.seasonId,
    },
    netReturnQuoteAtomicByAsset: Object.fromEntries([...byAsset.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([assetId, value]) => [assetId, value.toString()])),
  };
}

function assertSeasonRecord(record: PaperArenaCareerSeasonRecord, type: "AGENT" | "HUMAN", participantId: string): void {
  assertNonEmpty(record.seasonId, "Arena career seasonId");
  assertNonNegativeSafeInteger(record.seasonEndsAt, "Arena career seasonEndsAt");
  assertNonNegativeSafeInteger(record.finalizedAt, "Arena career finalizedAt");
  if (record.finalizedAt < record.seasonEndsAt) fail("Arena career season finalized before ending");
  if (record.participantType !== type || record.participantId !== participantId) fail("Arena career season participant mismatch");
  if (record.teamWinner !== "AGENT" && record.teamWinner !== "HUMAN" && record.teamWinner !== "TIE") fail("Arena career team winner is invalid");
  if (record.teamOutcome !== "WIN" && record.teamOutcome !== "LOSS" && record.teamOutcome !== "TIE") fail("Arena career team outcome is invalid");
  assertPositiveSafeInteger(record.overallRank, "Arena career overallRank");
  assertPositiveSafeInteger(record.divisionRank, "Arena career divisionRank");
  assertNonEmpty(record.quoteAssetId, "Arena career quoteAssetId");
  assertSignedAtomic(record.netReturnQuoteAtomic, "Arena career net return quote amount");
  assertSignedAtomic(record.netReturnBps, "Arena career net return bps");
  assertNonNegativeSafeInteger(record.maxDrawdownBps, "Arena career maxDrawdownBps");
  if (record.maxDrawdownBps > 10_000) fail("Arena career maxDrawdownBps exceeds 10000");
  assertNonNegativeSafeInteger(record.fillCount, "Arena career fillCount");
  assertHash(record.finalizationHash, "Arena career finalizationHash");
  assertHash(record.performanceHash, "Arena career performanceHash");
}

export function assertPaperArenaCareerReputationRecord(record: PaperArenaCareerReputationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported Arena career reputation schema version");
  assertNonEmpty(record.streamId, "Arena career streamId");
  if (record.participantType !== "AGENT" && record.participantType !== "HUMAN") fail("Arena career participantType is invalid");
  if (canonicalParticipantId(record.participantType, record.participantId) !== record.participantId) fail("Arena career participantId is not canonical");
  if (record.seasons.length === 0) fail("Arena career reputation requires finalized season history");
  let previousEnd = -1;
  const seasonIds = new Set<string>();
  for (const season of record.seasons) {
    assertSeasonRecord(season, record.participantType, record.participantId);
    if (seasonIds.has(season.seasonId)) fail("Arena career history contains duplicate seasonId");
    seasonIds.add(season.seasonId);
    if (season.seasonEndsAt < previousEnd) fail("Arena career history is not chronological");
    previousEnd = season.seasonEndsAt;
  }
  const derived = deriveSummary(record.seasons);
  if (hashCanonicalPayload(derived.summary) !== hashCanonicalPayload(record.summary)) fail("Arena career summary is not correctly derived from season history");
  if (hashCanonicalPayload(derived.netReturnQuoteAtomicByAsset) !== hashCanonicalPayload(record.netReturnQuoteAtomicByAsset)) {
    fail("Arena career quote-asset returns are not correctly derived from season history");
  }
  assertHash(record.archiveDigest, "Arena career archiveDigest");
  assertHash(record.reputationHash, "Arena career reputationHash");
  const { reputationHash, ...payload } = record;
  if (reputationHash !== hashCanonicalPayload(payload)) fail("Arena career reputation hash mismatch");
}

export class PaperArenaCareerReputationService {
  private readonly archive: PaperArenaFinalizationArchiveStore;
  private readonly streamId: string;

  constructor(input: { archive: PaperArenaFinalizationArchiveStore; streamId: string }) {
    assertNonEmpty(input.streamId, "Arena career streamId");
    this.archive = input.archive;
    this.streamId = input.streamId;
  }

  async read(input: { participantType: "AGENT" | "HUMAN"; participantId: string }): Promise<PaperArenaCareerReputationRecord> {
    const participantId = canonicalParticipantId(input.participantType, input.participantId);
    const finalizations = await this.archive.list(this.streamId);
    finalizations.forEach(assertPaperArenaSeasonFinalizationRecord);
    const seasons = finalizations
      .map((finalization) => seasonRecord(finalization, input.participantType, participantId))
      .filter((season): season is PaperArenaCareerSeasonRecord => Boolean(season))
      .sort((left, right) => left.seasonEndsAt - right.seasonEndsAt || left.seasonId.localeCompare(right.seasonId));
    if (seasons.length === 0) fail("Arena participant has no finalized career history");
    const relevantFinalizations = finalizations.filter((finalization) => (
      finalization.roster.entries.some((entry) => entry.participantType === input.participantType && entry.participantId === participantId)
    ));
    const derived = deriveSummary(seasons);
    const payload: Omit<PaperArenaCareerReputationRecord, "reputationHash"> = {
      schemaVersion: 1,
      streamId: this.streamId,
      participantType: input.participantType,
      participantId,
      summary: derived.summary,
      netReturnQuoteAtomicByAsset: derived.netReturnQuoteAtomicByAsset,
      seasons,
      archiveDigest: archiveDigest(relevantFinalizations),
    };
    const record: PaperArenaCareerReputationRecord = { ...payload, reputationHash: hashCanonicalPayload(payload) };
    assertPaperArenaCareerReputationRecord(record);
    return record;
  }
}
