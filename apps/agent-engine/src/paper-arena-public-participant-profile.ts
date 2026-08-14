import {
  hashCanonicalPayload,
  normalizeHumanParticipantId,
  type AgentPerformanceState,
} from "../../../packages/agent-core/src/index.ts";
import type { AgentStateStore } from "./persistence/store.ts";
import {
  assertPaperArenaAuthoritativeMatchupRecord,
  type PaperArenaAuthoritativeMatchupRecord,
} from "./paper-arena-authoritative-matchup.ts";
import {
  buildPaperArenaPublicReadModel,
  type PaperArenaAuthoritativeMatchupReader,
  type PublicArenaProvisionalParticipant,
  type PublicArenaRankedParticipant,
} from "./paper-arena-public-read-model.ts";

export const RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1 = "RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1" as const;

export type PublicArenaParticipantStatus = "RANKED" | "PROVISIONAL" | "AWAITING_PERFORMANCE";

export interface PaperArenaPublicParticipantProfile {
  schemaVersion: 1;
  apiVersion: typeof RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1;
  streamId: string;
  seasonId: string;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  identity: {
    displayName: string | null;
    agentLifecycleState: AgentPerformanceState | null;
    createdAt: number | null;
  };
  competition: {
    status: PublicArenaParticipantStatus;
    rank: number | null;
    netReturnQuoteAtomic: string | null;
    netReturnBps: string | null;
    maxDrawdownBps: number | null;
    fillCount: number | null;
    latestNetLiquidationNavQuoteAtomic: string | null;
    capturedAt: number | null;
    eligibilityReasons: string[];
    matchupStatus: "PROVISIONAL" | "FINALIZABLE";
    matchupWinner: "AGENT" | "HUMAN" | "TIE" | null;
  };
  source: {
    rosterHash: string;
    matchupHash: string;
    authoritativeSnapshotHash: string;
    performanceHash: string | null;
  };
  publicHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function assertTimestampOrNull(value: number | null, field: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail(`${field} must be null or a non-negative safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function canonicalParticipantId(type: "AGENT" | "HUMAN", participantId: string): string {
  assertNonEmpty(participantId, "public Arena participantId");
  return type === "HUMAN" ? normalizeHumanParticipantId(participantId) : participantId.trim();
}

function rankedFor(
  source: PaperArenaAuthoritativeMatchupRecord,
  type: "AGENT" | "HUMAN",
  participantId: string,
): PublicArenaRankedParticipant | null {
  const publicArena = buildPaperArenaPublicReadModel(source);
  const leaderboard = type === "AGENT" ? publicArena.agents : publicArena.humans;
  return leaderboard.ranked.find((entry) => entry.participantId === participantId) ?? null;
}

function provisionalFor(
  source: PaperArenaAuthoritativeMatchupRecord,
  type: "AGENT" | "HUMAN",
  participantId: string,
): PublicArenaProvisionalParticipant | null {
  const publicArena = buildPaperArenaPublicReadModel(source);
  const leaderboard = type === "AGENT" ? publicArena.agents : publicArena.humans;
  return leaderboard.provisional.find((entry) => entry.participantId === participantId) ?? null;
}

function deriveCompetition(input: {
  source: PaperArenaAuthoritativeMatchupRecord;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
}) {
  const ranked = rankedFor(input.source, input.participantType, input.participantId);
  const provisional = provisionalFor(input.source, input.participantType, input.participantId);
  if (ranked && provisional) fail("public Arena participant cannot be both ranked and provisional");
  if (ranked) {
    return {
      status: "RANKED" as const,
      rank: ranked.rank,
      netReturnQuoteAtomic: ranked.netReturnQuoteAtomic,
      netReturnBps: ranked.netReturnBps,
      maxDrawdownBps: ranked.maxDrawdownBps,
      fillCount: ranked.fillCount,
      latestNetLiquidationNavQuoteAtomic: ranked.latestNetLiquidationNavQuoteAtomic,
      capturedAt: ranked.capturedAt,
      eligibilityReasons: [] as string[],
      performanceHash: ranked.performanceHash,
    };
  }
  if (provisional) {
    return {
      status: "PROVISIONAL" as const,
      rank: null,
      netReturnQuoteAtomic: null,
      netReturnBps: null,
      maxDrawdownBps: null,
      fillCount: null,
      latestNetLiquidationNavQuoteAtomic: null,
      capturedAt: provisional.capturedAt,
      eligibilityReasons: structuredClone(provisional.eligibilityReasons),
      performanceHash: provisional.performanceHash,
    };
  }
  return {
    status: "AWAITING_PERFORMANCE" as const,
    rank: null,
    netReturnQuoteAtomic: null,
    netReturnBps: null,
    maxDrawdownBps: null,
    fillCount: null,
    latestNetLiquidationNavQuoteAtomic: null,
    capturedAt: null,
    eligibilityReasons: [] as string[],
    performanceHash: null,
  };
}

export function assertPaperArenaPublicParticipantProfile(record: PaperArenaPublicParticipantProfile): void {
  if (record.schemaVersion !== 1 || record.apiVersion !== RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1) fail("unsupported public Arena participant-profile version");
  assertNonEmpty(record.streamId, "public Arena profile streamId");
  assertNonEmpty(record.seasonId, "public Arena profile seasonId");
  if (record.participantType !== "AGENT" && record.participantType !== "HUMAN") fail("public Arena profile participantType is invalid");
  if (canonicalParticipantId(record.participantType, record.participantId) !== record.participantId) fail("public Arena profile participantId is not canonical");
  if (record.participantType === "HUMAN") {
    if (record.identity.displayName !== null || record.identity.agentLifecycleState !== null || record.identity.createdAt !== null) {
      fail("public Human Arena profile exposed Agent identity fields");
    }
  } else {
    assertNonEmpty(record.identity.displayName ?? "", "public Agent displayName");
    if (record.identity.agentLifecycleState === null) fail("public Agent profile is missing lifecycle state");
    assertTimestampOrNull(record.identity.createdAt, "public Agent createdAt");
  }
  if (record.competition.status !== "RANKED" && record.competition.status !== "PROVISIONAL" && record.competition.status !== "AWAITING_PERFORMANCE") {
    fail("public Arena participant status is invalid");
  }
  if (record.competition.matchupStatus !== "PROVISIONAL" && record.competition.matchupStatus !== "FINALIZABLE") fail("public Arena matchup status is invalid");
  assertHash(record.source.rosterHash, "public Arena profile rosterHash");
  assertHash(record.source.matchupHash, "public Arena profile matchupHash");
  assertHash(record.source.authoritativeSnapshotHash, "public Arena profile authoritativeSnapshotHash");
  if (record.source.performanceHash !== null) assertHash(record.source.performanceHash, "public Arena profile performanceHash");
  assertHash(record.publicHash, "public Arena participant profile publicHash");
  const { publicHash, ...payload } = record;
  if (publicHash !== hashCanonicalPayload(payload)) fail("public Arena participant-profile hash mismatch");
}

export class PaperArenaPublicParticipantProfileService {
  private readonly reader: PaperArenaAuthoritativeMatchupReader;
  private readonly stateStore: AgentStateStore;
  private readonly streamId: string;

  constructor(input: {
    reader: PaperArenaAuthoritativeMatchupReader;
    stateStore: AgentStateStore;
    streamId: string;
  }) {
    assertNonEmpty(input.streamId, "public Arena profile streamId");
    this.reader = input.reader;
    this.stateStore = input.stateStore;
    this.streamId = input.streamId;
  }

  async read(input: {
    seasonId: string;
    participantType: "AGENT" | "HUMAN";
    participantId: string;
  }): Promise<PaperArenaPublicParticipantProfile> {
    assertNonEmpty(input.seasonId, "public Arena profile seasonId");
    const participantId = canonicalParticipantId(input.participantType, input.participantId);
    const source = await this.reader.snapshot(input.seasonId);
    assertPaperArenaAuthoritativeMatchupRecord(source);
    if (source.streamId !== this.streamId || source.seasonId !== input.seasonId) fail("public Arena profile source identity mismatch");
    const rosterEntry = source.roster.entries.find((entry) => entry.participantType === input.participantType && entry.participantId === participantId);
    if (!rosterEntry) fail("Arena participant is not registered for this season");

    let displayName: string | null = null;
    let agentLifecycleState: AgentPerformanceState | null = null;
    let createdAt: number | null = null;
    if (input.participantType === "AGENT") {
      const state = await this.stateStore.load(this.streamId);
      if (!state) fail("public Agent profile requires canonical engine state");
      const agent = state.snapshot.agents.find((candidate) => candidate.id === participantId);
      if (!agent) fail("registered Arena Agent is absent from canonical engine state");
      displayName = agent.name;
      agentLifecycleState = agent.performanceState;
      createdAt = agent.createdAt;
    }

    const competition = deriveCompetition({ source, participantType: input.participantType, participantId });
    const payload: Omit<PaperArenaPublicParticipantProfile, "publicHash"> = {
      schemaVersion: 1,
      apiVersion: RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1,
      streamId: this.streamId,
      seasonId: input.seasonId,
      participantType: input.participantType,
      participantId,
      identity: { displayName, agentLifecycleState, createdAt },
      competition: {
        status: competition.status,
        rank: competition.rank,
        netReturnQuoteAtomic: competition.netReturnQuoteAtomic,
        netReturnBps: competition.netReturnBps,
        maxDrawdownBps: competition.maxDrawdownBps,
        fillCount: competition.fillCount,
        latestNetLiquidationNavQuoteAtomic: competition.latestNetLiquidationNavQuoteAtomic,
        capturedAt: competition.capturedAt,
        eligibilityReasons: competition.eligibilityReasons,
        matchupStatus: source.matchup.status,
        matchupWinner: source.matchup.winner,
      },
      source: {
        rosterHash: source.roster.rosterHash,
        matchupHash: source.matchup.matchupHash,
        authoritativeSnapshotHash: source.snapshotHash,
        performanceHash: competition.performanceHash,
      },
    };
    const record: PaperArenaPublicParticipantProfile = { ...payload, publicHash: hashCanonicalPayload(payload) };
    assertPaperArenaPublicParticipantProfile(record);
    return record;
  }
}
