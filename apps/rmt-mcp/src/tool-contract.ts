import {
  RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1,
  RMT_ARENA_PUBLIC_READ_MODEL_V1,
  RMT_ARENA_PUBLIC_SEASON_CATALOG_V1,
  RMT_ARENA_PUBLIC_SEASON_RESULT_V1,
  assertPaperArenaPublicParticipantProfile,
  assertPaperArenaPublicReadModel,
  assertPaperArenaPublicSeasonCatalog,
  assertPaperArenaPublicSeasonResult,
  type PaperArenaPublicParticipantProfile,
  type PaperArenaPublicReadModel,
  type PaperArenaPublicSeasonCatalog,
  type PaperArenaPublicSeasonResult,
  type PublicArenaLeaderboard,
} from "../../agent-engine/src/public.ts";
import {
  hashCanonicalPayload,
  normalizeHumanParticipantId,
} from "../../../packages/agent-core/src/index.ts";

export const RMT_MCP_TOOL_CONTRACT_V1 = "RMT_MCP_TOOL_CONTRACT_V1" as const;

export type RmtMcpToolName =
  | "rmt_arena_seasons"
  | "rmt_arena_matchup"
  | "rmt_arena_leaderboard"
  | "rmt_arena_participant"
  | "rmt_arena_season_result";
export type RmtArenaLeaderboardView = "OVERALL" | "AGENT" | "HUMAN";

export interface RmtMcpToolDescriptor {
  name: RmtMcpToolName;
  title: string;
  description: string;
  readOnly: true;
  destructive: false;
  inputSchema: Record<string, unknown>;
}

export interface RmtArenaPublicSeasonCatalogReader {
  read(): Promise<PaperArenaPublicSeasonCatalog>;
}

export interface RmtArenaPublicReader {
  read(seasonId: string): Promise<PaperArenaPublicReadModel>;
}

export interface RmtArenaPublicParticipantProfileReader {
  read(input: {
    seasonId: string;
    participantType: "AGENT" | "HUMAN";
    participantId: string;
  }): Promise<PaperArenaPublicParticipantProfile>;
}

export interface RmtArenaPublicSeasonResultReader {
  read(seasonId: string): Promise<PaperArenaPublicSeasonResult | null>;
}

export interface RmtArenaSeasonsToolResult {
  schemaVersion: 1;
  tool: "rmt_arena_seasons";
  contractVersion: typeof RMT_MCP_TOOL_CONTRACT_V1;
  catalog: PaperArenaPublicSeasonCatalog;
  resultHash: string;
}

export interface RmtArenaMatchupToolResult {
  schemaVersion: 1;
  tool: "rmt_arena_matchup";
  contractVersion: typeof RMT_MCP_TOOL_CONTRACT_V1;
  arena: PaperArenaPublicReadModel;
  resultHash: string;
}

export interface RmtArenaLeaderboardToolResult {
  schemaVersion: 1;
  tool: "rmt_arena_leaderboard";
  contractVersion: typeof RMT_MCP_TOOL_CONTRACT_V1;
  seasonId: string;
  view: RmtArenaLeaderboardView;
  leaderboard: PublicArenaLeaderboard;
  status: PaperArenaPublicReadModel["status"];
  winner: PaperArenaPublicReadModel["winner"];
  capturedAt: number;
  source: PaperArenaPublicReadModel["source"];
  arenaPublicHash: string;
  resultHash: string;
}

export interface RmtArenaParticipantToolResult {
  schemaVersion: 1;
  tool: "rmt_arena_participant";
  contractVersion: typeof RMT_MCP_TOOL_CONTRACT_V1;
  profile: PaperArenaPublicParticipantProfile;
  resultHash: string;
}

export interface RmtArenaSeasonResultToolResult {
  schemaVersion: 1;
  tool: "rmt_arena_season_result";
  contractVersion: typeof RMT_MCP_TOOL_CONTRACT_V1;
  seasonResult: PaperArenaPublicSeasonResult;
  resultHash: string;
}

export type RmtMcpToolResult =
  | RmtArenaSeasonsToolResult
  | RmtArenaMatchupToolResult
  | RmtArenaLeaderboardToolResult
  | RmtArenaParticipantToolResult
  | RmtArenaSeasonResultToolResult;

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertNoUnsupportedFields(input: Record<string, unknown>, admitted: readonly string[], tool: string): void {
  if (Object.keys(input).some((key) => !admitted.includes(key))) fail(`${tool} input contains unsupported fields`);
}

function assertSeasonOnlyInput(input: Record<string, unknown>, tool: string): string {
  assertNoUnsupportedFields(input, ["seasonId"], tool);
  assertNonEmpty(input.seasonId, `${tool} seasonId`);
  return input.seasonId.trim();
}

function canonicalParticipantInput(input: Record<string, unknown>): {
  seasonId: string;
  participantType: "AGENT" | "HUMAN";
  participantId: string;
} {
  assertNoUnsupportedFields(input, ["seasonId", "participantType", "participantId"], "rmt_arena_participant");
  assertNonEmpty(input.seasonId, "rmt_arena_participant seasonId");
  if (input.participantType !== "AGENT" && input.participantType !== "HUMAN") {
    fail("rmt_arena_participant participantType is invalid");
  }
  assertNonEmpty(input.participantId, "rmt_arena_participant participantId");
  return {
    seasonId: input.seasonId.trim(),
    participantType: input.participantType,
    participantId: input.participantType === "HUMAN"
      ? normalizeHumanParticipantId(input.participantId)
      : input.participantId.trim(),
  };
}

function arenaLeaderboard(arena: PaperArenaPublicReadModel, view: RmtArenaLeaderboardView): PublicArenaLeaderboard {
  if (view === "OVERALL") return structuredClone(arena.overall);
  if (view === "AGENT") return structuredClone(arena.agents);
  return structuredClone(arena.humans);
}

export function rmtMcpReadOnlyToolDescriptors(): RmtMcpToolDescriptor[] {
  return [
    {
      name: "rmt_arena_seasons",
      title: "RMT Arena Seasons",
      description: "Read the sanitized public RMT Arena season catalog.",
      readOnly: true,
      destructive: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "rmt_arena_matchup",
      title: "RMT Arena Matchup",
      description: "Read the sanitized authoritative Human-vs-Agent Arena matchup for a season.",
      readOnly: true,
      destructive: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["seasonId"],
        properties: { seasonId: { type: "string", minLength: 1 } },
      },
    },
    {
      name: "rmt_arena_leaderboard",
      title: "RMT Arena Leaderboard",
      description: "Read the sanitized Overall, Agent, or Human RMT Arena leaderboard for a season.",
      readOnly: true,
      destructive: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["seasonId", "view"],
        properties: {
          seasonId: { type: "string", minLength: 1 },
          view: { type: "string", enum: ["OVERALL", "AGENT", "HUMAN"] },
        },
      },
    },
    {
      name: "rmt_arena_participant",
      title: "RMT Arena Participant",
      description: "Read a sanitized public Arena participant profile for one season.",
      readOnly: true,
      destructive: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["seasonId", "participantType", "participantId"],
        properties: {
          seasonId: { type: "string", minLength: 1 },
          participantType: { type: "string", enum: ["AGENT", "HUMAN"] },
          participantId: { type: "string", minLength: 1 },
        },
      },
    },
    {
      name: "rmt_arena_season_result",
      title: "RMT Arena Final Season Result",
      description: "Read the sanitized immutable finalized result for a completed RMT Arena season.",
      readOnly: true,
      destructive: false,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["seasonId"],
        properties: { seasonId: { type: "string", minLength: 1 } },
      },
    },
  ];
}

export function assertRmtMcpToolResult(result: RmtMcpToolResult): void {
  if (result.schemaVersion !== 1 || result.contractVersion !== RMT_MCP_TOOL_CONTRACT_V1) {
    fail("unsupported RMT MCP tool-result version");
  }
  assertHash(result.resultHash, "RMT MCP resultHash");
  const { resultHash, ...payload } = result;
  if (resultHash !== hashCanonicalPayload(payload)) fail("RMT MCP result hash mismatch");

  if (result.tool === "rmt_arena_seasons") {
    assertPaperArenaPublicSeasonCatalog(result.catalog);
    if (result.catalog.apiVersion !== RMT_ARENA_PUBLIC_SEASON_CATALOG_V1) fail("Arena public season-catalog version mismatch");
    return;
  }
  if (result.tool === "rmt_arena_matchup") {
    assertPaperArenaPublicReadModel(result.arena);
    if (result.arena.apiVersion !== RMT_ARENA_PUBLIC_READ_MODEL_V1) fail("Arena public read-model version mismatch");
    return;
  }
  if (result.tool === "rmt_arena_participant") {
    assertPaperArenaPublicParticipantProfile(result.profile);
    if (result.profile.apiVersion !== RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1) fail("Arena public participant-profile version mismatch");
    return;
  }
  if (result.tool === "rmt_arena_season_result") {
    assertPaperArenaPublicSeasonResult(result.seasonResult);
    if (result.seasonResult.apiVersion !== RMT_ARENA_PUBLIC_SEASON_RESULT_V1) fail("Arena public season-result version mismatch");
    return;
  }

  assertNonEmpty(result.seasonId, "RMT MCP seasonId");
  if (result.view !== "OVERALL" && result.view !== "AGENT" && result.view !== "HUMAN") fail("RMT MCP leaderboard view is invalid");
  assertHash(result.arenaPublicHash, "RMT MCP arenaPublicHash");
  assertHash(result.source.authoritativeSnapshotHash, "RMT MCP authoritativeSnapshotHash");
  assertHash(result.source.latestPerformanceDigest, "RMT MCP latestPerformanceDigest");
  assertHash(result.source.matchupHash, "RMT MCP matchupHash");
}

export class RmtMcpReadOnlyToolService {
  private readonly seasonCatalogReader?: RmtArenaPublicSeasonCatalogReader;
  private readonly arenaReader: RmtArenaPublicReader;
  private readonly participantProfileReader?: RmtArenaPublicParticipantProfileReader;
  private readonly seasonResultReader?: RmtArenaPublicSeasonResultReader;

  constructor(input: {
    seasonCatalogReader?: RmtArenaPublicSeasonCatalogReader;
    arenaReader: RmtArenaPublicReader;
    participantProfileReader?: RmtArenaPublicParticipantProfileReader;
    seasonResultReader?: RmtArenaPublicSeasonResultReader;
  }) {
    this.seasonCatalogReader = input.seasonCatalogReader;
    this.arenaReader = input.arenaReader;
    this.participantProfileReader = input.participantProfileReader;
    this.seasonResultReader = input.seasonResultReader;
  }

  listTools(): RmtMcpToolDescriptor[] {
    return rmtMcpReadOnlyToolDescriptors().map((tool) => structuredClone(tool));
  }

  async callTool(name: string, input: unknown): Promise<RmtMcpToolResult> {
    const admitted = rmtMcpReadOnlyToolDescriptors().map((tool) => tool.name);
    if (!admitted.includes(name as RmtMcpToolName)) fail("unknown or non-admitted RMT MCP tool");
    assertRecord(input, "RMT MCP tool input");

    if (name === "rmt_arena_seasons") {
      assertNoUnsupportedFields(input, [], "rmt_arena_seasons");
      if (!this.seasonCatalogReader) fail("RMT MCP season-catalog reader is not configured");
      const catalog = await this.seasonCatalogReader.read();
      assertPaperArenaPublicSeasonCatalog(catalog);
      const payload: Omit<RmtArenaSeasonsToolResult, "resultHash"> = {
        schemaVersion: 1,
        tool: "rmt_arena_seasons",
        contractVersion: RMT_MCP_TOOL_CONTRACT_V1,
        catalog: structuredClone(catalog),
      };
      const result: RmtArenaSeasonsToolResult = { ...payload, resultHash: hashCanonicalPayload(payload) };
      assertRmtMcpToolResult(result);
      return result;
    }

    if (name === "rmt_arena_matchup") {
      const seasonId = assertSeasonOnlyInput(input, "rmt_arena_matchup");
      const arena = await this.arenaReader.read(seasonId);
      assertPaperArenaPublicReadModel(arena);
      if (arena.seasonId !== seasonId) fail("RMT MCP matchup reader returned a different season");
      const payload: Omit<RmtArenaMatchupToolResult, "resultHash"> = {
        schemaVersion: 1,
        tool: "rmt_arena_matchup",
        contractVersion: RMT_MCP_TOOL_CONTRACT_V1,
        arena: structuredClone(arena),
      };
      const result: RmtArenaMatchupToolResult = { ...payload, resultHash: hashCanonicalPayload(payload) };
      assertRmtMcpToolResult(result);
      return result;
    }

    if (name === "rmt_arena_participant") {
      const request = canonicalParticipantInput(input);
      if (!this.participantProfileReader) fail("RMT MCP participant-profile reader is not configured");
      const profile = await this.participantProfileReader.read(request);
      assertPaperArenaPublicParticipantProfile(profile);
      if (
        profile.seasonId !== request.seasonId
        || profile.participantType !== request.participantType
        || profile.participantId !== request.participantId
      ) {
        fail("RMT MCP participant reader returned a different participant");
      }
      const payload: Omit<RmtArenaParticipantToolResult, "resultHash"> = {
        schemaVersion: 1,
        tool: "rmt_arena_participant",
        contractVersion: RMT_MCP_TOOL_CONTRACT_V1,
        profile: structuredClone(profile),
      };
      const result: RmtArenaParticipantToolResult = { ...payload, resultHash: hashCanonicalPayload(payload) };
      assertRmtMcpToolResult(result);
      return result;
    }

    if (name === "rmt_arena_season_result") {
      const seasonId = assertSeasonOnlyInput(input, "rmt_arena_season_result");
      if (!this.seasonResultReader) fail("RMT MCP finalized-season reader is not configured");
      const seasonResult = await this.seasonResultReader.read(seasonId);
      if (!seasonResult) fail("RMT Arena season is not finalized or is unavailable");
      assertPaperArenaPublicSeasonResult(seasonResult);
      if (seasonResult.seasonId !== seasonId) fail("RMT MCP finalized-season reader returned a different season");
      const payload: Omit<RmtArenaSeasonResultToolResult, "resultHash"> = {
        schemaVersion: 1,
        tool: "rmt_arena_season_result",
        contractVersion: RMT_MCP_TOOL_CONTRACT_V1,
        seasonResult: structuredClone(seasonResult),
      };
      const result: RmtArenaSeasonResultToolResult = { ...payload, resultHash: hashCanonicalPayload(payload) };
      assertRmtMcpToolResult(result);
      return result;
    }

    assertNoUnsupportedFields(input, ["seasonId", "view"], "rmt_arena_leaderboard");
    assertNonEmpty(input.seasonId, "rmt_arena_leaderboard seasonId");
    if (input.view !== "OVERALL" && input.view !== "AGENT" && input.view !== "HUMAN") fail("rmt_arena_leaderboard view is invalid");
    const seasonId = input.seasonId.trim();
    const arena = await this.arenaReader.read(seasonId);
    assertPaperArenaPublicReadModel(arena);
    if (arena.seasonId !== seasonId) fail("RMT MCP leaderboard reader returned a different season");
    const payload: Omit<RmtArenaLeaderboardToolResult, "resultHash"> = {
      schemaVersion: 1,
      tool: "rmt_arena_leaderboard",
      contractVersion: RMT_MCP_TOOL_CONTRACT_V1,
      seasonId: arena.seasonId,
      view: input.view,
      leaderboard: arenaLeaderboard(arena, input.view),
      status: arena.status,
      winner: arena.winner,
      capturedAt: arena.capturedAt,
      source: structuredClone(arena.source),
      arenaPublicHash: arena.publicHash,
    };
    const result: RmtArenaLeaderboardToolResult = { ...payload, resultHash: hashCanonicalPayload(payload) };
    assertRmtMcpToolResult(result);
    return result;
  }
}
