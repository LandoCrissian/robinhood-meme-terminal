import assert from "node:assert/strict";
import type { AgentSafetyEnvelope, StrategySpec } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import {
  InMemoryPaperArenaEntryStore,
  paperArenaEntryStoreSchemaSql,
} from "./paper-arena-entry-store.ts";
import {
  PaperArenaRegistrationService,
  PaperArenaRosterService,
  assertPaperArenaRosterRecord,
} from "./paper-arena-roster.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 5_000,
  maximumPortfolioExposureBps: 8_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 1_000,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 300,
  minimumEvaluationIntervalSeconds: 30,
};
const strategy: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"] },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 120 },
  signals: [{ type: "momentum", weight: 1 }],
  prediction: { enabled: true, minimumConfidence: 0.65 },
  risk: {
    maximumPositionBps: 2_500,
    maximumPortfolioExposureBps: 5_000,
    maximumOpenPositions: 5,
    maximumDailyLossBps: 500,
    maximumDrawdownBps: 1_000,
    maximumTradesPerDay: 20,
  },
  execution: { venuePolicy: "RMT_BEST_VERIFIED", maximumSlippageBps: 75, maximumPriceImpactBps: 150 },
  prohibitedActions: ["ARBITRARY_CALL"],
};
const stateStore = new InMemoryAgentStateStore();
const streamId = "arena-roster-smoke";
const engine = await DurableAgentEngine.initialize({
  config: { safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" },
  store: stateStore,
  streamId,
});
await engine.createSeason({ seasonId: "season-1", name: "Human vs Agent", startsAt: 1_000, endsAt: 100_000, createdAt: 900 }, "season");
const agent = await engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Arena Agent",
  thesis: "Compete under canonical Arena rules.",
  createdAt: 1_010,
}, "agent");
await engine.createStrategyVersion(agent.id, strategy, "strategy", 1_020);
await engine.activatePaperAgent(agent.id, "activate");
const agentAccount = await engine.openPaperAccount({
  agentId: agent.id,
  seasonId: "season-1",
  initialBalances: { [quoteAssetId]: "1000" },
  openedAt: 1_100,
}, "agent-account");
const humanAccount = await engine.openHumanPaperAccount({
  walletAddress: "0x00000000000000000000000000000000000000aa",
  seasonId: "season-1",
  initialBalances: { [quoteAssetId]: "1000" },
  openedAt: 1_100,
}, "human-account");

const entryStore = new InMemoryPaperArenaEntryStore();
const registration = new PaperArenaRegistrationService({ stateStore, entryStore, streamId });
const agentEntry = await registration.register({ accountId: agentAccount.accountId, quoteAssetId });
const humanEntry = await registration.register({ accountId: humanAccount.accountId, quoteAssetId });
assert.equal(agentEntry.participantType, "AGENT");
assert.equal(humanEntry.participantType, "HUMAN");
assert.equal(agentEntry.startingNavQuoteAtomic, "1000");
assert.equal(humanEntry.startingNavQuoteAtomic, "1000");

const roster = await new PaperArenaRosterService({ entryStore, streamId }).snapshot("season-1");
assert.equal(roster.agentCount, 1);
assert.equal(roster.humanCount, 1);
assert.equal(roster.entries.length, 2);
assert.equal(roster.quoteAssetId, quoteAssetId);
assert.equal(roster.startingNavQuoteAtomic, "1000");
assert.doesNotThrow(() => assertPaperArenaRosterRecord(roster));

await engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000002",
  name: "Unrelated Mutation",
  thesis: "Advance canonical engine revision without changing Arena registration.",
  createdAt: 1_200,
}, "unrelated-agent");
const agentEntryRetry = await registration.register({ accountId: agentAccount.accountId, quoteAssetId });
assert.equal(agentEntryRetry.entryHash, agentEntry.entryHash);
assert.equal(agentEntryRetry.revision, agentEntry.revision);
assert.equal((await entryStore.listSeason(streamId, "season-1")).length, 2);

await assert.rejects(
  () => registration.register({ accountId: agentAccount.accountId, quoteAssetId: "eip155:4663/native" }),
  /different quote asset/,
);

const tamperedRoster = structuredClone(roster);
tamperedRoster.agentCount = 9;
assert.throws(() => assertPaperArenaRosterRecord(tamperedRoster), /not correctly derived/);
assert.match(paperArenaEntryStoreSchemaSql, /PRIMARY KEY \(stream_id, season_id, participant_type, participant_id\)/);
assert.match(paperArenaEntryStoreSchemaSql, /UNIQUE \(stream_id, account_id\)/);

console.log("paper-arena-roster smoke: ok");
