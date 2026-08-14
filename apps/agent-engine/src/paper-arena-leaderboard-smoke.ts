import assert from "node:assert/strict";
import type { ParticipantType } from "../../../packages/agent-core/src/index.ts";
import {
  buildPaperArenaLeaderboard,
  assertPaperArenaLeaderboardRecord,
} from "./paper-arena-leaderboard.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import {
  buildPaperArenaPerformance,
  type PaperArenaPerformancePolicy,
  type PaperArenaPerformanceRecord,
} from "./paper-arena-performance.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const performancePolicy: PaperArenaPerformancePolicy = {
  policyVersion: "RMT_ARENA_PERFORMANCE_V1",
  minimumValuations: 3,
  minimumElapsedMs: 200,
};

type NavPoint = { at: number; nav: string };

async function makePerformance(input: {
  participantType: ParticipantType;
  participantId: string;
  navs: NavPoint[];
  startingNav?: string;
  seasonId?: string;
  policy?: PaperArenaPerformancePolicy;
}): Promise<PaperArenaPerformanceRecord> {
  const startingNav = input.startingNav ?? "1000";
  const seasonId = input.seasonId ?? "season-1";
  const accountId = `account-${input.participantType.toLowerCase()}-${input.participantId}`;
  const streamId = "paper-arena";
  const snapshot = emptyAgentEngineSnapshot();
  snapshot.seasons = [{ seasonId, name: seasonId, startsAt: 0, endsAt: 10_000, createdAt: 0 }];
  snapshot.paperAccounts = [{
    accountId,
    seasonId,
    participantType: input.participantType,
    participantId: input.participantId,
    balances: { [quoteAssetId]: startingNav },
    openedAt: 10,
  }];
  const store = new InMemoryAgentStateStore();
  await store.commit({
    streamId,
    expectedRevision: 0,
    idempotencyKey: `entry:${input.participantType}:${input.participantId}`,
    operation: "arenaEntry",
    requestHash: `0x${"1".repeat(64)}`,
    result: { entered: true },
    snapshot,
    createdAt: 20,
  });
  const entry = await new PaperArenaEntryService({ store, streamId }).enter({ accountId, quoteAssetId });
  const valuationService = new PaperCanonicalValuationService({ store, streamId });
  const valuations = [];
  let revision = 1;
  for (let index = 0; index < input.navs.length; index += 1) {
    const point = input.navs[index]!;
    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.paperAccounts[0]!.balances[quoteAssetId] = point.nav;
    await store.commit({
      streamId,
      expectedRevision: revision,
      idempotencyKey: `valuation:${input.participantType}:${input.participantId}:${index}`,
      operation: "arenaValuationFixture",
      requestHash: `0x${String((index + 2) % 10).repeat(64)}`,
      result: { nav: point.nav },
      snapshot: nextSnapshot,
      createdAt: point.at,
    });
    revision += 1;
    valuations.push(await valuationService.value({
      accountId,
      quoteAssetId,
      quoteResults: [],
      valuedAt: point.at,
      maximumQuoteAgeMs: 100,
    }));
  }
  return buildPaperArenaPerformance({ entry, valuations, policy: input.policy ?? performancePolicy });
}

const agentLowDrawdown = await makePerformance({
  participantType: "AGENT",
  participantId: "agent-b",
  navs: [{ at: 100, nav: "1000" }, { at: 200, nav: "1040" }, { at: 300, nav: "1040" }],
});
const agentHigherDrawdown = await makePerformance({
  participantType: "AGENT",
  participantId: "agent-a",
  navs: [{ at: 100, nav: "1000" }, { at: 200, nav: "1050" }, { at: 300, nav: "1040" }],
});
const human = await makePerformance({
  participantType: "HUMAN",
  participantId: "human-a",
  navs: [{ at: 100, nav: "1000" }, { at: 200, nav: "1030" }, { at: 300, nav: "1030" }],
});
const provisional = await makePerformance({
  participantType: "AGENT",
  participantId: "agent-provisional",
  navs: [{ at: 100, nav: "1000" }],
});

assert.equal(agentLowDrawdown.metrics.returnBpsExcludingExternalCosts, "400");
assert.equal(agentLowDrawdown.metrics.maxDrawdownBps, 0);
assert.equal(agentHigherDrawdown.metrics.returnBpsExcludingExternalCosts, "400");
assert.ok(agentHigherDrawdown.metrics.maxDrawdownBps > 0);
assert.equal(human.metrics.returnBpsExcludingExternalCosts, "300");
assert.equal(provisional.eligibility, "PROVISIONAL");

const overall = buildPaperArenaLeaderboard({
  performances: [human, provisional, agentHigherDrawdown, agentLowDrawdown],
});
assert.equal(overall.view, "OVERALL");
assert.equal(overall.rankedEntries.length, 3);
assert.equal(overall.rankedEntries[0]?.participantId, "agent-b");
assert.equal(overall.rankedEntries[0]?.rank, 1);
assert.equal(overall.rankedEntries[1]?.participantId, "agent-a");
assert.equal(overall.rankedEntries[2]?.participantId, "human-a");
assert.equal(overall.provisionalEntries.length, 1);
assert.equal(overall.provisionalEntries[0]?.participantId, "agent-provisional");
assert.match(overall.leaderboardHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperArenaLeaderboardRecord(overall));

const agentView = buildPaperArenaLeaderboard({
  performances: [human, provisional, agentHigherDrawdown, agentLowDrawdown],
  view: "AGENT",
});
assert.equal(agentView.rankedEntries.length, 2);
assert.ok(agentView.rankedEntries.every((entry) => entry.participantType === "AGENT"));
assert.equal(agentView.provisionalEntries.length, 1);

const humanView = buildPaperArenaLeaderboard({
  performances: [human, provisional, agentHigherDrawdown, agentLowDrawdown],
  view: "HUMAN",
});
assert.equal(humanView.rankedEntries.length, 1);
assert.equal(humanView.rankedEntries[0]?.participantType, "HUMAN");
assert.equal(humanView.provisionalEntries.length, 0);

assert.throws(
  () => buildPaperArenaLeaderboard({ performances: [agentLowDrawdown, agentLowDrawdown] }),
  /duplicate participant performance/,
);

const differentCapital = await makePerformance({
  participantType: "AGENT",
  participantId: "agent-capital",
  startingNav: "2000",
  navs: [{ at: 100, nav: "2000" }, { at: 200, nav: "2080" }, { at: 300, nav: "2080" }],
});
assert.throws(
  () => buildPaperArenaLeaderboard({ performances: [agentLowDrawdown, differentCapital] }),
  /mixed starting capital/,
);

const differentSeason = await makePerformance({
  participantType: "AGENT",
  participantId: "agent-season",
  seasonId: "season-2",
  navs: [{ at: 100, nav: "1000" }, { at: 200, nav: "1040" }, { at: 300, nav: "1040" }],
});
assert.throws(
  () => buildPaperArenaLeaderboard({ performances: [agentLowDrawdown, differentSeason] }),
  /mixed seasons/,
);

const differentPolicy = await makePerformance({
  participantType: "AGENT",
  participantId: "agent-policy",
  navs: [{ at: 100, nav: "1000" }, { at: 200, nav: "1040" }, { at: 300, nav: "1040" }],
  policy: { ...performancePolicy, minimumElapsedMs: 100 },
});
assert.throws(
  () => buildPaperArenaLeaderboard({ performances: [agentLowDrawdown, differentPolicy] }),
  /mixed performance policies/,
);

const tamperedRank = structuredClone(overall);
tamperedRank.rankedEntries[0]!.rank = 2;
assert.throws(() => assertPaperArenaLeaderboardRecord(tamperedRank), /ranks are not unique\/contiguous|ranks are not contiguous|leaderboard hash mismatch/);

const tamperedHash = structuredClone(overall);
tamperedHash.rankedEntries[0]!.returnBpsExcludingExternalCosts = "9999";
assert.throws(() => assertPaperArenaLeaderboardRecord(tamperedHash), /leaderboard hash mismatch/);

console.log("paper-arena-leaderboard smoke: ok");
