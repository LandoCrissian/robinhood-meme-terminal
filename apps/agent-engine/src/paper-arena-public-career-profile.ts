import {
  hashCanonicalPayload,
  normalizeHumanParticipantId,
  type AgentPerformanceState,
} from "../../../packages/agent-core/src/index.ts";
import type { AgentStateStore } from "./persistence/store.ts";
import {
  assertPaperArenaCareerReputationRecord,
  type PaperArenaCareerReputationRecord,
} from "./paper-arena-career-reputation.ts";

export const RMT_ARENA_PUBLIC_CAREER_PROFILE_V1 = "RMT_ARENA_PUBLIC_CAREER_PROFILE_V1" as const;

export interface PaperArenaCareerReputationReader {
  read(input: { participantType: "AGENT" | "HUMAN"; participantId: string }): Promise<PaperArenaCareerReputationRecord>;
}

export interface PaperArenaPublicCareerProfile {
  schemaVersion: 1;
  apiVersion: typeof RMT_ARENA_PUBLIC_CAREER_PROFILE_V1;
  streamId: string;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
  identity: {
    displayName: string | null;
    agentLifecycleState: AgentPerformanceState | null;
    createdAt: number | null;
  };
  career: PaperArenaCareerReputationRecord["summary"];
  netReturnQuoteAtomicByAsset: Record<string, string>;
  seasons: PaperArenaCareerReputationRecord["seasons"];
  source: {
    archiveDigest: string;
    reputationHash: string;
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
  assertNonEmpty(participantId, "public career participantId");
  return type === "HUMAN" ? normalizeHumanParticipantId(participantId) : participantId.trim();
}

export function assertPaperArenaPublicCareerProfile(record: PaperArenaPublicCareerProfile): void {
  if (record.schemaVersion !== 1 || record.apiVersion !== RMT_ARENA_PUBLIC_CAREER_PROFILE_V1) fail("unsupported public Arena career-profile version");
  assertNonEmpty(record.streamId, "public career streamId");
  if (record.participantType !== "AGENT" && record.participantType !== "HUMAN") fail("public career participantType is invalid");
  if (canonicalParticipantId(record.participantType, record.participantId) !== record.participantId) fail("public career participantId is not canonical");
  if (record.participantType === "HUMAN") {
    if (record.identity.displayName !== null || record.identity.agentLifecycleState !== null || record.identity.createdAt !== null) {
      fail("public Human career profile exposed Agent identity fields");
    }
  } else {
    assertNonEmpty(record.identity.displayName ?? "", "public career Agent displayName");
    if (record.identity.agentLifecycleState === null) fail("public career Agent lifecycle state is missing");
    assertTimestampOrNull(record.identity.createdAt, "public career Agent createdAt");
  }
  if (!Number.isSafeInteger(record.career.seasonsCompleted) || record.career.seasonsCompleted <= 0) fail("public career seasonsCompleted must be positive");
  if (record.seasons.length !== record.career.seasonsCompleted) fail("public career season count differs from summary");
  assertHash(record.source.archiveDigest, "public career archiveDigest");
  assertHash(record.source.reputationHash, "public career reputationHash");
  assertHash(record.publicHash, "public career publicHash");
  const { publicHash, ...payload } = record;
  if (publicHash !== hashCanonicalPayload(payload)) fail("public Arena career-profile hash mismatch");
}

export class PaperArenaPublicCareerProfileService {
  private readonly careerReader: PaperArenaCareerReputationReader;
  private readonly stateStore: AgentStateStore;
  private readonly streamId: string;

  constructor(input: {
    careerReader: PaperArenaCareerReputationReader;
    stateStore: AgentStateStore;
    streamId: string;
  }) {
    assertNonEmpty(input.streamId, "public career streamId");
    this.careerReader = input.careerReader;
    this.stateStore = input.stateStore;
    this.streamId = input.streamId;
  }

  async read(input: { participantType: "AGENT" | "HUMAN"; participantId: string }): Promise<PaperArenaPublicCareerProfile> {
    const participantId = canonicalParticipantId(input.participantType, input.participantId);
    const career = await this.careerReader.read({ participantType: input.participantType, participantId });
    assertPaperArenaCareerReputationRecord(career);
    if (career.streamId !== this.streamId || career.participantType !== input.participantType || career.participantId !== participantId) {
      fail("public career source identity mismatch");
    }

    let displayName: string | null = null;
    let agentLifecycleState: AgentPerformanceState | null = null;
    let createdAt: number | null = null;
    if (input.participantType === "AGENT") {
      const state = await this.stateStore.load(this.streamId);
      if (!state) fail("public Agent career profile requires canonical engine state");
      const agent = state.snapshot.agents.find((candidate) => candidate.id === participantId);
      if (!agent) fail("Arena career Agent is absent from canonical engine state");
      displayName = agent.name;
      agentLifecycleState = agent.performanceState;
      createdAt = agent.createdAt;
    }

    const payload: Omit<PaperArenaPublicCareerProfile, "publicHash"> = {
      schemaVersion: 1,
      apiVersion: RMT_ARENA_PUBLIC_CAREER_PROFILE_V1,
      streamId: this.streamId,
      participantType: input.participantType,
      participantId,
      identity: { displayName, agentLifecycleState, createdAt },
      career: structuredClone(career.summary),
      netReturnQuoteAtomicByAsset: structuredClone(career.netReturnQuoteAtomicByAsset),
      seasons: career.seasons.map((season) => structuredClone(season)),
      source: { archiveDigest: career.archiveDigest, reputationHash: career.reputationHash },
    };
    const record: PaperArenaPublicCareerProfile = { ...payload, publicHash: hashCanonicalPayload(payload) };
    assertPaperArenaPublicCareerProfile(record);
    return record;
  }
}
