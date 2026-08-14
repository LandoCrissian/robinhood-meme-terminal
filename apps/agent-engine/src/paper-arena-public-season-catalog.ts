import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type { AgentStateStore } from "./persistence/store.ts";
import type { PaperArenaEntryStore } from "./paper-arena-entry-store.ts";
import {
  assertPaperArenaSeasonFinalizationRecord,
  type PaperArenaSeasonFinalizationStore,
} from "./paper-arena-season-finalization.ts";

export const RMT_ARENA_PUBLIC_SEASON_CATALOG_V1 = "RMT_ARENA_PUBLIC_SEASON_CATALOG_V1" as const;
export type PaperArenaPublicSeasonStatus = "UPCOMING" | "ACTIVE" | "ENDED_UNFINALIZED" | "FINALIZED";

export interface PaperArenaPublicSeasonSummary {
  seasonId: string;
  name: string;
  startsAt: number;
  endsAt: number | null;
  status: PaperArenaPublicSeasonStatus;
  participants: {
    totalCount: number;
    agentCount: number;
    humanCount: number;
    participantSetHash: string;
  };
  finalResult: {
    winner: "AGENT" | "HUMAN" | "TIE";
    finalizedAt: number;
    finalizationHash: string;
  } | null;
}

export interface PaperArenaPublicSeasonCatalog {
  schemaVersion: 1;
  apiVersion: typeof RMT_ARENA_PUBLIC_SEASON_CATALOG_V1;
  streamId: string;
  observedAt: number;
  seasons: PaperArenaPublicSeasonSummary[];
  catalogHash: string;
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

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function participantSet(entries: Array<{ participantType: "AGENT" | "HUMAN"; participantId: string; entryHash: string }>) {
  return entries
    .map((entry) => ({ participantType: entry.participantType, participantId: entry.participantId, entryHash: entry.entryHash }))
    .sort((left, right) => left.participantType.localeCompare(right.participantType) || left.participantId.localeCompare(right.participantId));
}

function participantSetHash(entries: Array<{ participantType: "AGENT" | "HUMAN"; participantId: string; entryHash: string }>): string {
  return hashCanonicalPayload(participantSet(entries));
}

function derivedStatus(input: { startsAt: number; endsAt?: number; finalized: boolean; observedAt: number }): PaperArenaPublicSeasonStatus {
  if (input.finalized) return "FINALIZED";
  if (input.observedAt < input.startsAt) return "UPCOMING";
  if (input.endsAt !== undefined && input.observedAt > input.endsAt) return "ENDED_UNFINALIZED";
  return "ACTIVE";
}

export function assertPaperArenaPublicSeasonCatalog(record: PaperArenaPublicSeasonCatalog): void {
  if (record.schemaVersion !== 1 || record.apiVersion !== RMT_ARENA_PUBLIC_SEASON_CATALOG_V1) fail("unsupported public Arena season-catalog version");
  assertNonEmpty(record.streamId, "public Arena season catalog streamId");
  assertTimestamp(record.observedAt, "public Arena season catalog observedAt");
  const ids = new Set<string>();
  let previousStartsAt = Number.MAX_SAFE_INTEGER;
  for (const season of record.seasons) {
    assertNonEmpty(season.seasonId, "public Arena seasonId");
    assertNonEmpty(season.name, "public Arena season name");
    if (ids.has(season.seasonId)) fail("public Arena season catalog contains duplicate seasonId");
    ids.add(season.seasonId);
    assertTimestamp(season.startsAt, "public Arena season startsAt");
    if (season.endsAt !== null) {
      assertTimestamp(season.endsAt, "public Arena season endsAt");
      if (season.endsAt <= season.startsAt) fail("public Arena season endsAt must be after startsAt");
    }
    if (season.startsAt > previousStartsAt) fail("public Arena season catalog is not sorted newest-first");
    previousStartsAt = season.startsAt;
    if (!["UPCOMING", "ACTIVE", "ENDED_UNFINALIZED", "FINALIZED"].includes(season.status)) fail("public Arena season status is invalid");
    assertNonNegativeSafeInteger(season.participants.totalCount, "public Arena participant totalCount");
    assertNonNegativeSafeInteger(season.participants.agentCount, "public Arena participant agentCount");
    assertNonNegativeSafeInteger(season.participants.humanCount, "public Arena participant humanCount");
    if (season.participants.totalCount !== season.participants.agentCount + season.participants.humanCount) fail("public Arena participant counts do not add up");
    assertHash(season.participants.participantSetHash, "public Arena participantSetHash");
    if (season.status === "FINALIZED") {
      if (!season.finalResult) fail("finalized public Arena season is missing final result");
      assertTimestamp(season.finalResult.finalizedAt, "public Arena finalizedAt");
      assertHash(season.finalResult.finalizationHash, "public Arena finalizationHash");
    } else if (season.finalResult !== null) {
      fail("non-finalized public Arena season exposed final result");
    }
  }
  assertHash(record.catalogHash, "public Arena season catalogHash");
  const { catalogHash, ...payload } = record;
  if (catalogHash !== hashCanonicalPayload(payload)) fail("public Arena season-catalog hash mismatch");
}

export class PaperArenaPublicSeasonCatalogService {
  private readonly stateStore: AgentStateStore;
  private readonly entryStore: PaperArenaEntryStore;
  private readonly finalizationStore: PaperArenaSeasonFinalizationStore;
  private readonly streamId: string;

  constructor(input: {
    stateStore: AgentStateStore;
    entryStore: PaperArenaEntryStore;
    finalizationStore: PaperArenaSeasonFinalizationStore;
    streamId: string;
  }) {
    assertNonEmpty(input.streamId, "public Arena season catalog streamId");
    this.stateStore = input.stateStore;
    this.entryStore = input.entryStore;
    this.finalizationStore = input.finalizationStore;
    this.streamId = input.streamId;
  }

  async read(observedAt = Date.now()): Promise<PaperArenaPublicSeasonCatalog> {
    assertTimestamp(observedAt, "public Arena season catalog observedAt");
    const state = await this.stateStore.load(this.streamId);
    if (!state) fail("public Arena season catalog requires canonical engine state");
    const seasons: PaperArenaPublicSeasonSummary[] = [];
    for (const season of state.snapshot.seasons) {
      const entries = await this.entryStore.listSeason(this.streamId, season.seasonId);
      const set = participantSet(entries);
      const finalization = await this.finalizationStore.get(this.streamId, season.seasonId);
      if (finalization) {
        assertPaperArenaSeasonFinalizationRecord(finalization);
        if (finalization.seasonEndsAt !== season.endsAt) fail("public Arena finalized season timing differs from canonical season");
        const finalizedSet = participantSet(finalization.roster.entries);
        if (hashCanonicalPayload(finalizedSet) !== hashCanonicalPayload(set)) fail("public Arena finalized roster differs from current append-only roster");
      }
      seasons.push({
        seasonId: season.seasonId,
        name: season.name,
        startsAt: season.startsAt,
        endsAt: season.endsAt ?? null,
        status: derivedStatus({ startsAt: season.startsAt, endsAt: season.endsAt, finalized: Boolean(finalization), observedAt }),
        participants: {
          totalCount: entries.length,
          agentCount: entries.filter((entry) => entry.participantType === "AGENT").length,
          humanCount: entries.filter((entry) => entry.participantType === "HUMAN").length,
          participantSetHash: participantSetHash(entries),
        },
        finalResult: finalization ? {
          winner: finalization.winner,
          finalizedAt: finalization.finalizedAt,
          finalizationHash: finalization.finalizationHash,
        } : null,
      });
    }
    seasons.sort((left, right) => right.startsAt - left.startsAt || left.seasonId.localeCompare(right.seasonId));
    const payload: Omit<PaperArenaPublicSeasonCatalog, "catalogHash"> = {
      schemaVersion: 1,
      apiVersion: RMT_ARENA_PUBLIC_SEASON_CATALOG_V1,
      streamId: this.streamId,
      observedAt,
      seasons,
    };
    const record: PaperArenaPublicSeasonCatalog = { ...payload, catalogHash: hashCanonicalPayload(payload) };
    assertPaperArenaPublicSeasonCatalog(record);
    return record;
  }
}
