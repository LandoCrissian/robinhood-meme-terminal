import assert from "node:assert/strict";
import type { AgentSafetyEnvelope } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import { HumanPaperOrderAdmissionService } from "./human-paper-order-admission.ts";
import { HumanPaperOrderSubmissionGateService } from "./human-paper-order-submission-gate.ts";
import {
  HumanPaperOrderSubmissionService,
  assertHumanPaperOrderSubmissionRecord,
} from "./human-paper-order-submission.ts";
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
const config = { safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" };
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
const admission = await admissionService.admit({
  accountId: human.accountId,
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  admittedAt: 2_000,
});
const gate = await new HumanPaperOrderSubmissionGateService({ store, streamId }).check({ admission, checkedAt: 2_050 });
const service = new HumanPaperOrderSubmissionService(engine);
const first = await service.submit({ admission, gate });
assert.equal(first.order.status, "PENDING");
assert.equal(first.order.participantType, "HUMAN");
assert.equal(first.order.participantId, human.participantId);
assert.equal(first.order.inputAmountAtomic, "200");
assert.doesNotThrow(() => assertHumanPaperOrderSubmissionRecord(first));

const persisted = await store.load(streamId);
assert.ok(persisted);
assert.equal(persisted.revision, gate.expectedRevision + 1);
assert.equal(persisted.snapshot.paperOrders.length, 1);
const storedOrder = persisted.snapshot.paperOrders[0]!;
assert.ok("participantType" in storedOrder);
assert.equal("participantType" in storedOrder ? storedOrder.participantType : null, "HUMAN");

const replay = await service.submit({ admission, gate });
assert.equal(replay.order.orderId, first.order.orderId);
assert.equal(replay.submissionHash, first.submissionHash);
assert.equal((await store.load(streamId))?.snapshot.paperOrders.length, 1);

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
  () => new HumanPaperOrderSubmissionService(secondEngine).submit({ admission: secondAdmission, gate: secondGate }),
  /required revision mismatch|revision conflict/,
);
assert.equal((await secondStore.load(secondStream))?.snapshot.paperOrders.length, 0);

console.log("human-paper-order-submission smoke: ok");
