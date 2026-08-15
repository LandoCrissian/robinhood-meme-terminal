import assert from "node:assert/strict";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaPublicParticipantProfile } from "../../agent-engine/src/paper-arena-public-participant-profile.ts";
import type { PaperArenaPublicReadModel } from "../../agent-engine/src/paper-arena-public-read-model.ts";
import type { PaperArenaPublicSeasonCatalog } from "../../agent-engine/src/paper-arena-public-season-catalog.ts";
import type { PaperArenaPublicSeasonResult } from "../../agent-engine/src/paper-arena-public-season-result.ts";
import {
  RmtMcpReadOnlyToolService,
  assertRmtMcpToolResult,
  rmtMcpReadOnlyToolDescriptors,
} from "./tool-contract.ts";

const h = (char: string) => `0x${char.repeat(64)}`;
const human = "0x00000000000000000000000000000000000000aa";

const arenaPayload: Omit<PaperArenaPublicReadModel, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_V1",
  streamId: "mcp-read",
  seasonId: "season-1",
  quoteAssetId: "eip155:4663/contract:0x1111111111111111111111111111111111111111",
  startingNavQuoteAtomic: "1000000",
  status: "FINALIZABLE",
  winner: "AGENT",
  capturedAt: 1000,
  roster: { totalCount: 2, agentCount: 1, humanCount: 1, rosterHash: h("1") },
  agentTeam: {
    participantType: "AGENT",
    registeredCount: 1,
    eligibleCount: 1,
    provisionalCount: 0,
    missingCount: 0,
    sumNetReturnQuoteAtomic: "10",
    meanNetReturnQuoteAtomic: "10",
    topParticipantId: "agent-1",
  },
  humanTeam: {
    participantType: "HUMAN",
    registeredCount: 1,
    eligibleCount: 1,
    provisionalCount: 0,
    missingCount: 0,
    sumNetReturnQuoteAtomic: "5",
    meanNetReturnQuoteAtomic: "5",
    topParticipantId: human,
  },
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
  seasons: [{
    seasonId: arena.seasonId,
    name: "Season One",
    startsAt: 0,
    endsAt: 900,
    status: "FINALIZED",
    participants: { totalCount: 2, agentCount: 1, humanCount: 1, participantSetHash: h("5") },
    finalResult: { winner: "AGENT", finalizedAt: 1000, finalizationHash: h("6") },
  }],
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
  competition: {
    status: "AWAITING_PERFORMANCE",
    rank: null,
    netReturnQuoteAtomic: null,
    netReturnBps: null,
    maxDrawdownBps: null,
    fillCount: null,
    latestNetLiquidationNavQuoteAtomic: null,
    capturedAt: null,
    eligibilityReasons: [],
    matchupStatus: "FINALIZABLE",
    matchupWinner: "AGENT",
  },
  source: {
    rosterHash: arena.roster.rosterHash,
    matchupHash: arena.source.matchupHash,
    authoritativeSnapshotHash: arena.source.authoritativeSnapshotHash,
    performanceHash: null,
  },
};
const participant: PaperArenaPublicParticipantProfile = {
  ...participantPayload,
  publicHash: hashCanonicalPayload(participantPayload),
};

const seasonResultPayload: Omit<PaperArenaPublicSeasonResult, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_SEASON_RESULT_V1",
  streamId: arena.streamId,
  seasonId: arena.seasonId,
  seasonEndsAt: 900,
  finalizedAt: 1000,
  winner: "AGENT",
  arena,
  source: {
    finalizationHash: h("6"),
    cutoffPerformanceDigest: h("7"),
    rosterHash: arena.roster.rosterHash,
    matchupHash: arena.source.matchupHash,
  },
};
const seasonResult: PaperArenaPublicSeasonResult = {
  ...seasonResultPayload,
  publicHash: hashCanonicalPayload(seasonResultPayload),
};

const service = new RmtMcpReadOnlyToolService({
  seasonCatalogReader: { read: async () => structuredClone(catalog) },
  arenaReader: { read: async () => structuredClone(arena) },
  participantProfileReader: { read: async () => structuredClone(participant) },
  seasonResultReader: {
    read: async (seasonId) => seasonId === "unfinalized" ? null : structuredClone(seasonResult),
  },
});

const descriptors = rmtMcpReadOnlyToolDescriptors();
assert.deepEqual(descriptors.map((tool) => tool.name), [
  "rmt_arena_seasons",
  "rmt_arena_matchup",
  "rmt_arena_leaderboard",
  "rmt_arena_participant",
  "rmt_arena_season_result",
]);
assert.deepEqual(service.listTools(), descriptors);
assert.ok(descriptors.every((tool) => tool.readOnly === true && tool.destructive === false));
for (const forbiddenName of ["trade", "swap", "sign", "wallet", "execute", "submit", "withdraw", "send_transaction"]) {
  assert.equal(descriptors.some((tool) => tool.name.includes(forbiddenName)), false);
}

const seasons = await service.callTool("rmt_arena_seasons", {});
const matchup = await service.callTool("rmt_arena_matchup", { seasonId: "season-1" });
const leaderboard = await service.callTool("rmt_arena_leaderboard", { seasonId: "season-1", view: "HUMAN" });
const profile = await service.callTool("rmt_arena_participant", {
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: "agent-1",
});
const finalized = await service.callTool("rmt_arena_season_result", { seasonId: "season-1" });

assert.equal(seasons.tool, "rmt_arena_seasons");
assert.equal(matchup.tool, "rmt_arena_matchup");
assert.equal(leaderboard.tool, "rmt_arena_leaderboard");
assert.equal(profile.tool, "rmt_arena_participant");
assert.equal(finalized.tool, "rmt_arena_season_result");
for (const result of [seasons, matchup, leaderboard, profile, finalized]) {
  assert.doesNotThrow(() => assertRmtMcpToolResult(result));
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "engineSnapshot",
    "accountSnapshot",
    "balances",
    "ownerAddress",
    "thesis",
    "strategyHash",
    "modelIdentity",
    "reasoningSummary",
    "quoteEvidence",
    "privateKey",
    "calldata",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `RMT MCP result leaked forbidden field ${forbidden}`);
  }
}

await assert.rejects(
  () => service.callTool("rmt_arena_season_result", { seasonId: "unfinalized" }),
  /not finalized or is unavailable/,
);
await assert.rejects(
  () => new RmtMcpReadOnlyToolService({ arenaReader: { read: async () => structuredClone(arena) } })
    .callTool("rmt_arena_seasons", {}),
  /reader is not configured/,
);
await assert.rejects(() => service.callTool("rmt_live_execute", {}), /unknown or non-admitted/);
await assert.rejects(
  () => service.callTool("rmt_arena_leaderboard", { seasonId: "season-1", view: "ALL" }),
  /view is invalid/,
);
await assert.rejects(
  () => service.callTool("rmt_arena_matchup", { seasonId: "season-1", wallet: "secret" }),
  /unsupported fields/,
);
await assert.rejects(
  () => service.callTool("rmt_arena_participant", {
    seasonId: "season-1",
    participantType: "AGENT",
    participantId: "agent-1",
    sign: true,
  }),
  /unsupported fields/,
);

const tampered = structuredClone(leaderboard);
if (tampered.tool !== "rmt_arena_leaderboard") throw new Error("unexpected test result type");
tampered.winner = "HUMAN";
assert.throws(() => assertRmtMcpToolResult(tampered), /result hash mismatch/);
assert.equal("executeLive" in service, false);
assert.equal("sign" in service, false);
assert.equal("submitPaperOrder" in service, false);

console.log("rmt-mcp read-only Arena tool smoke: ok");
