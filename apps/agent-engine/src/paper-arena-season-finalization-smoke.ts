import assert from "node:assert/strict";
import { hashCanonicalPayload, type ParticipantType } from "../../../packages/agent-core/src/index.ts";
import { InMemoryPaperArenaEntryStore } from "./paper-arena-entry-store.ts";
import { InMemoryPaperArenaNetPerformanceStore } from "./paper-arena-net-performance-store.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { buildPaperArenaNetPerformance } from "./paper-arena-net-performance.ts";
import { buildPaperArenaPerformance, type PaperArenaPerformancePolicy } from "./paper-arena-performance.ts";
import {
  InMemoryPaperArenaSeasonFinalizationStore,
  PaperArenaSeasonFinalizationService,
  assertPaperArenaSeasonFinalizationRecord,
  paperArenaSeasonFinalizationSchemaSql,
} from "./paper-arena-season-finalization.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const humanWallet = "0x00000000000000000000000000000000000000cc";
const streamId = "arena-finalization";
const seasonId = "season-finalization";
const seasonEndsAt = 500;
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
  snapshot.seasons = [{ seasonId, name: "Finalization", startsAt: 0, endsAt: seasonEndsAt, createdAt: 0 }];
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
    operation: "finalizationEntry",
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
      operation: "finalizationValuation",
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
  participantId: "agent-final",
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000030" }, { at: 300, nav: "1000030" }],
});
const agentFinal = await makeNetPerformance({
  participantType: "AGENT",
  participantId: "agent-final",
  navs: [{ at: 100, nav: startingNav }, { at: 300, nav: "1000040" }, { at: 480, nav: "1000050" }],
});
const humanFinal = await makeNetPerformance({
  participantType: "HUMAN",
  participantId: humanWallet,
  navs: [{ at: 100, nav: startingNav }, { at: 300, nav: "1000030" }, { at: 480, nav: "1000040" }],
});
const humanLateInserted = await makeNetPerformance({
  participantType: "HUMAN",
  participantId: humanWallet,
  navs: [{ at: 100, nav: startingNav }, { at: 300, nav: "1000040" }, { at: 490, nav: "1000060" }],
});

const entryStore = new InMemoryPaperArenaEntryStore();
await entryStore.put(agentFinal.basePerformance.entry);
await entryStore.put(humanFinal.basePerformance.entry);
const performanceStore = new InMemoryPaperArenaNetPerformanceStore();
const finalizationStore = new InMemoryPaperArenaSeasonFinalizationStore();
const service = new PaperArenaSeasonFinalizationService({
  entryStore,
  performanceStore,
  finalizationStore,
  streamId,
  policy: { policyVersion: "RMT_ARENA_FINAL_V1", maximumFinalPerformanceLagMs: 50 },
});

await performanceStore.put(agentOld);
await performanceStore.put(agentFinal);
await assert.rejects(
  () => service.finalize(seasonId, 510),
  /complete eligible Human and Agent results/,
);
await performanceStore.put(humanFinal);
await assert.rejects(
  () => service.finalize(seasonId, 499),
  /before season end/,
);

const finalization = await service.finalize(seasonId, 510);
assert.equal(finalization.winner, "AGENT");
assert.equal(finalization.seasonEndsAt, seasonEndsAt);
assert.equal(finalization.finalPerformances.length, 2);
assert.equal(finalization.finalPerformances.find((record) => record.basePerformance.entry.participantType === "AGENT")?.capturedAt, 480);
assert.equal(finalization.finalPerformances.find((record) => record.basePerformance.entry.participantType === "HUMAN")?.capturedAt, 480);
assert.doesNotThrow(() => assertPaperArenaSeasonFinalizationRecord(finalization));

await performanceStore.put(humanLateInserted);
const latestAsOfEnd = await performanceStore.listLatestSeasonAtOrBefore(streamId, seasonId, seasonEndsAt);
assert.equal(latestAsOfEnd.find((record) => record.basePerformance.entry.participantType === "HUMAN")?.capturedAt, 490);
assert.equal(latestAsOfEnd.find((record) => record.basePerformance.entry.participantType === "HUMAN")?.metrics.netReturnQuoteAtomic, "60");
const replay = await service.finalize(seasonId, 520);
assert.equal(replay.finalizationHash, finalization.finalizationHash);
assert.equal(replay.winner, "AGENT");
assert.equal(replay.finalizedAt, 510);

const lagEntryStore = new InMemoryPaperArenaEntryStore();
await lagEntryStore.put(agentOld.basePerformance.entry);
await lagEntryStore.put((await makeNetPerformance({
  participantType: "HUMAN",
  participantId: "0x00000000000000000000000000000000000000dd",
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000020" }, { at: 300, nav: "1000020" }],
})).basePerformance.entry);
const lagPerformanceStore = new InMemoryPaperArenaNetPerformanceStore();
await lagPerformanceStore.put(agentOld);
const humanOld = await makeNetPerformance({
  participantType: "HUMAN",
  participantId: "0x00000000000000000000000000000000000000dd",
  navs: [{ at: 100, nav: startingNav }, { at: 200, nav: "1000020" }, { at: 300, nav: "1000020" }],
});
await lagPerformanceStore.put(humanOld);
await assert.rejects(
  () => new PaperArenaSeasonFinalizationService({
    entryStore: lagEntryStore,
    performanceStore: lagPerformanceStore,
    finalizationStore: new InMemoryPaperArenaSeasonFinalizationStore(),
    streamId,
    policy: { policyVersion: "RMT_ARENA_FINAL_V1", maximumFinalPerformanceLagMs: 50 },
  }).finalize(seasonId, 510),
  /too far before season end/,
);

const tampered = structuredClone(finalization);
tampered.winner = "HUMAN";
assert.throws(() => assertPaperArenaSeasonFinalizationRecord(tampered), /winner mismatch|hash mismatch/);
assert.match(paperArenaSeasonFinalizationSchemaSql, /PRIMARY KEY \(stream_id, season_id\)/);
assert.match(paperArenaSeasonFinalizationSchemaSql, /winner IN \('AGENT','HUMAN','TIE'\)/);

console.log("paper-arena-season-finalization smoke: ok");
