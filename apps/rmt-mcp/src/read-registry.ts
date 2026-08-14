import {
  RmtMcpCareerReadToolService,
  type RmtArenaPublicCareerProfileReader,
  type RmtArenaCareerToolResult,
} from "./career-tool.ts";
import {
  RmtMcpReadOnlyToolService,
  type RmtArenaPublicParticipantProfileReader,
  type RmtArenaPublicReader,
  type RmtArenaPublicSeasonCatalogReader,
  type RmtArenaPublicSeasonResultReader,
  type RmtMcpToolDescriptor,
  type RmtMcpToolResult,
} from "./tool-contract.ts";

export const RMT_MCP_READ_REGISTRY_V1 = "RMT_MCP_READ_REGISTRY_V1" as const;
export type RmtMcpReadRegistryToolResult = RmtMcpToolResult | RmtArenaCareerToolResult;

export interface RmtMcpReadRegistryDescriptor {
  registryVersion: typeof RMT_MCP_READ_REGISTRY_V1;
  tools: Array<RmtMcpToolDescriptor | ReturnType<RmtMcpCareerReadToolService["descriptor"]>>;
}

const ORDER = [
  "rmt_arena_seasons",
  "rmt_arena_matchup",
  "rmt_arena_leaderboard",
  "rmt_arena_participant",
  "rmt_arena_career",
  "rmt_arena_season_result",
] as const;

function fail(message: string): never {
  throw new Error(message);
}

export class RmtMcpReadRegistry {
  private readonly arena: RmtMcpReadOnlyToolService;
  private readonly career: RmtMcpCareerReadToolService;

  constructor(input: {
    seasonCatalogReader?: RmtArenaPublicSeasonCatalogReader;
    arenaReader: RmtArenaPublicReader;
    participantProfileReader?: RmtArenaPublicParticipantProfileReader;
    seasonResultReader?: RmtArenaPublicSeasonResultReader;
    careerProfileReader: RmtArenaPublicCareerProfileReader;
  }) {
    this.arena = new RmtMcpReadOnlyToolService({
      seasonCatalogReader: input.seasonCatalogReader,
      arenaReader: input.arenaReader,
      participantProfileReader: input.participantProfileReader,
      seasonResultReader: input.seasonResultReader,
    });
    this.career = new RmtMcpCareerReadToolService(input.careerProfileReader);
  }

  describe(): RmtMcpReadRegistryDescriptor {
    const byName = new Map<string, RmtMcpReadRegistryDescriptor["tools"][number]>();
    for (const tool of this.arena.listTools()) byName.set(tool.name, tool);
    const career = this.career.descriptor();
    if (byName.has(career.name)) fail("RMT MCP read registry contains duplicate tool name");
    byName.set(career.name, career);
    const tools = ORDER.map((name) => {
      const tool = byName.get(name);
      if (!tool) fail(`RMT MCP read registry is missing ${name}`);
      return structuredClone(tool);
    });
    if (byName.size !== ORDER.length) fail("RMT MCP read registry contains unexpected tool names");
    return { registryVersion: RMT_MCP_READ_REGISTRY_V1, tools };
  }

  async call(name: string, input: unknown): Promise<RmtMcpReadRegistryToolResult> {
    if (name === "rmt_arena_career") return this.career.call(input);
    if (!ORDER.includes(name as (typeof ORDER)[number])) fail("unknown or non-admitted RMT MCP read tool");
    return this.arena.callTool(name, input);
  }
}
