import assert from "node:assert/strict";
import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaCareerReputationRecord,
  type PaperArenaCareerReputationRecord,
  type PaperArenaCareerSeasonRecord,
} from "./paper-arena-career-reputation.ts";
import {
  PaperArenaPublicCareerProfileService,
  assertPaperArenaPublicCareerProfile,
  type PaperArenaCareerReputationReader,
} from "./paper-arena-public-career-profile.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const streamId = "public-career";
const agentId = "agent-career-public";
const humanId = "0x00000000000000000000000000000000000000aa";
const ownerAddress = "0x00000000000000000000000000000000000000ff";
const privateThesis = "Never expose this private Agent thesis through career reads.";
const quoteOne = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const quoteTwo = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const h = (char: string) => `0x${char.repeat(64)}`;

function makeCareer(type: "AGENT" | "HUMAN", participantId: string): PaperArenaCareerReputationRecord {
  const seasons: PaperArenaCareerSeasonRecord[] = [
    {
      seasonId: "season-1",
      seasonEndsAt: 500,
      finalizedAt: 510,
      participantType: type,
      participantId,
      teamWinner: type,
      teamOutcome: "WIN",
      overallRank: 1,
      divisionRank: 1,
      quoteAssetId: quoteOne,
      netReturnQuoteAtomic: "50000",
      netReturnBps: "500",
      maxDrawdownBps: 100,
      fillCount: 4,
      finalizationHash: h("1"),
      performanceHash: h("2"),
    },
    {
      seasonId: "season-2",
      seasonEndsAt: 1000,
      finalizedAt: 1010,
      participantType: type,
      participantId,
      teamWinner: type === "AGENT" ? "HUMAN" : "AGENT",
      teamOutcome: "LOSS",
      overallRank: 2,
      divisionRank: 1,
      quoteAssetId: quoteTwo,
      netReturnQuoteAtomic: "20000",
      netReturnBps: "200",
      maxDrawdownBps: 250,
      fillCount: 3,
      finalizationHash: h("3"),
      performanceHash: h("4"),
    },
  ];
  const payload: Omit<PaperArenaCareerReputationRecord, "reputationHash"> = {
    schemaVersion: 1,
    streamId,
    participantType: type,
    participantId,
    summary: {
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
    seasons,
    archiveDigest: h("5"),
  };
  const record: PaperArenaCareerReputationRecord = { ...payload, reputationHash: hashCanonicalPayload(payload) };
  assertPaperArenaCareerReputationRecord(record);
  return record;
}

const agentCareer = makeCareer("AGENT", agentId);
const humanCareer = makeCareer("HUMAN", humanId);

class CareerReader implements PaperArenaCareerReputationReader {
  async read(input: { participantType: "AGENT" | "HUMAN"; participantId: string }): Promise<PaperArenaCareerReputationRecord> {
    return structuredClone(input.participantType === "AGENT" ? agentCareer : humanCareer);
  }
}

const stateStore = new InMemoryAgentStateStore();
const snapshot = emptyAgentEngineSnapshot();
snapshot.agents = [{
  id: agentId,
  ownerAddress,
  name: "HoodHound",
  thesis: privateThesis,
  performanceState: "QUALIFIED",
  executionMode: "PAPER_ONLY",
  createdAt: 100,
}];
await stateStore.commit({
  streamId,
  expectedRevision: 0,
  idempotencyKey: "career-state",
  operation: "careerState",
  requestHash: hashCanonicalPayload({ agentId }),
  result: { ok: true },
  snapshot,
  createdAt: 200,
});

const service = new PaperArenaPublicCareerProfileService({ careerReader: new CareerReader(), stateStore, streamId });
const agentProfile = await service.read({ participantType: "AGENT", participantId: agentId });
assert.equal(agentProfile.identity.displayName, "HoodHound");
assert.equal(agentProfile.identity.agentLifecycleState, "QUALIFIED");
assert.equal(agentProfile.identity.createdAt, 100);
assert.equal(agentProfile.career.seasonsCompleted, 2);
assert.equal(agentProfile.career.teamWins, 1);
assert.equal(agentProfile.career.overallWins, 1);
assert.equal(agentProfile.career.sumNetReturnBps, "700");
assert.equal(agentProfile.seasons.length, 2);
assert.doesNotThrow(() => assertPaperArenaPublicCareerProfile(agentProfile));

const humanProfile = await service.read({ participantType: "HUMAN", participantId: humanId.toUpperCase().replace("0X", "0x") });
assert.equal(humanProfile.participantId, humanId);
assert.equal(humanProfile.identity.displayName, null);
assert.equal(humanProfile.identity.agentLifecycleState, null);
assert.equal(humanProfile.identity.createdAt, null);
assert.equal(humanProfile.career.seasonsCompleted, 2);
assert.doesNotThrow(() => assertPaperArenaPublicCareerProfile(humanProfile));

for (const profile of [agentProfile, humanProfile]) {
  const serialized = JSON.stringify(profile);
  for (const forbidden of [
    ownerAddress,
    privateThesis,
    "ownerAddress",
    "thesis",
    "engineSnapshot",
    "accountSnapshot",
    "balances",
    "strategyHash",
    "modelIdentity",
    "reasoningSummary",
    "quoteEvidence",
    "privateKey",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public career profile leaked forbidden value/field ${forbidden}`);
  }
}

const tampered = structuredClone(agentProfile);
tampered.career.teamWins = 9;
assert.throws(() => assertPaperArenaPublicCareerProfile(tampered), /publicHash|hash mismatch/);

console.log("paper-arena-public-career-profile smoke: ok");
