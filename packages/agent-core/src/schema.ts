export type AgentPerformanceState =
  | "INCUBATING"
  | "PAPER_ACTIVE"
  | "QUALIFIED"
  | "ELITE"
  | "RETIRED";

export type AgentExecutionMode =
  | "PAPER_ONLY"
  | "LIVE_REVIEW_REQUIRED"
  | "LIVE_DELEGATED"
  | "SUSPENDED";

export type AssetClass = "RWA" | "COMMUNITY";
export type ParticipantType = "AGENT" | "HUMAN";
export type DecisionAction =
  | "NO_ACTION"
  | "PREDICTION"
  | "OPEN_POSITION"
  | "CLOSE_POSITION";
export type PaperOrderStatus = "PENDING" | "FILLED" | "CANCELLED";

export interface StrategySignal {
  type: string;
  weight: number;
  parameters?: Record<string, string | number | boolean>;
}

export interface StrategySpec {
  schemaVersion: 1;
  universe: {
    assetClasses: AssetClass[];
    includeAssets?: string[];
    excludeAssets?: string[];
    minimumLiquidityUsd?: number;
  };
  timeframe: {
    evaluationIntervalSeconds: number;
    predictionHorizonSeconds: number;
    maximumHoldingSeconds?: number;
  };
  signals: StrategySignal[];
  prediction: {
    enabled: boolean;
    minimumConfidence: number;
  };
  risk: {
    maximumPositionBps: number;
    maximumPortfolioExposureBps: number;
    maximumOpenPositions: number;
    maximumDailyLossBps: number;
    maximumDrawdownBps: number;
    maximumTradesPerDay: number;
  };
  execution: {
    venuePolicy: "RMT_BEST_VERIFIED";
    maximumSlippageBps: number;
    maximumPriceImpactBps: number;
  };
  prohibitedActions: string[];
}

export interface AgentSafetyEnvelope {
  maximumPositionBps: number;
  maximumPortfolioExposureBps: number;
  maximumOpenPositions: number;
  maximumDailyLossBps: number;
  maximumDrawdownBps: number;
  maximumTradesPerDay: number;
  maximumSlippageBps: number;
  maximumPriceImpactBps: number;
  minimumEvaluationIntervalSeconds: number;
}

export interface AgentRecord {
  id: string;
  ownerAddress: string;
  name: string;
  thesis: string;
  performanceState: AgentPerformanceState;
  executionMode: AgentExecutionMode;
  createdAt: number;
}

export interface StrategyVersionRecord {
  id: string;
  agentId: string;
  version: number;
  spec: StrategySpec;
  strategyHash: string;
  createdAt: number;
}

export interface AgentDecision {
  decisionId: string;
  agentId: string;
  strategyVersion: number;
  marketSnapshotId: string;
  createdAt: number;
  action: DecisionAction;
  confidence: number;
  reasoningSummary: string;
  modelIdentity: string;
  compilerVersion: string;
  policyVersion: string;
  decisionHash: string;
}

export interface PredictionRecord {
  predictionId: string;
  agentId: string;
  strategyVersion: number;
  assetId: string;
  condition: string;
  forecastProbability: number;
  createdAt: number;
  resolvesAt: number;
  resolvedOutcome?: 0 | 1;
  resolvedAt?: number;
}

export interface PaperOrderIntent {
  agentId: string;
  strategyVersion: number;
  accountId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  maximumSlippageBps: number;
  createdAt: number;
}

export interface PaperOrderRecord extends PaperOrderIntent {
  orderId: string;
  status: PaperOrderStatus;
}

export interface VerifiedPaperQuoteEvidence {
  quoteId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  providerId: string;
  priceImpactBps: number;
  observedAt: number;
  expiresAt?: number;
  quoteBlockNumber?: string;
  evidenceHash: string;
}

export interface PaperExecutionCosts {
  feeAssetId?: string;
  feeAmountAtomic: string;
  gasAssetId?: string;
  gasCostAtomic: string;
}

export interface PaperFillRecord {
  fillId: string;
  orderId: string;
  quoteId: string;
  agentId: string;
  accountId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  providerId: string;
  feeAssetId?: string;
  feeAmountAtomic: string;
  gasAssetId?: string;
  gasCostAtomic: string;
  filledAt: number;
  evidenceHash: string;
}

export interface PaperAccountRecord {
  accountId: string;
  seasonId: string;
  participantType: ParticipantType;
  participantId: string;
  balances: Record<string, string>;
  openedAt: number;
}

export interface PortfolioSnapshot {
  accountId: string;
  capturedAt: number;
  quoteAssetId: string;
  markNavAtomic: string;
  liquidationNavAtomic: string;
}

function fail(message: string): never {
  throw new Error(message);
}

export function assertAtomicAmount(value: string, field = "atomic amount"): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${field} must be an unsigned base-10 integer string`);
}

export function assertPositiveAtomicAmount(value: string, field = "atomic amount"): void {
  assertAtomicAmount(value, field);
  if (BigInt(value) <= 0n) fail(`${field} must be greater than zero`);
}

export function assertUnitInterval(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${field} must be between 0 and 1`);
}

export function assertBps(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) fail(`${field} must be an integer from 0 to 10000`);
}

export function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) fail(`${field} must be a positive integer`);
}

export function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} must be non-empty`);
}

export function assertStrategySpec(spec: StrategySpec): void {
  if (spec.schemaVersion !== 1) fail("unsupported strategy schema version");
  if (spec.universe.assetClasses.length === 0) fail("strategy must include at least one asset class");
  for (const assetClass of spec.universe.assetClasses) {
    if (assetClass !== "RWA" && assetClass !== "COMMUNITY") fail(`unsupported asset class: ${assetClass}`);
  }
  if (spec.universe.minimumLiquidityUsd !== undefined && (!Number.isFinite(spec.universe.minimumLiquidityUsd) || spec.universe.minimumLiquidityUsd < 0)) {
    fail("minimumLiquidityUsd must be finite and non-negative");
  }
  assertPositiveInteger(spec.timeframe.evaluationIntervalSeconds, "evaluationIntervalSeconds");
  assertPositiveInteger(spec.timeframe.predictionHorizonSeconds, "predictionHorizonSeconds");
  if (spec.timeframe.maximumHoldingSeconds !== undefined) assertPositiveInteger(spec.timeframe.maximumHoldingSeconds, "maximumHoldingSeconds");
  if (spec.signals.length === 0) fail("strategy must include at least one signal");
  let totalSignalWeight = 0;
  for (const signal of spec.signals) {
    assertNonEmptyString(signal.type, "signal type");
    if (!Number.isFinite(signal.weight) || signal.weight < 0) fail("signal weight must be finite and non-negative");
    totalSignalWeight += signal.weight;
  }
  if (totalSignalWeight <= 0) fail("strategy signal weights must sum to a positive value");
  assertUnitInterval(spec.prediction.minimumConfidence, "minimumConfidence");
  assertBps(spec.risk.maximumPositionBps, "maximumPositionBps");
  assertBps(spec.risk.maximumPortfolioExposureBps, "maximumPortfolioExposureBps");
  assertPositiveInteger(spec.risk.maximumOpenPositions, "maximumOpenPositions");
  assertBps(spec.risk.maximumDailyLossBps, "maximumDailyLossBps");
  assertBps(spec.risk.maximumDrawdownBps, "maximumDrawdownBps");
  assertPositiveInteger(spec.risk.maximumTradesPerDay, "maximumTradesPerDay");
  if (spec.execution.venuePolicy !== "RMT_BEST_VERIFIED") fail("unsupported venue policy");
  assertBps(spec.execution.maximumSlippageBps, "maximumSlippageBps");
  assertBps(spec.execution.maximumPriceImpactBps, "maximumPriceImpactBps");
  for (const action of spec.prohibitedActions) assertNonEmptyString(action, "prohibited action");
}

export function assertSafetyEnvelope(envelope: AgentSafetyEnvelope): void {
  assertBps(envelope.maximumPositionBps, "safety.maximumPositionBps");
  assertBps(envelope.maximumPortfolioExposureBps, "safety.maximumPortfolioExposureBps");
  assertPositiveInteger(envelope.maximumOpenPositions, "safety.maximumOpenPositions");
  assertBps(envelope.maximumDailyLossBps, "safety.maximumDailyLossBps");
  assertBps(envelope.maximumDrawdownBps, "safety.maximumDrawdownBps");
  assertPositiveInteger(envelope.maximumTradesPerDay, "safety.maximumTradesPerDay");
  assertBps(envelope.maximumSlippageBps, "safety.maximumSlippageBps");
  assertBps(envelope.maximumPriceImpactBps, "safety.maximumPriceImpactBps");
  assertPositiveInteger(envelope.minimumEvaluationIntervalSeconds, "safety.minimumEvaluationIntervalSeconds");
}

export function assertStrategyWithinSafetyEnvelope(spec: StrategySpec, envelope: AgentSafetyEnvelope): void {
  assertStrategySpec(spec);
  assertSafetyEnvelope(envelope);
  const checks: Array<[number, number, string]> = [
    [spec.risk.maximumPositionBps, envelope.maximumPositionBps, "maximumPositionBps"],
    [spec.risk.maximumPortfolioExposureBps, envelope.maximumPortfolioExposureBps, "maximumPortfolioExposureBps"],
    [spec.risk.maximumOpenPositions, envelope.maximumOpenPositions, "maximumOpenPositions"],
    [spec.risk.maximumDailyLossBps, envelope.maximumDailyLossBps, "maximumDailyLossBps"],
    [spec.risk.maximumDrawdownBps, envelope.maximumDrawdownBps, "maximumDrawdownBps"],
    [spec.risk.maximumTradesPerDay, envelope.maximumTradesPerDay, "maximumTradesPerDay"],
    [spec.execution.maximumSlippageBps, envelope.maximumSlippageBps, "maximumSlippageBps"],
    [spec.execution.maximumPriceImpactBps, envelope.maximumPriceImpactBps, "maximumPriceImpactBps"],
  ];
  for (const [requested, maximum, field] of checks) {
    if (requested > maximum) fail(`${field} exceeds RMT safety envelope`);
  }
  if (spec.timeframe.evaluationIntervalSeconds < envelope.minimumEvaluationIntervalSeconds) {
    fail("evaluationIntervalSeconds is below RMT safety minimum");
  }
}
