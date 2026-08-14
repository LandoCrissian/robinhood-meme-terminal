import {
  RMT_ARENA_PUBLIC_READ_MODEL_V1,
  assertPaperArenaPublicReadModel,
  type PaperArenaPublicReadModel,
  type PublicArenaLeaderboard,
} from "../../agent-engine/src/paper-arena-public-read-model.ts";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";

export const RMT_MCP_TOOL_CONTRACT_V1 = "RMT_MCP_TOOL_CONTRACT_V1" as const;

export type RmtMcpToolName = "rmt_arena_matchup" | "rmt_arena_leaderboard";
export type RmtArenaLeaderboardView = "OVERALL" | "AGENT" | "HUMAN";

export interface RmtMcpToolDescriptor {
  name: RmtMcpToolName;
  title: string;
  description: string;
  readOnly: true;
  destructive: false;
  inputSchema: Record<string, unknown>;
}

export interface RmtArenaPublicReader {
  read(seasonId: string): Promise<PaperArenaPublicReadModel>;
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

export type RmtMcpToolResult = RmtArenaMatchupToolResult | RmtArenaLeaderboardToolResult;

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

function arenaLeaderboard(arena: PaperArenaPublicReadModel, view: RmtArenaLeaderboardView): PublicArenaLeaderboard {
  if (view === "OVERALL") return structuredClone(arena.overall);
  if (view === "AGENT") return structuredClone(arena.agents);
  return structuredClone(arena.humans);
}

export function rmtMcpReadOnlyToolDescriptors(): RmtMcpToolDescriptor[] {
  return [
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
  ];
}

export function assertRmtMcpToolResult(result: RmtMcpToolResult): void {
  if (result.schemaVersion !== 1 || result.contractVersion !== RMT_MCP_TOOL_CONTRACT_V1) fail("unsupported RMT MCP tool-result version");
  assertHash(result.resultHash, "RMT MCP resultHash");
  const { resultHash, ...payload } = result;
  if (resultHash !== hashCanonicalPayload(payload)) fail("RMT MCP result hash mismatch");
  if (result.tool === "rmt_arena_matchup") {
    assertPaperArenaPublicReadModel(result.arena);
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
  private readonly reader: RmtArenaPublicReader;

  constructor(reader: RmtArenaPublicReader) {
    this.reader = reader;
  }

  listTools(): RmtMcpToolDescriptor[] {
    return rmtMcpReadOnlyToolDescriptors().map((tool) => structuredClone(tool));
  }

  async callTool(name: string, input: unknown): Promise<RmtMcpToolResult> {
    if (name !== "rmt_arena_matchup" && name !== "rmt_arena_leaderboard") fail("unknown or non-admitted RMT MCP tool");
    assertRecord(input, "RMT MCP tool input");
    const keys = Object.keys(input);
    if (name === "rmt_arena_matchup") {
      if (keys.some((key) => key !== "seasonId")) fail("rmt_arena_matchup input contains unsupported fields");
      assertNonEmpty(input.seasonId, "rmt_arena_matchup seasonId");
      const arena = await this.reader.read(input.seasonId.trim());
      assertPaperArenaPublicReadModel(arena);
      if (arena.apiVersion !== RMT_ARENA_PUBLIC_READ_MODEL_V1) fail("Arena public read-model version mismatch");
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

    if (keys.some((key) => key !== "seasonId" && key !== "view")) fail("rmt_arena_leaderboard input contains unsupported fields");
    assertNonEmpty(input.seasonId, "rmt_arena_leaderboard seasonId");
    if (input.view !== "OVERALL" && input.view !== "AGENT" && input.view !== "HUMAN") fail("rmt_arena_leaderboard view is invalid");
    const arena = await this.reader.read(input.seasonId.trim());
    assertPaperArenaPublicReadModel(arena);
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
