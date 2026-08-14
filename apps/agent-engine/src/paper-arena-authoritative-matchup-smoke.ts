import assert from "node:assert/strict";
import { hashCanonicalPayload, type ParticipantType } from "../../../packages/agent-core/src/index.ts";
import {
  PaperArenaAuthoritativeMatchupService,
  assertPaperArenaAuthoritativeMatchupRecord,
} from "./paper-arena-authoritative-matchup.ts";
import { InMemoryPaperArenaEntryStore } from "./paper-arena-entry-store.ts";
import { InMemoryPaperArenaNetPerformanceStore, paperArenaNetPerformanceStoreSchemaSql } from "./paper-arena-net-performance-store.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { buildPaperArenaNetPerformance } from "./paper-arena-net-performance.ts";
import { buildPaperArenaPerformance, type PaperArenaPerformancePolicy } from "./paper-arena-performance.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const humanWallet = "0x00000000000000000000000000000000000000bb";
const streamId = "arena-authoritative-matchup";
const seasonId = "season-authoritative";
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
  snapshot.seasons = [{ seasonId, name: "Authoritative Matchup", startsAt: 0, endsAt: 10_000, createdAt: 0 }];
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
    operation: "authoritativeMatchupEntry",
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
      idempotencyKey: `valuation:${input.participantType}:${input.participantId}:${index}:${point.at}:${point.nav}`,
      operation: "authoritativeMatchupValuation",
      requestHash: hashCanonicalPayload({ participantType: input.participantType, participantId: input.participantId, index, point }),
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

const agentOld = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-authoritative",
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000040" }, { at: 300, nav: "1000040" }],
});
const agentNew = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-authoritative",
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000040" }, { at: 400, nav: "1000050" }],
});
const agentConflictSameTimestamp = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-authoritative",
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000040" }, { at: 400, nav: "1000049" }],
});
const human = await makeNetPerformance({
  participantType: "HUMAN",
  participantId: humanWallet,
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000030" }, { at: 300, nav: "1000030" }],
});

const entryStore = new InMemoryPaperArenaEntryStore();
await entryStore.put(agentOld.basePerformance.entry);
await entryStore.put(human.basePerformance.entry);
const performanceStore = new InMemoryPaperArenaNetPerformanceStore();
const matchupService = new PaperArenaAuthoritativeMatchupService({ entryStore, performanceStore, streamId });

await performanceStore.put(agentOld);
let snapshot = await matchupService.snapshot(seasonId);
assert.equal(snapshot.matchup.status, "PROVISIONAL");
assert.equal(snapshot.matchup.winner, null);
assert.deepEqual(snapshot.matchup.humanTeam.missingParticipantIds, [humanWallet]);
assert.equal(snapshot.latestNetPerformances.length, 1);
assert.doesNotThrow(() => assertPaperArenaAuthoritativeMatchupRecord(snapshot));

await performanceStore.put(human);
snapshot = await matchupService.snapshot(seasonId);
assert.equal(snapshot.matchup.status, "FINALIZABLE");
assert.equal(snapshot.matchup.winner, "AGENT");
assert.equal(snapshot.matchup.agentTeam.sumNetReturnQuoteAtomic, "40");
assert.equal(snapshot.matchup.humanTeam.sumNetReturnQuoteAtomic, "30");

await performanceStore.put(agentNew);
snapshot = await matchupService.snapshot(seasonId);
assert.equal(snapshot.matchup.winner, "AGENT");
assert.equal(snapshot.matchup.agentTeam.sumNetReturnQuoteAtomic, "50");
assert.equal(snapshot.latestNetPerformances.find((record) => record.basePerformance.entry.participantType === "AGENT")?.capturedAt, 400);
const digestAfterNew = snapshot.latestPerformanceDigest;

await performanceStore.put(agentOld);
const afterOldReplay = await matchupService.snapshot(seasonId);
assert.equal(afterOldReplay.latestPerformanceDigest, digestAfterNew);
assert.equal(afterOldReplay.matchup.agentTeam.sumNetReturnQuoteAtomic, "50");

await assert.rejects(
  () => performanceStore.put(agentConflictSameTimestamp),
  /timestamp already contains different evidence/,
);
assert.equal((await performanceStore.latestForParticipant({
  streamId,
  seasonId,
  participantType: "AGENT",
  participantId: "agent-authoritative",
}))?.netPerformanceHash, agentNew.netPerformanceHash);

const tampered = structuredClone(afterOldReplay);
tampered.matchup.winner = "HUMAN";
tampered.snapshotHash = hashCanonicalPayload((() => {
  const { snapshotHash: _hash, ...payload } = tampered;
  return payload;
})());
assert.throws(
  () => assertPaperArenaAuthoritativeMatchupRecord(tampered),
  /not correctly derived|payload is not correctly derived/,
);

assert.match(paperArenaNetPerformanceStoreSchemaSql, /PRIMARY KEY \(stream_id, season_id, participant_type, participant_id, captured_at_ms\)/);
assert.match(paperArenaNetPerformanceStoreSchemaSql, /captured_at_ms DESC/);

console.log("paper-arena-authoritative-matchup smoke: ok");
