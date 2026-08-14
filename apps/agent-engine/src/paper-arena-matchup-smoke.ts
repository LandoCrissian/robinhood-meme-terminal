import assert from "node:assert/strict";
import { hashCanonicalPayload, type ParticipantType } from "../../../packages/agent-core/src/index.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import {
  buildPaperArenaMatchup,
  assertPaperArenaMatchupRecord,
} from "./paper-arena-matchup.ts";
import type { PaperArenaRosterRecord } from "./paper-arena-roster.ts";
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
const streamId = "arena-matchup";
const seasonId = "season-matchup";
const startingNav = "1000000";
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
  const accountId = `account-${input.participantType.toLowerCase()}-${input.participantId}`;
  const snapshot = emptyAgentEngineSnapshot();
  snapshot.seasons = [{ seasonId, name: "Matchup", startsAt: 0, endsAt: 10_000, createdAt: 0 }];
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
    operation: "matchupEntry",
    requestHash: hashCanonicalPayload({ participantType: input.participantType, participantId: input.participantId }),
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
      operation: "matchupValuation",
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
  return buildPaperArenaNetPerformance({
    basePerformance: buildPaperArenaPerformance({ entry, valuations, policy: performancePolicy }),
  });
}

const agentPerformance = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-matchup",
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000040" }, { at: 300, nav: "1000040" }],
});
const humanPerformance = await makeNetPerformance({
  participantType: "HUMAN",
  participantId: humanWallet,
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000030" }, { at: 300, nav: "1000030" }],
});

const entries = [agentPerformance.basePerformance.entry, humanPerformance.basePerformance.entry];
const rosterPayload: Omit<PaperArenaRosterRecord, "rosterHash"> = {
  schemaVersion: 1,
  streamId,
  seasonId,
  quoteAssetId,
  startingNavQuoteAtomic: startingNav,
  entries,
  agentCount: 1,
  humanCount: 1,
};
const roster: PaperArenaRosterRecord = { ...rosterPayload, rosterHash: hashCanonicalPayload(rosterPayload) };

const provisional = buildPaperArenaMatchup({ roster, netPerformances: [agentPerformance] });
assert.equal(provisional.status, "PROVISIONAL");
assert.equal(provisional.winner, null);
assert.equal(provisional.agentTeam.eligibleCount, 1);
assert.equal(provisional.humanTeam.eligibleCount, 0);
assert.deepEqual(provisional.humanTeam.missingParticipantIds, [humanWallet]);
assert.equal(provisional.agentLeaderboard?.rankedEntries[0]?.participantId, "agent-matchup");
assert.equal(provisional.humanLeaderboard, null);
assert.doesNotThrow(() => assertPaperArenaMatchupRecord(provisional));

const complete = buildPaperArenaMatchup({ roster, netPerformances: [humanPerformance, agentPerformance] });
assert.equal(complete.status, "FINALIZABLE");
assert.equal(complete.winner, "AGENT");
assert.equal(complete.agentTeam.sumNetReturnQuoteAtomic, "40");
assert.equal(complete.humanTeam.sumNetReturnQuoteAtomic, "30");
assert.equal(complete.agentTeam.meanNetReturnQuoteAtomic, "40");
assert.equal(complete.humanTeam.meanNetReturnQuoteAtomic, "30");
assert.equal(complete.overallLeaderboard?.rankedEntries[0]?.participantId, "agent-matchup");
assert.equal(complete.agentLeaderboard?.rankedEntries.length, 1);
assert.equal(complete.humanLeaderboard?.rankedEntries.length, 1);
assert.doesNotThrow(() => assertPaperArenaMatchupRecord(complete));

const tampered = structuredClone(complete);
tampered.winner = "HUMAN";
tampered.matchupHash = hashCanonicalPayload((() => {
  const { matchupHash: _hash, ...payload } = tampered;
  return payload;
})());
assert.throws(() => assertPaperArenaMatchupRecord(tampered), /not correctly derived/);

console.log("paper-arena-matchup smoke: ok");
