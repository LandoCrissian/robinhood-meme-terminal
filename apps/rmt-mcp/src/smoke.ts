import assert from "node:assert/strict";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaPublicReadModel } from "../../agent-engine/src/paper-arena-public-read-model.ts";
import type { PaperArenaPublicSeasonResult } from "../../agent-engine/src/paper-arena-public-season-result.ts";
import {
  RmtMcpReadOnlyToolService,
  assertRmtMcpToolResult,
  rmtMcpReadOnlyToolDescriptors,
  type RmtArenaPublicReader,
  type RmtArenaPublicSeasonResultReader,
} from "./tool-contract.ts";

const hash = (char: string) => `0x${char.repeat(64)}`;
const publicPayload: Omit<PaperArenaPublicReadModel, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_V1",
  streamId: "arena-public",
  seasonId: "season-1",
  quoteAssetId: "eip155:4663/contract:0x1111111111111111111111111111111111111111",
  startingNavQuoteAtomic: "1000000",
  status: "FINALIZABLE",
  winner: "AGENT",
  capturedAt: 10_000,
  roster: { totalCount: 2, agentCount: 1, humanCount: 1, rosterHash: hash("1") },
  agentTeam: {
    participantType: "AGENT",
    registeredCount: 1,
    eligibleCount: 1,
    provisionalCount: 0,
    missingCount: 0,
    sumNetReturnQuoteAtomic: "50",
    meanNetReturnQuoteAtomic: "50",
    topParticipantId: "agent-1",
  },
  humanTeam: {
    participantType: "HUMAN",
    registeredCount: 1,
    eligibleCount: 1,
    provisionalCount: 0,
    missingCount: 0,
    sumNetReturnQuoteAtomic: "30",
    meanNetReturnQuoteAtomic: "30",
    topParticipantId: "0x00000000000000000000000000000000000000aa",
  },
  overall: {
    ranked: [
      {
        rank: 1,
        participantType: "AGENT",
        participantId: "agent-1",
        netReturnQuoteAtomic: "50",
        netReturnBps: "0",
        maxDrawdownBps: 10,
        fillCount: 4,
        latestNetLiquidationNavQuoteAtomic: "1000050",
        capturedAt: 10_000,
        performanceHash: hash("2"),
      },
      {
        rank: 2,
        participantType: "HUMAN",
        participantId: "0x00000000000000000000000000000000000000aa",
        netReturnQuoteAtomic: "30",
        netReturnBps: "0",
        maxDrawdownBps: 20,
        fillCount: 3,
        latestNetLiquidationNavQuoteAtomic: "1000030",
        capturedAt: 10_000,
        performanceHash: hash("3"),
      },
    ],
    provisional: [],
  },
  agents: {
    ranked: [{
      rank: 1,
      participantType: "AGENT",
      participantId: "agent-1",
      netReturnQuoteAtomic: "50",
      netReturnBps: "0",
      maxDrawdownBps: 10,
      fillCount: 4,
      latestNetLiquidationNavQuoteAtomic: "1000050",
      capturedAt: 10_000,
      performanceHash: hash("2"),
    }],
    provisional: [],
  },
  humans: {
    ranked: [{
      rank: 1,
      participantType: "HUMAN",
      participantId: "0x00000000000000000000000000000000000000aa",
      netReturnQuoteAtomic: "30",
      netReturnBps: "0",
      maxDrawdownBps: 20,
      fillCount: 3,
      latestNetLiquidationNavQuoteAtomic: "1000030",
      capturedAt: 10_000,
      performanceHash: hash("3"),
    }],
    provisional: [],
  },
  source: {
    authoritativeSnapshotHash: hash("4"),
    latestPerformanceDigest: hash("5"),
    matchupHash: hash("6"),
  },
};
const arena: PaperArenaPublicReadModel = { ...publicPayload, publicHash: hashCanonicalPayload(publicPayload) };
const finalPayload: Omit<PaperArenaPublicSeasonResult, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_SEASON_RESULT_V1",
  streamId: arena.streamId,
  seasonId: arena.seasonId,
  seasonEndsAt: 9_900,
  finalizedAt: 10_100,
  winner: "AGENT",
  arena,
  source: {
    finalizationHash: hash("7"),
    cutoffPerformanceDigest: hash("8"),
    rosterHash: arena.roster.rosterHash,
    matchupHash: arena.source.matchupHash,
  },
};
const finalResult: PaperArenaPublicSeasonResult = { ...finalPayload, publicHash: hashCanonicalPayload(finalPayload) };

class Reader implements RmtArenaPublicReader {
  calls = 0;
  async read(seasonId: string): Promise<PaperArenaPublicReadModel> {
    this.calls += 1;
    assert.equal(seasonId, "season-1");
    return structuredClone(arena);
  }
}
class FinalReader implements RmtArenaPublicSeasonResultReader {
  calls = 0;
  async read(seasonId: string): Promise<PaperArenaPublicSeasonResult | null> {
    this.calls += 1;
    if (seasonId === "unfinalized") return null;
    assert.equal(seasonId, "season-1");
    return structuredClone(finalResult);
  }
}

const descriptors = rmtMcpReadOnlyToolDescriptors();
assert.deepEqual(descriptors.map((tool) => tool.name), ["rmt_arena_matchup", "rmt_arena_leaderboard", "rmt_arena_season_result"]);
assert.ok(descriptors.every((tool) => tool.readOnly === true && tool.destructive === false));
for (const forbiddenName of ["trade", "swap", "sign", "wallet", "execute", "submit", "withdraw", "send_transaction"]) {
  assert.equal(descriptors.some((tool) => tool.name.includes(forbiddenName)), false);
}

const reader = new Reader();
const finalReader = new FinalReader();
const service = new RmtMcpReadOnlyToolService({ arenaReader: reader, seasonResultReader: finalReader });
assert.deepEqual(service.listTools(), descriptors);
const matchup = await service.callTool("rmt_arena_matchup", { seasonId: "season-1" });
assert.equal(matchup.tool, "rmt_arena_matchup");
assert.equal(matchup.arena.winner, "AGENT");
assert.doesNotThrow(() => assertRmtMcpToolResult(matchup));

const humans = await service.callTool("rmt_arena_leaderboard", { seasonId: "season-1", view: "HUMAN" });
assert.equal(humans.tool, "rmt_arena_leaderboard");
assert.equal(humans.view, "HUMAN");
assert.equal(humans.leaderboard.ranked.length, 1);
assert.equal(humans.leaderboard.ranked[0]?.participantType, "HUMAN");
assert.equal(humans.arenaPublicHash, arena.publicHash);
assert.doesNotThrow(() => assertRmtMcpToolResult(humans));

const archived = await service.callTool("rmt_arena_season_result", { seasonId: "season-1" });
assert.equal(archived.tool, "rmt_arena_season_result");
assert.equal(archived.seasonResult.winner, "AGENT");
assert.equal(archived.seasonResult.source.finalizationHash, hash("7"));
assert.doesNotThrow(() => assertRmtMcpToolResult(archived));
assert.equal(reader.calls, 2);
assert.equal(finalReader.calls, 1);

await assert.rejects(() => service.callTool("rmt_arena_season_result", { seasonId: "unfinalized" }), /not finalized or is unavailable/);
await assert.rejects(() => new RmtMcpReadOnlyToolService({ arenaReader: reader }).callTool("rmt_arena_season_result", { seasonId: "season-1" }), /reader is not configured/);
await assert.rejects(() => service.callTool("rmt_live_execute", { seasonId: "season-1" }), /unknown or non-admitted/);
await assert.rejects(() => service.callTool("rmt_arena_leaderboard", { seasonId: "season-1", view: "ALL" }), /view is invalid/);
await assert.rejects(() => service.callTool("rmt_arena_matchup", { seasonId: "season-1", wallet: "secret" }), /unsupported fields/);

for (const result of [matchup, humans, archived]) {
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

const tampered = structuredClone(humans);
tampered.winner = "HUMAN";
assert.throws(() => assertRmtMcpToolResult(tampered), /result hash mismatch/);
assert.equal("executeLive" in service, false);
assert.equal("sign" in service, false);
assert.equal("submitPaperOrder" in service, false);

console.log("rmt-mcp read-only Arena tool smoke: ok");
