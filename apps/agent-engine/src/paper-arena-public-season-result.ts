import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaAuthoritativeMatchupRecord } from "./paper-arena-authoritative-matchup.ts";
import {
  buildPaperArenaPublicReadModel,
  assertPaperArenaPublicReadModel,
  type PaperArenaPublicReadModel,
} from "./paper-arena-public-read-model.ts";
import {
  assertPaperArenaSeasonFinalizationRecord,
  type PaperArenaSeasonFinalizationRecord,
  type PaperArenaSeasonFinalizationStore,
} from "./paper-arena-season-finalization.ts";

export const RMT_ARENA_PUBLIC_SEASON_RESULT_V1 = "RMT_ARENA_PUBLIC_SEASON_RESULT_V1" as const;

export interface PaperArenaPublicSeasonResult {
  schemaVersion: 1;
  apiVersion: typeof RMT_ARENA_PUBLIC_SEASON_RESULT_V1;
  streamId: string;
  seasonId: string;
  seasonEndsAt: number;
  finalizedAt: number;
  winner: "AGENT" | "HUMAN" | "TIE";
  arena: PaperArenaPublicReadModel;
  source: {
    finalizationHash: string;
    cutoffPerformanceDigest: string;
    rosterHash: string;
    matchupHash: string;
  };
  publicHash: string;
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

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function authoritativeSource(finalization: PaperArenaSeasonFinalizationRecord): PaperArenaAuthoritativeMatchupRecord {
  assertPaperArenaSeasonFinalizationRecord(finalization);
  const payload: Omit<PaperArenaAuthoritativeMatchupRecord, "snapshotHash"> = {
    schemaVersion: 1,
    streamId: finalization.streamId,
    seasonId: finalization.seasonId,
    roster: structuredClone(finalization.roster),
    latestNetPerformances: finalization.finalPerformances.map((performance) => structuredClone(performance)),
    latestPerformanceDigest: finalization.cutoffPerformanceDigest,
    matchup: structuredClone(finalization.matchup),
  };
  return { ...payload, snapshotHash: hashCanonicalPayload(payload) };
}

function derive(finalization: PaperArenaSeasonFinalizationRecord): Omit<PaperArenaPublicSeasonResult, "publicHash"> {
  assertPaperArenaSeasonFinalizationRecord(finalization);
  const arena = buildPaperArenaPublicReadModel(authoritativeSource(finalization));
  if (arena.status !== "FINALIZABLE" || arena.winner !== finalization.winner) fail("public Arena final result does not match finalized matchup");
  return {
    schemaVersion: 1,
    apiVersion: RMT_ARENA_PUBLIC_SEASON_RESULT_V1,
    streamId: finalization.streamId,
    seasonId: finalization.seasonId,
    seasonEndsAt: finalization.seasonEndsAt,
    finalizedAt: finalization.finalizedAt,
    winner: finalization.winner,
    arena,
    source: {
      finalizationHash: finalization.finalizationHash,
      cutoffPerformanceDigest: finalization.cutoffPerformanceDigest,
      rosterHash: finalization.roster.rosterHash,
      matchupHash: finalization.matchup.matchupHash,
    },
  };
}

export function assertPaperArenaPublicSeasonResult(record: PaperArenaPublicSeasonResult): void {
  if (record.schemaVersion !== 1 || record.apiVersion !== RMT_ARENA_PUBLIC_SEASON_RESULT_V1) fail("unsupported public Arena season-result version");
  assertNonEmpty(record.streamId, "public Arena season result streamId");
  assertNonEmpty(record.seasonId, "public Arena season result seasonId");
  assertTimestamp(record.seasonEndsAt, "public Arena seasonEndsAt");
  assertTimestamp(record.finalizedAt, "public Arena finalizedAt");
  if (record.finalizedAt < record.seasonEndsAt) fail("public Arena season result finalized before season end");
  if (record.winner !== "AGENT" && record.winner !== "HUMAN" && record.winner !== "TIE") fail("public Arena season result winner is invalid");
  assertPaperArenaPublicReadModel(record.arena);
  if (record.arena.streamId !== record.streamId || record.arena.seasonId !== record.seasonId || record.arena.winner !== record.winner) {
    fail("public Arena season result identity/winner mismatch");
  }
  assertHash(record.source.finalizationHash, "public Arena finalizationHash");
  assertHash(record.source.cutoffPerformanceDigest, "public Arena cutoffPerformanceDigest");
  assertHash(record.source.rosterHash, "public Arena rosterHash");
  assertHash(record.source.matchupHash, "public Arena matchupHash");
  assertHash(record.publicHash, "public Arena season result publicHash");
  const { publicHash, ...payload } = record;
  if (publicHash !== hashCanonicalPayload(payload)) fail("public Arena season-result hash mismatch");
}

export function buildPaperArenaPublicSeasonResult(finalization: PaperArenaSeasonFinalizationRecord): PaperArenaPublicSeasonResult {
  const payload = derive(finalization);
  const record: PaperArenaPublicSeasonResult = { ...payload, publicHash: hashCanonicalPayload(payload) };
  assertPaperArenaPublicSeasonResult(record);
  return record;
}

export class PaperArenaPublicSeasonResultService {
  private readonly store: PaperArenaSeasonFinalizationStore;
  private readonly streamId: string;

  constructor(input: { store: PaperArenaSeasonFinalizationStore; streamId: string }) {
    assertNonEmpty(input.streamId, "public Arena season result streamId");
    this.store = input.store;
    this.streamId = input.streamId;
  }

  async read(seasonId: string): Promise<PaperArenaPublicSeasonResult | null> {
    assertNonEmpty(seasonId, "public Arena season result seasonId");
    const finalization = await this.store.get(this.streamId, seasonId);
    return finalization ? buildPaperArenaPublicSeasonResult(finalization) : null;
  }
}
