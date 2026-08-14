import assert from "node:assert/strict";
import type { AgentSafetyEnvelope } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import { HumanPaperOrderAdmissionService } from "./human-paper-order-admission.ts";
import {
  HumanPaperOrderSubmissionGateService,
  assertHumanPaperOrderSubmissionGateRecord,
} from "./human-paper-order-submission-gate.ts";
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
const streamId = "human-submit-gate";
const engine = await DurableAgentEngine.initialize({ config, store, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Gate", startsAt: 1_000, endsAt: 10_000, createdAt: 900 }, "season");
const human = await engine.openHumanPaperAccount({
  walletAddress: "0x00000000000000000000000000000000000000cc",
  seasonId: "season-1",
  initialBalances: { USDG: "1000" },
  openedAt: 1_100,
}, "human");
const admissions = new HumanPaperOrderAdmissionService({
  store,
  streamId,
  policy: { policyVersion: "RMT_HUMAN_MANUAL_V1", maximumSlippageBps: 75, maximumInputBalanceBps: 2_500 },
});
const admission = await admissions.admit({
  accountId: human.accountId,
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  admittedAt: 2_000,
});
const gateService = new HumanPaperOrderSubmissionGateService({ store, streamId });
const gate = await gateService.check({ admission, checkedAt: 2_100 });
assert.equal(gate.expectedRevision, admission.revision);
assert.equal(gate.expectedStateHash, admission.engineStateHash);
assert.equal(gate.admissionHash, admission.admissionHash);
assert.match(gate.gateId, /^0x[0-9a-f]{64}$/);
assert.match(gate.gateHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertHumanPaperOrderSubmissionGateRecord(gate));

const tampered = structuredClone(gate);
tampered.expectedRevision += 1;
assert.throws(() => assertHumanPaperOrderSubmissionGateRecord(tampered), /gateId mismatch|gate hash mismatch/);

await engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Unrelated Agent",
  thesis: "Unrelated state mutation.",
  createdAt: 2_200,
}, "unrelated-agent");
await assert.rejects(
  () => gateService.check({ admission, checkedAt: 2_300 }),
  /stale because engine revision changed/,
);

console.log("human-paper-order-submission-gate smoke: ok");
