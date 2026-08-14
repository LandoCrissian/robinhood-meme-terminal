import assert from "node:assert/strict";
import type { AgentSafetyEnvelope, StrategySpec } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 1_000,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 500,
  minimumEvaluationIntervalSeconds: 30,
};

const strategy: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"] },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 86_400 },
  signals: [{ type: "momentum", weight: 1 }],
  prediction: { enabled: true, minimumConfidence: 0.65 },
  risk: {
    maximumPositionBps: 500,
    maximumPortfolioExposureBps: 2_500,
    maximumOpenPositions: 5,
    maximumDailyLossBps: 300,
    maximumDrawdownBps: 1_000,
    maximumTradesPerDay: 20,
  },
  execution: { venuePolicy: "RMT_BEST_VERIFIED", maximumSlippageBps: 100, maximumPriceImpactBps: 250 },
  prohibitedActions: ["ARBITRARY_CALL", "UNVERIFIED_VENUE"],
};

const config = { safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" };
const store = new InMemoryAgentStateStore();
const streamId = "human-arena-smoke";
const engine = await DurableAgentEngine.initialize({ config, store, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Human vs Agent", startsAt: 1_000, endsAt: 100_000, createdAt: 900 }, "season-1");

const humanInput = {
  walletAddress: "0xAbCdEf0000000000000000000000000000001234",
  seasonId: "season-1",
  initialBalances: { USDG: "1000000000" },
  openedAt: 1_100,
};
const human = await engine.openHumanPaperAccount(humanInput, "human-account-1");
assert.equal(human.participantType, "HUMAN");
assert.equal(human.participantId, "0xabcdef0000000000000000000000000000001234");
assert.equal(human.balances.USDG, "1000000000");

const replay = await engine.openHumanPaperAccount(humanInput, "human-account-1");
assert.equal(replay.accountId, human.accountId);
await assert.rejects(
  () => engine.openHumanPaperAccount(humanInput, "human-account-duplicate"),
  /human already has a paper account for season/,
);

const restored = await DurableAgentEngine.initialize({ config, store, streamId });
assert.deepEqual(restored.getPaperAccount(human.accountId), human);

const entry = await new PaperArenaEntryService({ store, streamId }).enter({ accountId: human.accountId, quoteAssetId: "USDG" });
assert.equal(entry.participantType, "HUMAN");
assert.equal(entry.participantId, human.participantId);
assert.equal(entry.startingNavQuoteAtomic, "1000000000");
assert.equal(entry.enteredAt, human.openedAt);

const agent = await restored.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Agent One",
  thesis: "Trade verified liquid RWAs only.",
  createdAt: 1_200,
}, "agent-1");
await restored.createStrategyVersion(agent.id, strategy, "strategy-1", 1_201);
await restored.activatePaperAgent(agent.id, "activate-1");

await assert.rejects(
  () => restored.submitPaperOrder({
    agentId: agent.id,
    strategyVersion: 1,
    accountId: human.accountId,
    inputAssetId: "USDG",
    outputAssetId: "NVDA",
    inputAmountAtomic: "1000000",
    maximumSlippageBps: 50,
    createdAt: 2_000,
  }, "illegal-human-order"),
  /paper account does not belong to agent/,
);
assert.equal(restored.getPaperAccount(human.accountId).balances.USDG, "1000000000");
assert.equal("executeLive" in restored, false);

console.log("human-paper-account smoke: ok");
