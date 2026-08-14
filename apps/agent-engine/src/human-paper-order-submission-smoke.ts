import assert from "node:assert/strict";
import type { AgentSafetyEnvelope, MarketObservationDraft, PaperAccountRecord } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import { HumanPaperOrderAdmissionService } from "./human-paper-order-admission.ts";
import { HumanPaperOrderSubmissionGateService } from "./human-paper-order-submission-gate.ts";
import {
  HumanPaperOrderSubmissionService,
  assertHumanPaperOrderSubmissionRecord,
} from "./human-paper-order-submission.ts";
import { HumanPaperRiskCapacityPlanner } from "./human-paper-risk-capacity.ts";
import { buildPaperRiskSnapshot } from "./paper-risk-capacity.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 5_000,
  maximumPortfolioExposureBps: 8_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 1_000,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 500,
  minimumEvaluationIntervalSeconds: 30,
};
const riskPolicy = {
  policyVersion: "RMT_HUMAN_RISK_V1",
  maximumPositionBps: 2_500,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 5,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 1_000,
  maximumTradesPerDay: 20,
  maximumSlippageBps: 75,
  maximumPriceImpactBps: 250,
};
const observation: MarketObservationDraft = {
  assetId: "NVDA",
  quoteAssetId: "USDG",
  referencePriceAtomic: "150000000",
  referencePriceDecimals: 6,
};
const config = { safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" };

function riskPlan(account: PaperAccountRecord, amount: string, plannedAt: number) {
  return new HumanPaperRiskCapacityPlanner({ safetyEnvelope, policy: riskPolicy, maximumRiskSnapshotAgeMs: 1_000 }).plan({
    account,
    riskSnapshot: buildPaperRiskSnapshot({
      accountId: account.accountId,
      quoteAssetId: "USDG",
      positionAssetId: "NVDA",
      markNavAtomic: "1000",
      currentPortfolioExposureAtomic: "0",
      currentPositionExposureAtomic: "0",
      openPositionCount: 0,
      tradesToday: 0,
      dailyLossBps: 0,
      drawdownBps: 0,
      capturedAt: plannedAt - 50,
    }),
    marketObservation: observation,
    requestedInputAmountAtomic: amount,
    requestedMaximumSlippageBps: 50,
    plannedAt,
  });
}

const store = new InMemoryAgentStateStore();
const streamId = "human-order-submit";
const engine = await DurableAgentEngine.initialize({ config, store, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Manual", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }, "season");
const human = await engine.openHumanPaperAccount({
  walletAddress: "0x00000000000000000000000000000000000000dd",
  seasonId: "season-1",
  initialBalances: { USDG: "1000" },
  openedAt: 1_100,
}, "human");
const admissionService = new HumanPaperOrderAdmissionService({
  store,
  streamId,
  policy: { policyVersion: "RMT_HUMAN_MANUAL_V1", maximumSlippageBps: 75, maximumInputBalanceBps: 2_500 },
});
const firstRisk = riskPlan(human, "200", 1_950);
assert.equal(firstRisk.status, "ADMITTED");
const admission = await admissionService.admit({
  accountId: human.accountId,
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  admittedAt: 2_000,
});
const gate = await new HumanPaperOrderSubmissionGateService({ store, streamId }).check({ admission, checkedAt: 2_050 });
const service = new HumanPaperOrderSubmissionService(engine, { maximumRiskPlanAgeMs: 500 });
const first = await service.submit({ admission, gate, riskCapacityPlan: firstRisk });
assert.equal(first.order.status, "PENDING");
assert.equal(first.order.participantType, "HUMAN");
assert.equal(first.order.participantId, human.participantId);
assert.equal(first.order.inputAmountAtomic, "200");
assert.equal(first.riskCapacityPlan.planHash, firstRisk.planHash);
assert.doesNotThrow(() => assertHumanPaperOrderSubmissionRecord(first));

const persisted = await store.load(streamId);
assert.ok(persisted);
assert.equal(persisted.revision, gate.expectedRevision + 1);
assert.equal(persisted.snapshot.paperOrders.length, 1);
const storedOrder = persisted.snapshot.paperOrders[0]!;
assert.ok("participantType" in storedOrder);
assert.equal("participantType" in storedOrder ? storedOrder.participantType : null, "HUMAN");

const replay = await service.submit({ admission, gate, riskCapacityPlan: firstRisk });
assert.equal(replay.order.orderId, first.order.orderId);
assert.equal(replay.submissionHash, first.submissionHash);
assert.equal((await store.load(streamId))?.snapshot.paperOrders.length, 1);

const alteredRisk = structuredClone(firstRisk);
alteredRisk.riskSnapshot.dailyLossBps = 1;
alteredRisk.planHash = "0x" + "0".repeat(64);
await assert.rejects(
  () => service.submit({ admission, gate, riskCapacityPlan: alteredRisk }),
  /plan hash mismatch/,
);

const secondStore = new InMemoryAgentStateStore();
const secondStream = "human-order-race";
const secondEngine = await DurableAgentEngine.initialize({ config, store: secondStore, streamId: secondStream });
await secondEngine.createSeason({ seasonId: "season-1", name: "Manual", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }, "season");
const secondHuman = await secondEngine.openHumanPaperAccount({
  walletAddress: "0x00000000000000000000000000000000000000ee",
  seasonId: "season-1",
  initialBalances: { USDG: "1000" },
  openedAt: 1_100,
}, "human");
const secondRisk = riskPlan(secondHuman, "200", 1_950);
const secondAdmission = await new HumanPaperOrderAdmissionService({
  store: secondStore,
  streamId: secondStream,
  policy: { policyVersion: "RMT_HUMAN_MANUAL_V1", maximumSlippageBps: 75, maximumInputBalanceBps: 2_500 },
}).admit({
  accountId: secondHuman.accountId,
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  admittedAt: 2_000,
});
const secondGate = await new HumanPaperOrderSubmissionGateService({ store: secondStore, streamId: secondStream }).check({ admission: secondAdmission, checkedAt: 2_050 });
await secondEngine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Race Mutation",
  thesis: "Mutate revision before human submit.",
  createdAt: 2_100,
}, "race-mutation");
await assert.rejects(
  () => new HumanPaperOrderSubmissionService(secondEngine, { maximumRiskPlanAgeMs: 500 }).submit({ admission: secondAdmission, gate: secondGate, riskCapacityPlan: secondRisk }),
  /required revision mismatch|revision conflict/,
);
assert.equal((await secondStore.load(secondStream))?.snapshot.paperOrders.length, 0);

console.log("human-paper-order-submission smoke: ok");
