import assert from "node:assert/strict";
import { hashCanonicalPayload, type ParticipantType } from "../../../packages/agent-core/src/index.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import {
  buildPaperArenaNetLeaderboard,
  assertPaperArenaNetLeaderboardRecord,
} from "./paper-arena-net-leaderboard.ts";
import { buildPaperArenaNetPerformance } from "./paper-arena-net-performance.ts";
import {
  buildPaperArenaPerformance,
  type PaperArenaPerformancePolicy,
} from "./paper-arena-performance.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const humanWallet = "0x00000000000000000000000000000000000000bb";
const performancePolicy: PaperArenaPerformancePolicy = {
  policyVersion: "RMT_ARENA_PERFORMANCE_V1",
  minimumValuations: 3,
  minimumElapsedMs: 200,
};

type NavPoint = { at: number; nav: string };

async function makeNetPerformance(input: {
  participantType: ParticipantType;
  participantId: string;
  navs: NavPoint[];
}) {
  const startingNav = "1000000";
  const seasonId = "season-net";
  const streamId = "paper-arena-net";
  const accountId = `account-${input.participantType.toLowerCase()}-${input.participantId}`;
  const snapshot = emptyAgentEngineSnapshot();
  snapshot.seasons = [{ seasonId, name: "Net Arena", startsAt: 0, endsAt: 10_000, createdAt: 0 }];
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
    requestHash: hashCanonicalPayload({ participantType: input.participantType, participantId: input.participantId, stage: "entry" }),
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
    const next = structuredClone(snapshot);
    next.paperAccounts[0]!.balances[quoteAssetId] = point.nav;
    await store.commit({
      streamId,
      expectedRevision: revision,
      idempotencyKey: `valuation:${input.participantType}:${input.participantId}:${index}`,
      operation: "arenaValuationFixture",
      requestHash: hashCanonicalPayload({ participantType: input.participantType, participantId: input.participantId, index, nav: point.nav }),
      result: { nav: point.nav },
      snapshot: next,
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
  const basePerformance = buildPaperArenaPerformance({ entry, valuations, policy: performancePolicy });
  return buildPaperArenaNetPerformance({ basePerformance });
}

const exact41 = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-41",
  navs: [{ at: 100, nav: "1000000" }, { at: 200, nav: "1000041" }, { at: 300, nav: "1000041" }],
});
const exact40 = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-40",
  navs: [{ at: 100, nav: "1000000" }, { at: 200, nav: "1000040" }, { at: 300, nav: "1000040" }],
});
const human = await makeNetPerformance({
  participantType: "HUMAN",
  participantId: humanWallet,
  navs: [{ at: 100, nav: "1000000" }, { at: 200, nav: "1000030" }, { at: 300, nav: "1000030" }],
});
const provisional = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-provisional",
  navs: [{ at: 100, nav: "1000000" }],
});

assert.equal(exact41.metrics.netReturnQuoteAtomic, "41");
assert.equal(exact40.metrics.netReturnQuoteAtomic, "40");
assert.equal(exact41.metrics.netReturnBps, "0");
assert.equal(exact40.metrics.netReturnBps, "0");

const overall = buildPaperArenaNetLeaderboard({ netPerformances: [human, exact40, provisional, exact41] });
assert.equal(overall.rankedEntries.length, 3);
assert.equal(overall.rankedEntries[0]?.participantId, "agent-41");
assert.equal(overall.rankedEntries[1]?.participantId, "agent-40");
assert.equal(overall.rankedEntries[2]?.participantId, humanWallet);
assert.equal(overall.provisionalEntries.length, 1);
assert.equal(overall.provisionalEntries[0]?.participantId, "agent-provisional");
assert.doesNotThrow(() => assertPaperArenaNetLeaderboardRecord(overall));

const humanView = buildPaperArenaNetLeaderboard({ netPerformances: [human, exact40, provisional, exact41], view: "HUMAN" });
assert.equal(humanView.rankedEntries.length, 1);
assert.equal(humanView.rankedEntries[0]?.participantId, humanWallet);
assert.equal(humanView.provisionalEntries.length, 0);

const agentView = buildPaperArenaNetLeaderboard({ netPerformances: [human, exact40, provisional, exact41], view: "AGENT" });
assert.equal(agentView.rankedEntries.length, 2);
assert.equal(agentView.provisionalEntries.length, 1);
assert.ok(agentView.rankedEntries.every((entry) => entry.participantType === "AGENT"));

assert.throws(
  () => buildPaperArenaNetLeaderboard({ netPerformances: [exact41, exact41] }),
  /duplicate participant performance/,
);

const tampered = structuredClone(overall);
tampered.rankedEntries[0]!.rank = 2;
tampered.leaderboardHash = hashCanonicalPayload((() => {
  const { leaderboardHash: _hash, ...payload } = tampered;
  return payload;
})());
assert.throws(
  () => assertPaperArenaNetLeaderboardRecord(tampered),
  /ranks are not contiguous|payload is not correctly derived/,
);

console.log("paper-arena-net-leaderboard smoke: ok");
