import assert from "node:assert/strict";
import { hashCanonicalPayload, type ParticipantType } from "../../../packages/agent-core/src/index.ts";
import {
  InMemoryPaperArenaFinalizationArchiveStore,
  paperArenaFinalizationArchiveSchemaSql,
} from "./paper-arena-finalization-archive.ts";
import {
  PaperArenaCareerReputationService,
  assertPaperArenaCareerReputationRecord,
} from "./paper-arena-career-reputation.ts";
import { InMemoryPaperArenaEntryStore } from "./paper-arena-entry-store.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { InMemoryPaperArenaNetPerformanceStore } from "./paper-arena-net-performance-store.ts";
import { buildPaperArenaNetPerformance } from "./paper-arena-net-performance.ts";
import { buildPaperArenaPerformance, type PaperArenaPerformancePolicy } from "./paper-arena-performance.ts";
import {
  InMemoryPaperArenaSeasonFinalizationStore,
  PaperArenaSeasonFinalizationService,
} from "./paper-arena-season-finalization.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const streamId = "arena-career";
const agentId = "agent-career";
const humanId = "0x00000000000000000000000000000000000000aa";
const quoteOne = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const quoteTwo = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const startingNav = "1000000";
const performancePolicy: PaperArenaPerformancePolicy = {
  policyVersion: "RMT_ARENA_PERFORMANCE_V1",
  minimumValuations: 3,
  minimumElapsedMs: 200,
};

type NavPoint = { at: number; nav: string };

async function makeNetPerformance(input: {
  seasonId: string;
  seasonEndsAt: number;
  quoteAssetId: string;
  participantType: ParticipantType;
  participantId: string;
  navs: NavPoint[];
}) {
  const accountId = `${input.seasonId}-${input.participantType.toLowerCase()}-${input.participantId}`;
  const snapshot = emptyAgentEngineSnapshot();
  snapshot.seasons = [{ seasonId: input.seasonId, name: input.seasonId, startsAt: 0, endsAt: input.seasonEndsAt, createdAt: 0 }];
  snapshot.paperAccounts = [{
    accountId,
    seasonId: input.seasonId,
    participantType: input.participantType,
    participantId: input.participantId,
    balances: { [input.quoteAssetId]: startingNav },
    openedAt: 10,
  }];
  const stateStore = new InMemoryAgentStateStore();
  await stateStore.commit({
    streamId,
    expectedRevision: 0,
    idempotencyKey: `entry:${input.seasonId}:${input.participantType}:${input.participantId}`,
    operation: "careerEntry",
    requestHash: hashCanonicalPayload({ seasonId: input.seasonId, participantType: input.participantType, participantId: input.participantId }),
    result: { entered: true },
    snapshot,
    createdAt: 20,
  });
  const entry = await new PaperArenaEntryService({ store: stateStore, streamId }).enter({ accountId, quoteAssetId: input.quoteAssetId });
  const valuationService = new PaperCanonicalValuationService({ store: stateStore, streamId });
  const valuations = [];
  let revision = 1;
  for (let index = 0; index < input.navs.length; index += 1) {
    const point = input.navs[index]!;
    const next = structuredClone(snapshot);
    next.paperAccounts[0]!.balances[input.quoteAssetId] = point.nav;
    await stateStore.commit({
      streamId,
      expectedRevision: revision,
      idempotencyKey: `valuation:${input.seasonId}:${input.participantType}:${input.participantId}:${index}`,
      operation: "careerValuation",
      requestHash: hashCanonicalPayload({ seasonId: input.seasonId, participantType: input.participantType, participantId: input.participantId, index, point }),
      result: point,
      snapshot: next,
      createdAt: point.at,
    });
    revision += 1;
    valuations.push(await valuationService.value({
      accountId,
      quoteAssetId: input.quoteAssetId,
      quoteResults: [],
      valuedAt: point.at,
      maximumQuoteAgeMs: 100,
    }));
  }
  return buildPaperArenaNetPerformance({
    basePerformance: buildPaperArenaPerformance({ entry, valuations, policy: performancePolicy }),
  });
}

async function finalizeSeason(input: {
  seasonId: string;
  seasonEndsAt: number;
  quoteAssetId: string;
  agentFinalNav: string;
  humanFinalNav: string;
}) {
  const agent = await makeNetPerformance({
    seasonId: input.seasonId,
    seasonEndsAt: input.seasonEndsAt,
    quoteAssetId: input.quoteAssetId,
    participantType: "AGENT",
    participantId: agentId,
    navs: [{ at: 100, nav: startingNav }, { at: input.seasonEndsAt - 100, nav: input.agentFinalNav }, { at: input.seasonEndsAt - 20, nav: input.agentFinalNav }],
  });
  const human = await makeNetPerformance({
    seasonId: input.seasonId,
    seasonEndsAt: input.seasonEndsAt,
    quoteAssetId: input.quoteAssetId,
    participantType: "HUMAN",
    participantId: humanId,
    navs: [{ at: 100, nav: startingNav }, { at: input.seasonEndsAt - 100, nav: input.humanFinalNav }, { at: input.seasonEndsAt - 20, nav: input.humanFinalNav }],
  });
  const entryStore = new InMemoryPaperArenaEntryStore();
  await entryStore.put(agent.basePerformance.entry);
  await entryStore.put(human.basePerformance.entry);
  const performanceStore = new InMemoryPaperArenaNetPerformanceStore();
  await performanceStore.put(agent);
  await performanceStore.put(human);
  return new PaperArenaSeasonFinalizationService({
    entryStore,
    performanceStore,
    finalizationStore: new InMemoryPaperArenaSeasonFinalizationStore(),
    streamId,
    policy: { policyVersion: "RMT_ARENA_FINAL_V1", maximumFinalPerformanceLagMs: 50 },
  }).finalize(input.seasonId, input.seasonEndsAt + 10);
}

const seasonOne = await finalizeSeason({
  seasonId: "season-1",
  seasonEndsAt: 500,
  quoteAssetId: quoteOne,
  agentFinalNav: "1050000",
  humanFinalNav: "1030000",
});
const seasonTwo = await finalizeSeason({
  seasonId: "season-2",
  seasonEndsAt: 1000,
  quoteAssetId: quoteTwo,
  agentFinalNav: "1020000",
  humanFinalNav: "1060000",
});
assert.equal(seasonOne.winner, "AGENT");
assert.equal(seasonTwo.winner, "HUMAN");

const archive = new InMemoryPaperArenaFinalizationArchiveStore();
await archive.put(seasonTwo);
await archive.put(seasonOne);
assert.equal((await archive.list(streamId))[0]?.seasonId, "season-1");
assert.equal((await archive.list(streamId))[1]?.seasonId, "season-2");
assert.equal((await archive.put(seasonOne)).finalizationHash, seasonOne.finalizationHash);

const service = new PaperArenaCareerReputationService({ archive, streamId });
const agentCareer = await service.read({ participantType: "AGENT", participantId: agentId });
assert.equal(agentCareer.summary.seasonsCompleted, 2);
assert.equal(agentCareer.summary.teamWins, 1);
assert.equal(agentCareer.summary.teamLosses, 1);
assert.equal(agentCareer.summary.teamTies, 0);
assert.equal(agentCareer.summary.divisionWins, 2);
assert.equal(agentCareer.summary.overallWins, 1);
assert.equal(agentCareer.summary.podiumFinishes, 2);
assert.equal(agentCareer.summary.bestOverallRank, 1);
assert.equal(agentCareer.summary.currentTeamWinStreak, 0);
assert.equal(agentCareer.summary.longestTeamWinStreak, 1);
assert.equal(agentCareer.summary.sumNetReturnBps, "700");
assert.equal(agentCareer.summary.latestSeasonId, "season-2");
assert.deepEqual(agentCareer.netReturnQuoteAtomicByAsset, { [quoteOne]: "50000", [quoteTwo]: "20000" });
assert.equal(agentCareer.seasons[0]?.teamOutcome, "WIN");
assert.equal(agentCareer.seasons[1]?.teamOutcome, "LOSS");
assert.doesNotThrow(() => assertPaperArenaCareerReputationRecord(agentCareer));

const humanCareer = await service.read({ participantType: "HUMAN", participantId: humanId.toUpperCase().replace("0X", "0x") });
assert.equal(humanCareer.participantId, humanId);
assert.equal(humanCareer.summary.teamWins, 1);
assert.equal(humanCareer.summary.teamLosses, 1);
assert.equal(humanCareer.summary.overallWins, 1);
assert.equal(humanCareer.summary.sumNetReturnBps, "900");
assert.deepEqual(humanCareer.netReturnQuoteAtomicByAsset, { [quoteOne]: "30000", [quoteTwo]: "60000" });
assert.doesNotThrow(() => assertPaperArenaCareerReputationRecord(humanCareer));

await assert.rejects(
  () => service.read({ participantType: "AGENT", participantId: "agent-never-finalized" }),
  /no finalized career history/,
);

const tampered = structuredClone(agentCareer);
tampered.summary.teamWins = 9;
tampered.reputationHash = hashCanonicalPayload((() => {
  const { reputationHash: _hash, ...payload } = tampered;
  return payload;
})());
assert.throws(() => assertPaperArenaCareerReputationRecord(tampered), /summary is not correctly derived/);

assert.match(paperArenaFinalizationArchiveSchemaSql, /PRIMARY KEY \(stream_id, season_id\)/);
assert.match(paperArenaFinalizationArchiveSchemaSql, /season_ends_at_ms ASC/);

console.log("paper-arena-career-reputation smoke: ok");
