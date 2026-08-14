import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  type AgentRecord,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
  type PaperAccountRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  PaperRiskCapacityPlanner,
  assertPaperRiskCapacityPlan,
  assertPaperRiskSnapshot,
  buildPaperRiskSnapshot,
} from "./paper-risk-capacity.ts";

const quoteAssetId = "eip155:4663/contract:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const nvdaAssetId = "eip155:4663/contract:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const amdAssetId = "eip155:4663/contract:0xcccccccccccccccccccccccccccccccccccccccc";

const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 1_000,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 1_500,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 300,
  minimumEvaluationIntervalSeconds: 30,
};

const strategySpec: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"], minimumLiquidityUsd: 25_000 },
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
  id: "agent-1",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Capacity Hound",
  thesis: "Only trade verified liquid RWAs within hard paper risk capacity.",
  performanceState: "PAPER_ACTIVE",
  executionMode: "PAPER_ONLY",
  createdAt: 1_000,
};

function strategyRecord(spec: StrategySpec, version = 1): StrategyVersionRecord {
  return {
    id: `strategy-${version}`,
    agentId: agent.id,
    version,
    spec,
    strategyHash: hashCanonicalPayload({ agentId: agent.id, version, spec }),
    createdAt: 2_000,
  };
}
const strategy = strategyRecord(strategySpec);

const account: PaperAccountRecord = {
  accountId: "account-1",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: agent.id,
  balances: { [quoteAssetId]: "900000000" },
  openedAt: 3_000,
};

const marketObservation: MarketObservationDraft = {
  assetId: nvdaAssetId,
  quoteAssetId: "fiat:USD",
  aliases: ["NVDA", "robinhood-nvda", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  referencePriceAtomic: "150250000",
  referencePriceDecimals: 6,
  liquidityUsdAtomic: "1000000000000",
  liquidityUsdDecimals: 6,
  features: { assetClass: "RWA", verified: true },
};

function risk(overrides: Partial<Parameters<typeof buildPaperRiskSnapshot>[0]> = {}) {
  return buildPaperRiskSnapshot({
    accountId: account.accountId,
    quoteAssetId,
    positionAssetId: nvdaAssetId,
    markNavAtomic: "1000000000",
    currentPortfolioExposureAtomic: "100000000",
    currentPositionExposureAtomic: "10000000",
    openPositionCount: 2,
    tradesToday: 4,
    dailyLossBps: 50,
    drawdownBps: 100,
    capturedAt: 9_500,
    ...overrides,
  });
}

const planner = new PaperRiskCapacityPlanner({
  safetyEnvelope,
  policyVersion: "RMT_PAPER_CAPACITY_V1",
  maximumRiskSnapshotAgeMs: 2_000,
});

const admitted = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk(),
  marketObservation,
  requestedInputAmountAtomic: "30000000",
  plannedAt: 10_000,
});
assert.equal(admitted.status, "ADMITTED");
assert.equal(admitted.maximumInputAmountAtomic, "40000000");
assert.equal(admitted.admittedInputAmountAtomic, "30000000");
assert.equal(admitted.capacity.positionLimitAtomic, "50000000");
assert.equal(admitted.capacity.positionHeadroomAtomic, "40000000");
assert.equal(admitted.capacity.portfolioLimitAtomic, "250000000");
assert.equal(admitted.capacity.portfolioHeadroomAtomic, "150000000");
assert.equal(admitted.capacity.availableBalanceAtomic, "900000000");
assert.equal(admitted.maximumSlippageBps, 100);
assert.deepEqual(admitted.reasons, []);
assert.doesNotThrow(() => assertPaperRiskCapacityPlan(admitted));
assert.doesNotThrow(() => assertPaperRiskSnapshot(admitted.riskSnapshot));

const oversized = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk(),
  marketObservation,
  requestedInputAmountAtomic: "50000000",
  plannedAt: 10_000,
});
assert.equal(oversized.status, "BLOCKED");
assert.equal(oversized.maximumInputAmountAtomic, "40000000");
assert.equal(oversized.admittedInputAmountAtomic, null);
assert.deepEqual(oversized.reasons, ["REQUEST_EXCEEDS_CAPACITY"]);

const tradeLimited = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk({ tradesToday: 20 }),
  marketObservation,
  requestedInputAmountAtomic: "1",
  plannedAt: 10_000,
});
assert.equal(tradeLimited.status, "BLOCKED");
assert.equal(tradeLimited.maximumInputAmountAtomic, "0");
assert.ok(tradeLimited.reasons.includes("TRADE_LIMIT_REACHED"));
assert.ok(tradeLimited.reasons.includes("REQUEST_EXCEEDS_CAPACITY"));

const dailyLossLimited = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk({ dailyLossBps: 300 }),
  marketObservation,
  requestedInputAmountAtomic: "1",
  plannedAt: 10_000,
});
assert.equal(dailyLossLimited.maximumInputAmountAtomic, "0");
assert.ok(dailyLossLimited.reasons.includes("DAILY_LOSS_LIMIT_REACHED"));

const drawdownLimited = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk({ drawdownBps: 1_000 }),
  marketObservation,
  requestedInputAmountAtomic: "1",
  plannedAt: 10_000,
});
assert.equal(drawdownLimited.maximumInputAmountAtomic, "0");
assert.ok(drawdownLimited.reasons.includes("DRAWDOWN_LIMIT_REACHED"));

const newPositionAtLimit = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk({ currentPositionExposureAtomic: "0", openPositionCount: 5 }),
  marketObservation,
  requestedInputAmountAtomic: "1",
  plannedAt: 10_000,
});
assert.equal(newPositionAtLimit.maximumInputAmountAtomic, "0");
assert.ok(newPositionAtLimit.reasons.includes("OPEN_POSITION_LIMIT_REACHED"));

const existingPositionAtCountLimit = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk({ openPositionCount: 5 }),
  marketObservation,
  requestedInputAmountAtomic: "1000000",
  plannedAt: 10_000,
});
assert.equal(existingPositionAtCountLimit.status, "ADMITTED");
assert.ok(!existingPositionAtCountLimit.reasons.includes("OPEN_POSITION_LIMIT_REACHED"));

const zeroBalanceAccount = structuredClone(account);
zeroBalanceAccount.balances[quoteAssetId] = "0";
const zeroBalance = planner.plan({
  agent,
  strategy,
  account: zeroBalanceAccount,
  riskSnapshot: risk(),
  marketObservation,
  requestedInputAmountAtomic: "1",
  plannedAt: 10_000,
});
assert.equal(zeroBalance.maximumInputAmountAtomic, "0");
assert.ok(zeroBalance.reasons.includes("NO_AVAILABLE_BALANCE"));

const zeroLossSpec: StrategySpec = {
  ...strategySpec,
  risk: { ...strategySpec.risk, maximumDailyLossBps: 0, maximumDrawdownBps: 0 },
};
const zeroLossStrategy = strategyRecord(zeroLossSpec, 2);
const zeroLossPlan = planner.plan({
  agent,
  strategy: zeroLossStrategy,
  account,
  riskSnapshot: risk({ dailyLossBps: 0, drawdownBps: 0 }),
  marketObservation,
  requestedInputAmountAtomic: "1000000",
  plannedAt: 10_000,
});
assert.equal(zeroLossPlan.status, "ADMITTED");

await assert.rejects(
  async () => planner.plan({
    agent,
    strategy,
    account,
    riskSnapshot: risk({ capturedAt: 7_000 }),
    marketObservation,
    requestedInputAmountAtomic: "1",
    plannedAt: 10_000,
  }),
  /risk snapshot is stale/,
);

assert.throws(
  () => planner.plan({
    agent,
    strategy,
    account,
    riskSnapshot: risk({ positionAssetId: amdAssetId }),
    marketObservation,
    requestedInputAmountAtomic: "1",
    plannedAt: 10_000,
  }),
  /market observation does not match risk position asset/,
);

const outOfScopeObservation = { ...marketObservation, assetId: amdAssetId, aliases: ["AMD"] };
assert.throws(
  () => planner.plan({
    agent,
    strategy,
    account,
    riskSnapshot: risk({ positionAssetId: amdAssetId }),
    marketObservation: outOfScopeObservation,
    requestedInputAmountAtomic: "1",
    plannedAt: 10_000,
  }),
  /outside strategy includeAssets/,
);

const tamperedRisk = structuredClone(risk());
tamperedRisk.markNavAtomic = "999999999";
assert.throws(() => assertPaperRiskSnapshot(tamperedRisk), /risk snapshot hash mismatch/);
const tamperedPlan = structuredClone(admitted);
tamperedPlan.maximumInputAmountAtomic = "999999999";
assert.throws(() => assertPaperRiskCapacityPlan(tamperedPlan), /capacity plan hash mismatch/);
assert.equal("submitPaperOrder" in planner, false);
assert.equal("fill" in planner, false);
assert.equal("execute" in planner, false);

console.log("paper-risk-capacity smoke: ok");