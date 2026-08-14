import assert from "node:assert/strict";
import type { AgentSafetyEnvelope, StrategySpec } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import {
  HumanPaperOrderAdmissionService,
  assertHumanPaperOrderAdmissionRecord,
} from "./human-paper-order-admission.ts";
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
const streamId = "human-admission-smoke";
const engine = await DurableAgentEngine.initialize({ config, store, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Manual Arena", startsAt: 1_000, endsAt: 10_000, createdAt: 900 }, "season");
const human = await engine.openHumanPaperAccount({
  walletAddress: "0xAbCdEf0000000000000000000000000000001234",
  seasonId: "season-1",
  initialBalances: { USDG: "1000" },
  openedAt: 1_100,
}, "human");

const admissionService = new HumanPaperOrderAdmissionService({
  store,
  streamId,
  policy: {
    policyVersion: "RMT_HUMAN_MANUAL_V1",
    maximumSlippageBps: 75,
    maximumInputBalanceBps: 2_500,
  },
});

const admitted = await admissionService.admit({
  accountId: human.accountId,
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  admittedAt: 2_000,
});
assert.equal(admitted.intent.participantType, "HUMAN");
assert.equal(admitted.intent.participantId, "0xabcdef0000000000000000000000000000001234");
assert.equal(admitted.intent.manualPolicyVersion, "RMT_HUMAN_MANUAL_V1");
assert.equal(admitted.intent.inputAmountAtomic, "200");
assert.equal(admitted.accountSnapshot.balances.USDG, "1000");
assert.equal(admitted.revision, engine.getRevision());
assert.match(admitted.admissionId, /^0x[0-9a-f]{64}$/);
assert.match(admitted.admissionHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertHumanPaperOrderAdmissionRecord(admitted));

await assert.rejects(
  () => admissionService.admit({
    accountId: human.accountId,
    inputAssetId: "USDG",
    outputAssetId: "NVDA",
    inputAmountAtomic: "251",
    maximumSlippageBps: 50,
    admittedAt: 2_000,
  }),
  /exceeds manual balance policy/,
);
await assert.rejects(
  () => admissionService.admit({
    accountId: human.accountId,
    inputAssetId: "USDG",
    outputAssetId: "NVDA",
    inputAmountAtomic: "100",
    maximumSlippageBps: 76,
    admittedAt: 2_000,
  }),
  /slippage exceeds manual policy/,
);
await assert.rejects(
  () => admissionService.admit({
    accountId: human.accountId,
    inputAssetId: "USDG",
    outputAssetId: "USDG",
    inputAmountAtomic: "100",
    maximumSlippageBps: 50,
    admittedAt: 2_000,
  }),
  /assets must differ/,
);

const agent = await engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Agent One",
  thesis: "Trade verified liquid RWAs.",
  createdAt: 1_200,
}, "agent");
await engine.createStrategyVersion(agent.id, strategy, "strategy", 1_201);
await engine.activatePaperAgent(agent.id, "activate");
const agentAccount = await engine.openPaperAccount({ agentId: agent.id, seasonId: "season-1", initialBalances: { USDG: "1000" }, openedAt: 1_300 }, "agent-account");
await assert.rejects(
  () => admissionService.admit({
    accountId: agentAccount.accountId,
    inputAssetId: "USDG",
    outputAssetId: "NVDA",
    inputAmountAtomic: "100",
    maximumSlippageBps: 50,
    admittedAt: 2_000,
  }),
  /requires a HUMAN account/,
);

const tampered = structuredClone(admitted);
tampered.intent.inputAmountAtomic = "201";
assert.throws(() => assertHumanPaperOrderAdmissionRecord(tampered), /admissionId mismatch|admission hash mismatch/);

console.log("human-paper-order-admission smoke: ok");
