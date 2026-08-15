import assert from "node:assert/strict";
import {
  buildMarketSnapshot,
  hashAgentRunPayload,
  hashCanonicalPayload,
  type AgentRecord,
  type AgentRunRecord,
  type AgentSafetyEnvelope,
  type PaperAccountRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  AgentAuthoritativeOpenPositionAdmissionService,
  assertAgentAuthoritativeOpenPositionAdmissionRecord,
  type AgentAuthoritativeOpenPositionAdmissionConfig,
} from "./agent-authoritative-open-position-admission.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import {
  InMemoryPaperCanonicalValuationHistoryStore,
} from "./paper-canonical-valuation-store.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const outputAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const streamId = "agent-authoritative-open-position-smoke";
const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 1_000,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 300,
  minimumEvaluationIntervalSeconds: 30,
};
const spec: StrategySpec = {
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
const agent: AgentRecord = {
  id: "agent-authoritative-1",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Authoritative Hound",
  thesis: "Compete from canonical Arena state only.",
  performanceState: "PAPER_ACTIVE",
  executionMode: "PAPER_ONLY",
  createdAt: 1_000,
};
const strategy: StrategyVersionRecord = {
  id: "strategy-authoritative-1",
  agentId: agent.id,
  version: 1,
  spec,
  strategyHash: hashCanonicalPayload({ agentId: agent.id, version: 1, spec }),
  createdAt: 1_050,
};
const account: PaperAccountRecord = {
  accountId: "agent-authoritative-account-1",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: agent.id,
  balances: { [quoteAssetId]: "1000000" },
  openedAt: 1_100,
};

const snapshot = emptyAgentEngineSnapshot();
snapshot.seasons = [{ seasonId: "season-1", name: "Human vs Agent", startsAt: 1_000, endsAt: 100_000, createdAt: 900 }];
snapshot.agents = [agent];
snapshot.strategyVersions = [strategy];
snapshot.paperAccounts = [account];
const stateStore = new InMemoryAgentStateStore();
await stateStore.commit({
  streamId,
  expectedRevision: 0,
  idempotencyKey: "seed",
  operation: "authoritativeAgentSeed",
  requestHash: hashCanonicalPayload({ operation: "authoritativeAgentSeed" }),
  result: { seeded: true },
  snapshot,
  createdAt: 1_200,
});

const entry = await new PaperArenaEntryService({ store: stateStore, streamId }).enter({
  accountId: account.accountId,
  quoteAssetId,
});
assert.equal(entry.participantType, "AGENT");
assert.equal(entry.participantId, agent.id);

const valuation = await new PaperCanonicalValuationService({ store: stateStore, streamId }).value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [],
  valuedAt: 9_950,
  maximumQuoteAgeMs: 1_000,
});
assert.equal(valuation.valuation.liquidationNavQuoteAtomic, "1000000");
const valuationStore = new InMemoryPaperCanonicalValuationHistoryStore();
await valuationStore.put(valuation);

const marketSnapshot = buildMarketSnapshot({
  chainId: 4_663,
  sourceId: "verified-rmt-paper-market-v1",
  capturedAt: 9_800,
  observations: [{
    assetId: outputAssetId,
    quoteAssetId: "fiat:USD",
    aliases: ["NVDA"],
    referencePriceAtomic: "150000000",
    referencePriceDecimals: 6,
  }],
});
const proposal = {
  action: "OPEN_POSITION" as const,
  confidence: 0.8,
  reasoningSummary: "Canonical momentum and liquidity evidence satisfy the admitted strategy.",
  openPosition: { assetId: outputAssetId, requestedPositionBps: 400 },
};
const runPayload: Omit<AgentRunRecord, "runHash"> = {
  runId: "run-authoritative-1",
  evaluationKey: "agent-authoritative-1:slot-1",
  requestHash: hashCanonicalPayload({ request: "authoritative-slot-1" }),
  agentId: agent.id,
  accountId: account.accountId,
  accountSnapshot: account,
  strategyVersion: strategy.version,
  strategyHash: strategy.strategyHash,
  runnerVersion: "RMT_PAPER_EVALUATION_V1",
  marketSourceId: marketSnapshot.sourceId,
  decisionAdapterId: "fake-decision-v1",
  modelIdentity: "fake-model-v1",
  marketSnapshot,
  proposal,
  proposalHash: hashCanonicalPayload(proposal),
  evaluatedAt: 9_900,
};
const run: AgentRunRecord = { ...runPayload, runHash: hashAgentRunPayload(runPayload) };

const config: AgentAuthoritativeOpenPositionAdmissionConfig = {
  safetyEnvelope,
  riskCapacityPolicyVersion: "RMT_AGENT_AUTHORITATIVE_RISK_V1",
  tradeRequestPolicyVersion: "RMT_AGENT_AUTHORITATIVE_TRADE_REQUEST_V1",
  maximumRiskSnapshotAgeMs: 200,
  orderAdmissionPolicy: {
    policyVersion: "RMT_AGENT_AUTHORITATIVE_ORDER_ADMISSION_V1",
    maximumCapacityPlanAgeMs: 100,
  },
  maximumValuationGapMs: 10_000,
  maximumLatestValuationAgeMs: 100,
};
const service = new AgentAuthoritativeOpenPositionAdmissionService({
  stateStore,
  valuationHistoryStore: valuationStore,
  streamId,
  config,
});
const admitted = await service.admit({ entry, run, requestedAt: 10_000, admittedAt: 10_050 });
assert.equal(admitted.canonicalAdmission.admission.status, "ADMITTED");
assert.equal(admitted.canonicalAdmission.riskSource.snapshot.markNavAtomic, "1000000");
assert.equal(admitted.canonicalAdmission.riskSource.snapshot.currentPortfolioExposureAtomic, "0");
assert.equal(admitted.canonicalAdmission.riskSource.snapshot.currentPositionExposureAtomic, "0");
assert.equal(admitted.canonicalAdmission.riskSource.snapshot.openPositionCount, 0);
assert.equal(admitted.canonicalAdmission.riskSource.snapshot.tradesToday, 0);
assert.equal(admitted.canonicalAdmission.admission.tradeRequest.requestedInputAmountAtomic, "40000");
assert.equal(admitted.canonicalAdmission.admission.tradeCapacity.capacityPlan.maximumInputAmountAtomic, "50000");
assert.equal(admitted.canonicalAdmission.admission.orderAdmission?.intent.inputAmountAtomic, "40000");
assert.equal(admitted.canonicalAdmission.admission.tradeCapacity.accountSnapshot.balances[quoteAssetId], "1000000");
assert.equal(admitted.requestedAt, 10_000);
assert.match(admitted.valuationHistoryDigest, /^0x[0-9a-f]{64}$/);
assert.match(admitted.resultHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertAgentAuthoritativeOpenPositionAdmissionRecord(admitted));

const tampered = structuredClone(admitted);
tampered.canonicalAdmission.riskSource.snapshot.markNavAtomic = "999999";
tampered.resultHash = hashCanonicalPayload((() => {
  const { resultHash: _hash, ...payload } = tampered;
  return payload;
})());
assert.throws(
  () => assertAgentAuthoritativeOpenPositionAdmissionRecord(tampered),
  /risk snapshot hash mismatch|payload is not correctly derived/,
);

const staleService = new AgentAuthoritativeOpenPositionAdmissionService({
  stateStore,
  valuationHistoryStore: valuationStore,
  streamId,
  config: { ...config, maximumLatestValuationAgeMs: 25 },
});
await assert.rejects(
  () => staleService.admit({ entry, run, requestedAt: 10_000, admittedAt: 10_050 }),
  /latest valuation is stale/,
);

const gapService = new AgentAuthoritativeOpenPositionAdmissionService({
  stateStore,
  valuationHistoryStore: valuationStore,
  streamId,
  config: { ...config, maximumValuationGapMs: 100 },
});
await assert.rejects(
  () => gapService.admit({ entry, run, requestedAt: 10_000, admittedAt: 10_050 }),
  /starts after maximum gap/,
);

const mutatedSnapshot = structuredClone(snapshot);
mutatedSnapshot.agents.push({
  id: "agent-unrelated",
  ownerAddress: "0x0000000000000000000000000000000000000002",
  name: "Unrelated Agent",
  thesis: "Advance the engine revision without touching the admitted account.",
  performanceState: "PAPER_ACTIVE",
  executionMode: "PAPER_ONLY",
  createdAt: 10_100,
});
await stateStore.commit({
  streamId,
  expectedRevision: 1,
  idempotencyKey: "unrelated-state-mutation",
  operation: "authoritativeAgentUnrelatedMutation",
  requestHash: hashCanonicalPayload({ operation: "authoritativeAgentUnrelatedMutation" }),
  result: { mutated: true },
  snapshot: mutatedSnapshot,
  createdAt: 10_100,
});
await assert.rejects(
  () => service.admit({ entry, run, requestedAt: 10_150, admittedAt: 10_175 }),
  /latest valuation is not at current engine revision|does not match current engine state/,
);

assert.equal("submitPaperOrder" in service, false);
assert.equal("fill" in service, false);
assert.equal("execute" in service, false);
assert.equal("sign" in service, false);
console.log("agent-authoritative-open-position-admission smoke: ok");
