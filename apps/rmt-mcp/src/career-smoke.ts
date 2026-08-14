import assert from "node:assert/strict";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaPublicCareerProfile } from "../../agent-engine/src/paper-arena-public-career-profile.ts";
import {
  RmtMcpCareerReadToolService,
  assertRmtArenaCareerToolResult,
  rmtArenaCareerToolDescriptor,
  type RmtArenaPublicCareerProfileReader,
} from "./career-tool.ts";

const quoteOne = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const quoteTwo = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const h = (char: string) => `0x${char.repeat(64)}`;
const payload: Omit<PaperArenaPublicCareerProfile, "publicHash"> = {
  schemaVersion: 1,
  apiVersion: "RMT_ARENA_PUBLIC_CAREER_PROFILE_V1",
  streamId: "career-mcp",
  participantType: "AGENT",
  participantId: "agent-career-mcp",
  identity: { displayName: "HoodHound", agentLifecycleState: "QUALIFIED", createdAt: 100 },
  career: {
    seasonsCompleted: 2,
    teamWins: 1,
    teamLosses: 1,
    teamTies: 0,
    divisionWins: 2,
    overallWins: 1,
    podiumFinishes: 2,
    bestOverallRank: 1,
    currentTeamWinStreak: 0,
    longestTeamWinStreak: 1,
    totalFills: 7,
    sumNetReturnBps: "700",
    worstSeasonDrawdownBps: 250,
    latestSeasonId: "season-2",
  },
  netReturnQuoteAtomicByAsset: { [quoteOne]: "50000", [quoteTwo]: "20000" },
  seasons: [
    {
      seasonId: "season-1", seasonEndsAt: 500, finalizedAt: 510, participantType: "AGENT", participantId: "agent-career-mcp",
      teamWinner: "AGENT", teamOutcome: "WIN", overallRank: 1, divisionRank: 1, quoteAssetId: quoteOne,
      netReturnQuoteAtomic: "50000", netReturnBps: "500", maxDrawdownBps: 100, fillCount: 4,
      finalizationHash: h("1"), performanceHash: h("2"),
    },
    {
      seasonId: "season-2", seasonEndsAt: 1000, finalizedAt: 1010, participantType: "AGENT", participantId: "agent-career-mcp",
      teamWinner: "HUMAN", teamOutcome: "LOSS", overallRank: 2, divisionRank: 1, quoteAssetId: quoteTwo,
      netReturnQuoteAtomic: "20000", netReturnBps: "200", maxDrawdownBps: 250, fillCount: 3,
      finalizationHash: h("3"), performanceHash: h("4"),
    },
  ],
  source: { archiveDigest: h("5"), reputationHash: h("6") },
};
const profile: PaperArenaPublicCareerProfile = { ...payload, publicHash: hashCanonicalPayload(payload) };

class Reader implements RmtArenaPublicCareerProfileReader {
  calls = 0;
  async read(input: { participantType: "AGENT" | "HUMAN"; participantId: string }): Promise<PaperArenaPublicCareerProfile> {
    this.calls += 1;
    assert.deepEqual(input, { participantType: "AGENT", participantId: "agent-career-mcp" });
    return structuredClone(profile);
  }
}

const descriptor = rmtArenaCareerToolDescriptor();
assert.equal(descriptor.name, "rmt_arena_career");
assert.equal(descriptor.readOnly, true);
assert.equal(descriptor.destructive, false);
assert.equal(/trade|swap|sign|wallet|execute|submit|withdraw/i.test(descriptor.name), false);

const reader = new Reader();
const service = new RmtMcpCareerReadToolService(reader);
assert.deepEqual(service.descriptor(), descriptor);
const result = await service.call({ participantType: "AGENT", participantId: "agent-career-mcp" });
assert.equal(result.tool, "rmt_arena_career");
assert.equal(result.profile.identity.displayName, "HoodHound");
assert.equal(result.profile.career.seasonsCompleted, 2);
assert.equal(result.profile.career.overallWins, 1);
assert.equal(result.profile.career.sumNetReturnBps, "700");
assert.equal(result.profile.seasons.length, 2);
assert.doesNotThrow(() => assertRmtArenaCareerToolResult(result));
assert.equal(reader.calls, 1);

await assert.rejects(() => service.call({ participantType: "BOT", participantId: "agent-career-mcp" }), /participantType is invalid/);
await assert.rejects(() => service.call({ participantType: "AGENT", participantId: "agent-career-mcp", seasonId: "secret" }), /unsupported fields/);

const serialized = JSON.stringify(result);
for (const forbidden of [
  "ownerAddress", "thesis", "engineSnapshot", "accountSnapshot", "balances", "strategyHash", "modelIdentity",
  "reasoningSummary", "quoteEvidence", "privateKey", "calldata",
]) {
  assert.equal(serialized.includes(forbidden), false, `RMT career MCP result leaked forbidden field ${forbidden}`);
}

const tampered = structuredClone(result);
tampered.profile.career.teamWins = 9;
assert.throws(() => assertRmtArenaCareerToolResult(tampered), /publicHash|result hash mismatch/);
assert.equal("executeLive" in service, false);
assert.equal("sign" in service, false);
assert.equal("submitPaperOrder" in service, false);

console.log("rmt-mcp Arena career smoke: ok");
