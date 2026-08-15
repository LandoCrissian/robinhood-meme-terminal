import assert from "node:assert/strict";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type {
  PaperArenaPublicCareerProfile,
  PaperArenaPublicParticipantProfile,
  PaperArenaPublicReadModel,
  PaperArenaPublicSeasonCatalog,
  PaperArenaPublicSeasonResult,
} from "../../agent-engine/src/public.ts";
import { RmtMcpReadRegistry, RMT_MCP_READ_REGISTRY_V1 } from "./read-registry.ts";

const h = (char: string) => `0x${char.repeat(64)}`;
const human = "0x00000000000000000000000000000000000000aa";

const arenaPayload: Omit<PaperArenaPublicReadModel, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_V1",
  streamId: "registry",
  seasonId: "season-1",
  quoteAssetId: "eip155:4663/contract:0x1111111111111111111111111111111111111111",
  startingNavQuoteAtomic: "1000000",
  status: "FINALIZABLE",
  winner: "AGENT",
  capturedAt: 1000,
  roster: { totalCount: 2, agentCount: 1, humanCount: 1, rosterHash: h("1") },
  agentTeam: { participantType: "AGENT", registeredCount: 1, eligibleCount: 1, provisionalCount: 0, missingCount: 0, sumNetReturnQuoteAtomic: "10", meanNetReturnQuoteAtomic: "10", topParticipantId: "agent-1" },
  humanTeam: { participantType: "HUMAN", registeredCount: 1, eligibleCount: 1, provisionalCount: 0, missingCount: 0, sumNetReturnQuoteAtomic: "5", meanNetReturnQuoteAtomic: "5", topParticipantId: human },
  overall: { ranked: [], provisional: [] },
  agents: { ranked: [], provisional: [] },
  humans: { ranked: [], provisional: [] },
  source: { authoritativeSnapshotHash: h("2"), latestPerformanceDigest: h("3"), matchupHash: h("4") },
};
const arena: PaperArenaPublicReadModel = { ...arenaPayload, publicHash: hashCanonicalPayload(arenaPayload) };

const catalogPayload: Omit<PaperArenaPublicSeasonCatalog, "catalogHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_SEASON_CATALOG_V1",
  streamId: arena.streamId,
  observedAt: 1100,
  seasons: [{ seasonId: "season-1", name: "Season One", startsAt: 0, endsAt: 900, status: "FINALIZED", participants: { totalCount: 2, agentCount: 1, humanCount: 1, participantSetHash: h("5") }, finalResult: { winner: "AGENT", finalizedAt: 1000, finalizationHash: h("6") } }],
};
const catalog: PaperArenaPublicSeasonCatalog = { ...catalogPayload, catalogHash: hashCanonicalPayload(catalogPayload) };

const participantPayload: Omit<PaperArenaPublicParticipantProfile, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_PARTICIPANT_PROFILE_V1",
  streamId: arena.streamId,
  seasonId: arena.seasonId,
  participantType: "AGENT",
  participantId: "agent-1",
  identity: { displayName: "HoodHound", agentLifecycleState: "QUALIFIED", createdAt: 1 },
  competition: { status: "AWAITING_PERFORMANCE", rank: null, netReturnQuoteAtomic: null, netReturnBps: null, maxDrawdownBps: null, fillCount: null, latestNetLiquidationNavQuoteAtomic: null, capturedAt: null, eligibilityReasons: [], matchupStatus: "FINALIZABLE", matchupWinner: "AGENT" },
  source: { rosterHash: arena.roster.rosterHash, matchupHash: arena.source.matchupHash, authoritativeSnapshotHash: arena.source.authoritativeSnapshotHash, performanceHash: null },
};
const participant: PaperArenaPublicParticipantProfile = { ...participantPayload, publicHash: hashCanonicalPayload(participantPayload) };

const careerPayload: Omit<PaperArenaPublicCareerProfile, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_CAREER_PROFILE_V1",
  streamId: arena.streamId,
  participantType: "AGENT",
  participantId: "agent-1",
  identity: { displayName: "HoodHound", agentLifecycleState: "QUALIFIED", createdAt: 1 },
  career: { seasonsCompleted: 1, teamWins: 1, teamLosses: 0, teamTies: 0, divisionWins: 1, overallWins: 1, podiumFinishes: 1, bestOverallRank: 1, currentTeamWinStreak: 1, longestTeamWinStreak: 1, totalFills: 2, sumNetReturnBps: "100", worstSeasonDrawdownBps: 25, latestSeasonId: "season-1" },
  netReturnQuoteAtomicByAsset: { [arena.quoteAssetId]: "10000" },
  seasons: [{ seasonId: "season-1", seasonEndsAt: 900, finalizedAt: 1000, participantType: "AGENT", participantId: "agent-1", teamWinner: "AGENT", teamOutcome: "WIN", overallRank: 1, divisionRank: 1, quoteAssetId: arena.quoteAssetId, netReturnQuoteAtomic: "10000", netReturnBps: "100", maxDrawdownBps: 25, fillCount: 2, finalizationHash: h("6"), performanceHash: h("7") }],
  source: { archiveDigest: h("8"), reputationHash: h("9") },
};
const career: PaperArenaPublicCareerProfile = { ...careerPayload, publicHash: hashCanonicalPayload(careerPayload) };

const seasonResultPayload: Omit<PaperArenaPublicSeasonResult, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_SEASON_RESULT_V1",
  streamId: arena.streamId,
  seasonId: arena.seasonId,
  seasonEndsAt: 900,
  finalizedAt: 1000,
  winner: "AGENT",
  arena,
  source: { finalizationHash: h("6"), cutoffPerformanceDigest: h("a"), rosterHash: arena.roster.rosterHash, matchupHash: arena.source.matchupHash },
};
const seasonResult: PaperArenaPublicSeasonResult = { ...seasonResultPayload, publicHash: hashCanonicalPayload(seasonResultPayload) };

const registry = new RmtMcpReadRegistry({
  seasonCatalogReader: { read: async () => structuredClone(catalog) },
  arenaReader: { read: async () => structuredClone(arena) },
  participantProfileReader: { read: async () => structuredClone(participant) },
  seasonResultReader: { read: async () => structuredClone(seasonResult) },
  careerProfileReader: { read: async () => structuredClone(career) },
});

const descriptor = registry.describe();
assert.equal(descriptor.registryVersion, RMT_MCP_READ_REGISTRY_V1);
assert.deepEqual(descriptor.tools.map((tool) => tool.name), [
  "rmt_arena_seasons",
  "rmt_arena_matchup",
  "rmt_arena_leaderboard",
  "rmt_arena_participant",
  "rmt_arena_career",
  "rmt_arena_season_result",
]);
assert.ok(descriptor.tools.every((tool) => tool.readOnly === true && tool.destructive === false));

assert.equal((await registry.call("rmt_arena_seasons", {})).tool, "rmt_arena_seasons");
assert.equal((await registry.call("rmt_arena_matchup", { seasonId: "season-1" })).tool, "rmt_arena_matchup");
assert.equal((await registry.call("rmt_arena_leaderboard", { seasonId: "season-1", view: "OVERALL" })).tool, "rmt_arena_leaderboard");
assert.equal((await registry.call("rmt_arena_participant", { seasonId: "season-1", participantType: "AGENT", participantId: "agent-1" })).tool, "rmt_arena_participant");
assert.equal((await registry.call("rmt_arena_career", { participantType: "AGENT", participantId: "agent-1" })).tool, "rmt_arena_career");
assert.equal((await registry.call("rmt_arena_season_result", { seasonId: "season-1" })).tool, "rmt_arena_season_result");

await assert.rejects(() => registry.call("rmt_trade", {}), /unknown or non-admitted/);
await assert.rejects(() => registry.call("rmt_arena_career", { participantType: "AGENT", participantId: "agent-1", sign: true }), /unsupported fields/);
assert.equal("executeLive" in registry, false);
assert.equal("sign" in registry, false);

console.log("rmt-mcp six-tool read registry smoke: ok");
