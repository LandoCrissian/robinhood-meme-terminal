import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaAuthoritativeMatchupRecord,
  type PaperArenaAuthoritativeMatchupRecord,
} from "./paper-arena-authoritative-matchup.ts";
import type { PaperArenaNetLeaderboardRecord } from "./paper-arena-net-leaderboard.ts";
import type { PaperArenaTeamSummary } from "./paper-arena-matchup.ts";

export const RMT_ARENA_PUBLIC_READ_MODEL_V1 = "RMT_ARENA_PUBLIC_V1" as const;

export interface PublicArenaRankedParticipant {
  rank: number;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  netReturnQuoteAtomic: string;
  netReturnBps: string;
  maxDrawdownBps: number;
  fillCount: number;
  latestNetLiquidationNavQuoteAtomic: string;
  capturedAt: number;
  performanceHash: string;
}

export interface PublicArenaProvisionalParticipant {
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  eligibilityReasons: string[];
  capturedAt: number;
  performanceHash: string;
}

export interface PublicArenaLeaderboard {
  ranked: PublicArenaRankedParticipant[];
  provisional: PublicArenaProvisionalParticipant[];
}

export interface PublicArenaTeamSummary {
  participantType: "AGENT" | "HUMAN";
  registeredCount: number;
  eligibleCount: number;
  provisionalCount: number;
  missingCount: number;
  sumNetReturnQuoteAtomic: string;
  meanNetReturnQuoteAtomic: string | null;
  topParticipantId: string | null;
}

export interface PaperArenaPublicReadModel {
  schemaVersion: 1;
  apiVersion: typeof RMT_ARENA_PUBLIC_READ_MODEL_V1;
  streamId: string;
  seasonId: string;
  quoteAssetId: string;
  startingNavQuoteAtomic: string;
  status: "PROVISIONAL" | "FINALIZABLE";
  winner: "AGENT" | "HUMAN" | "TIE" | null;
  capturedAt: number;
  roster: {
    totalCount: number;
    agentCount: number;
    humanCount: number;
    rosterHash: string;
  };
  agentTeam: PublicArenaTeamSummary;
  humanTeam: PublicArenaTeamSummary;
  overall: PublicArenaLeaderboard;
  agents: PublicArenaLeaderboard;
  humans: PublicArenaLeaderboard;
  source: {
    authoritativeSnapshotHash: string;
    latestPerformanceDigest: string;
    matchupHash: string;
  };
  publicHash: string;
}

export interface PaperArenaAuthoritativeMatchupReader {
  snapshot(seasonId: string): Promise<PaperArenaAuthoritativeMatchupRecord>;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function publicTeam(team: PaperArenaTeamSummary): PublicArenaTeamSummary {
  return {
    participantType: team.participantType,
    registeredCount: team.registeredCount,
    eligibleCount: team.eligibleCount,
    provisionalCount: team.provisionalCount,
    missingCount: team.missingParticipantIds.length,
    sumNetReturnQuoteAtomic: team.sumNetReturnQuoteAtomic,
    meanNetReturnQuoteAtomic: team.meanNetReturnQuoteAtomic,
    topParticipantId: team.topParticipantId,
  };
}

function publicLeaderboard(leaderboard: PaperArenaNetLeaderboardRecord | null): PublicArenaLeaderboard {
  if (!leaderboard) return { ranked: [], provisional: [] };
  return {
    ranked: leaderboard.rankedEntries.map((entry) => ({
      rank: entry.rank,
      participantType: entry.participantType,
      participantId: entry.participantId,
      netReturnQuoteAtomic: entry.netReturnQuoteAtomic,
      netReturnBps: entry.netReturnBps,
      maxDrawdownBps: entry.netMaxDrawdownBps,
      fillCount: entry.fillCount,
      latestNetLiquidationNavQuoteAtomic: entry.latestNetLiquidationNavQuoteAtomic,
      capturedAt: entry.capturedAt,
      performanceHash: entry.netPerformanceHash,
    })),
    provisional: leaderboard.provisionalEntries.map((entry) => ({
      participantType: entry.participantType,
      participantId: entry.participantId,
      eligibilityReasons: structuredClone(entry.eligibilityReasons),
      capturedAt: entry.capturedAt,
      performanceHash: entry.netPerformanceHash,
    })),
  };
}

function derive(source: PaperArenaAuthoritativeMatchupRecord): Omit<PaperArenaPublicReadModel, "publicHash"> {
  assertPaperArenaAuthoritativeMatchupRecord(source);
  const matchup = source.matchup;
  return {
    schemaVersion: 1,
    apiVersion: RMT_ARENA_PUBLIC_READ_MODEL_V1,
    streamId: source.streamId,
    seasonId: source.seasonId,
    quoteAssetId: source.roster.quoteAssetId,
    startingNavQuoteAtomic: source.roster.startingNavQuoteAtomic,
    status: matchup.status,
    winner: matchup.winner,
    capturedAt: matchup.capturedAt,
    roster: {
      totalCount: source.roster.entries.length,
      agentCount: source.roster.agentCount,
      humanCount: source.roster.humanCount,
      rosterHash: source.roster.rosterHash,
    },
    agentTeam: publicTeam(matchup.agentTeam),
    humanTeam: publicTeam(matchup.humanTeam),
    overall: publicLeaderboard(matchup.overallLeaderboard),
    agents: publicLeaderboard(matchup.agentLeaderboard),
    humans: publicLeaderboard(matchup.humanLeaderboard),
    source: {
      authoritativeSnapshotHash: source.snapshotHash,
      latestPerformanceDigest: source.latestPerformanceDigest,
      matchupHash: matchup.matchupHash,
    },
  };
}

export function assertPaperArenaPublicReadModel(record: PaperArenaPublicReadModel): void {
  if (record.schemaVersion !== 1 || record.apiVersion !== RMT_ARENA_PUBLIC_READ_MODEL_V1) fail("unsupported public Arena read-model version");
  assertNonEmpty(record.streamId, "public Arena streamId");
  assertNonEmpty(record.seasonId, "public Arena seasonId");
  assertNonEmpty(record.quoteAssetId, "public Arena quoteAssetId");
  assertHash(record.roster.rosterHash, "public Arena rosterHash");
  assertHash(record.source.authoritativeSnapshotHash, "public Arena authoritativeSnapshotHash");
  assertHash(record.source.latestPerformanceDigest, "public Arena latestPerformanceDigest");
  assertHash(record.source.matchupHash, "public Arena matchupHash");
  assertHash(record.publicHash, "public Arena publicHash");
  const { publicHash, ...payload } = record;
  if (publicHash !== hashCanonicalPayload(payload)) fail("public Arena read-model hash mismatch");
}

export function buildPaperArenaPublicReadModel(source: PaperArenaAuthoritativeMatchupRecord): PaperArenaPublicReadModel {
  const payload = derive(source);
  const record: PaperArenaPublicReadModel = { ...payload, publicHash: hashCanonicalPayload(payload) };
  assertPaperArenaPublicReadModel(record);
  return record;
}

export class PaperArenaPublicReadService {
  private readonly reader: PaperArenaAuthoritativeMatchupReader;

  constructor(reader: PaperArenaAuthoritativeMatchupReader) {
    this.reader = reader;
  }

  async read(seasonId: string): Promise<PaperArenaPublicReadModel> {
    assertNonEmpty(seasonId, "public Arena seasonId");
    const source = await this.reader.snapshot(seasonId);
    return buildPaperArenaPublicReadModel(source);
  }
}
