import {
  assertAtomicAmount,
  assertBps,
  assertNonEmptyString,
  assertPositiveAtomicAmount,
  assertSafetyEnvelope,
  assertStrategyWithinSafetyEnvelope,
  hashCanonicalPayload,
  type AgentRecord,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
  type PaperAccountRecord,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";

export type PaperRiskCapacityReason =
  | "DAILY_LOSS_LIMIT_REACHED"
  | "DRAWDOWN_LIMIT_REACHED"
  | "TRADE_LIMIT_REACHED"
  | "OPEN_POSITION_LIMIT_REACHED"
  | "NO_AVAILABLE_BALANCE"
  | "POSITION_LIMIT_REACHED"
  | "PORTFOLIO_LIMIT_REACHED"
  | "REQUEST_EXCEEDS_CAPACITY";

export interface PaperRiskSnapshot {
  accountId: string;
  quoteAssetId: string;
  positionAssetId: string;
  markNavAtomic: string;
  currentPortfolioExposureAtomic: string;
  currentPositionExposureAtomic: string;
  openPositionCount: number;
  tradesToday: number;
  dailyLossBps: number;
  drawdownBps: number;
  capturedAt: number;
  riskHash: string;
}

export interface PaperRiskCapacityPlan {
  status: "ADMITTED" | "BLOCKED";
  policyVersion: string;
  agentId: string;
  strategyVersion: number;
  strategyHash: string;
  accountSnapshot: PaperAccountRecord;
  riskSnapshot: PaperRiskSnapshot;
  marketObservation: MarketObservationDraft;
  inputAssetId: string;
  outputAssetId: string;
  requestedInputAmountAtomic: string;
  admittedInputAmountAtomic: string | null;
  maximumInputAmountAtomic: string;
  capacity: {
    availableBalanceAtomic: string;
    positionLimitAtomic: string;
    currentPositionExposureAtomic: string;
    positionHeadroomAtomic: string;
    portfolioLimitAtomic: string;
    currentPortfolioExposureAtomic: string;
    portfolioHeadroomAtomic: string;
  };
  maximumSlippageBps: number;
  reasons: PaperRiskCapacityReason[];
  plannedAt: number;
  planHash: string;
}

export interface PaperRiskCapacityPlannerConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  policyVersion: string;
  maximumRiskSnapshotAgeMs: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function minimum(values: bigint[]): bigint {
  if (values.length === 0) fail("minimum requires values");
  return values.reduce((current, value) => value < current ? value : current);
}

function bpsAmount(amount: bigint, bps: number): bigint {
  assertBps(bps, "capacity bps");
  return amount * BigInt(bps) / 10_000n;
}

function headroom(limit: bigint, current: bigint): bigint {
  return current >= limit ? 0n : limit - current;
}

function thresholdReached(current: number, maximum: number): boolean {
  assertBps(current, "current risk bps");
  assertBps(maximum, "maximum risk bps");
  return maximum === 0 ? current > 0 : current >= maximum;
}

function observationIdentityKeys(observation: MarketObservationDraft): Set<string> {
  return new Set([observation.assetId, ...(observation.aliases ?? [])].map((value) => value.toLowerCase()));
}

function assertStrategyAllowsObservation(strategy: StrategyVersionRecord, observation: MarketObservationDraft): void {
  const keys = observationIdentityKeys(observation);
  const include = strategy.spec.universe.includeAssets?.map((asset) => asset.toLowerCase()) ?? [];
  const exclude = strategy.spec.universe.excludeAssets?.map((asset) => asset.toLowerCase()) ?? [];
  if (include.length > 0 && !include.some((asset) => keys.has(asset))) fail("paper capacity output asset is outside strategy includeAssets");
  if (exclude.some((asset) => keys.has(asset))) fail("paper capacity output asset is excluded by strategy");
}

export function buildPaperRiskSnapshot(input: Omit<PaperRiskSnapshot, "riskHash">): PaperRiskSnapshot {
  assertNonEmptyString(input.accountId, "risk accountId");
  assertNonEmptyString(input.quoteAssetId, "risk quoteAssetId");
  assertNonEmptyString(input.positionAssetId, "risk positionAssetId");
  if (input.quoteAssetId.toLowerCase() === input.positionAssetId.toLowerCase()) fail("risk quote and position assets must differ");
  assertPositiveAtomicAmount(input.markNavAtomic, "risk markNavAtomic");
  assertAtomicAmount(input.currentPortfolioExposureAtomic, "risk currentPortfolioExposureAtomic");
  assertAtomicAmount(input.currentPositionExposureAtomic, "risk currentPositionExposureAtomic");
  assertNonNegativeInteger(input.openPositionCount, "risk openPositionCount");
  assertNonNegativeInteger(input.tradesToday, "risk tradesToday");
  assertBps(input.dailyLossBps, "risk dailyLossBps");
  assertBps(input.drawdownBps, "risk drawdownBps");
  assertTimestamp(input.capturedAt, "risk capturedAt");
  const nav = BigInt(input.markNavAtomic);
  const portfolioExposure = BigInt(input.currentPortfolioExposureAtomic);
  const positionExposure = BigInt(input.currentPositionExposureAtomic);
  if (portfolioExposure > nav) fail("risk portfolio exposure exceeds mark NAV in no-leverage paper v1");
  if (positionExposure > portfolioExposure) fail("risk position exposure exceeds portfolio exposure");
  if (portfolioExposure > 0n && input.openPositionCount === 0) fail("risk exposure requires at least one open position");
  const payload = structuredClone(input);
  return { ...payload, riskHash: hashCanonicalPayload(payload) };
}

export function assertPaperRiskSnapshot(snapshot: PaperRiskSnapshot): void {
  assertHash(snapshot.riskHash, "riskHash");
  const { riskHash, ...input } = snapshot;
  const rebuilt = buildPaperRiskSnapshot(input);
  if (rebuilt.riskHash !== riskHash) fail("paper risk snapshot hash mismatch");
}

export function assertPaperRiskCapacityPlan(plan: PaperRiskCapacityPlan): void {
  assertHash(plan.planHash, "paper capacity planHash");
  assertPaperRiskSnapshot(plan.riskSnapshot);
  const { planHash, ...payload } = plan;
  if (planHash !== hashCanonicalPayload(payload)) fail("paper capacity plan hash mismatch");
}

export class PaperRiskCapacityPlanner {
  private readonly config: PaperRiskCapacityPlannerConfig;

  constructor(config: PaperRiskCapacityPlannerConfig) {
    this.config = structuredClone(config);
    assertSafetyEnvelope(this.config.safetyEnvelope);
    assertNonEmptyString(this.config.policyVersion, "paper capacity policyVersion");
    if (!Number.isSafeInteger(this.config.maximumRiskSnapshotAgeMs) || this.config.maximumRiskSnapshotAgeMs <= 0) {
      fail("maximumRiskSnapshotAgeMs must be a positive safe integer");
    }
  }

  plan(input: {
    agent: AgentRecord;
    strategy: StrategyVersionRecord;
    account: PaperAccountRecord;
    riskSnapshot: PaperRiskSnapshot;
    marketObservation: MarketObservationDraft;
    requestedInputAmountAtomic: string;
    plannedAt?: number;
  }): PaperRiskCapacityPlan {
    const plannedAt = input.plannedAt ?? Date.now();
    assertTimestamp(plannedAt, "paper capacity plannedAt");
    if (input.agent.executionMode !== "PAPER_ONLY") fail("paper capacity refuses non-paper execution mode");
    if (!["PAPER_ACTIVE", "QUALIFIED", "ELITE"].includes(input.agent.performanceState)) fail("agent is not paper-active for capacity planning");
    if (input.strategy.agentId !== input.agent.id) fail("paper capacity strategy does not belong to agent");
    assertStrategyWithinSafetyEnvelope(input.strategy.spec, this.config.safetyEnvelope);
    assertHash(input.strategy.strategyHash, "paper capacity strategyHash");
    if (input.account.participantType !== "AGENT" || input.account.participantId !== input.agent.id) fail("paper capacity account does not belong to agent");
    if (plannedAt < input.account.openedAt) fail("paper capacity plan predates paper account");
    assertPaperRiskSnapshot(input.riskSnapshot);
    if (input.riskSnapshot.accountId !== input.account.accountId) fail("paper capacity risk snapshot account mismatch");
    if (input.riskSnapshot.capturedAt > plannedAt) fail("paper capacity risk snapshot is from the future");
    if (plannedAt - input.riskSnapshot.capturedAt > this.config.maximumRiskSnapshotAgeMs) fail("paper capacity risk snapshot is stale");
    assertNonEmptyString(input.marketObservation.assetId, "paper capacity market assetId");
    if (input.marketObservation.assetId.toLowerCase() !== input.riskSnapshot.positionAssetId.toLowerCase()) fail("paper capacity market observation does not match risk position asset");
    assertStrategyAllowsObservation(input.strategy, input.marketObservation);
    assertPositiveAtomicAmount(input.requestedInputAmountAtomic, "paper capacity requestedInputAmountAtomic");

    const inputAssetId = input.riskSnapshot.quoteAssetId;
    const outputAssetId = input.marketObservation.assetId;
    if (inputAssetId.toLowerCase() === outputAssetId.toLowerCase()) fail("paper capacity input and output assets must differ");
    const balanceRaw = input.account.balances[inputAssetId] ?? "0";
    assertAtomicAmount(balanceRaw, "paper capacity available balance");
    const availableBalance = BigInt(balanceRaw);
    const nav = BigInt(input.riskSnapshot.markNavAtomic);
    const currentPortfolioExposure = BigInt(input.riskSnapshot.currentPortfolioExposureAtomic);
    const currentPositionExposure = BigInt(input.riskSnapshot.currentPositionExposureAtomic);
    const positionLimit = bpsAmount(nav, input.strategy.spec.risk.maximumPositionBps);
    const portfolioLimit = bpsAmount(nav, input.strategy.spec.risk.maximumPortfolioExposureBps);
    const positionHeadroom = headroom(positionLimit, currentPositionExposure);
    const portfolioHeadroom = headroom(portfolioLimit, currentPortfolioExposure);
    const structuralCapacity = minimum([availableBalance, positionHeadroom, portfolioHeadroom]);

    const reasons: PaperRiskCapacityReason[] = [];
    let hardGate = false;
    if (thresholdReached(input.riskSnapshot.dailyLossBps, input.strategy.spec.risk.maximumDailyLossBps)) {
      reasons.push("DAILY_LOSS_LIMIT_REACHED");
      hardGate = true;
    }
    if (thresholdReached(input.riskSnapshot.drawdownBps, input.strategy.spec.risk.maximumDrawdownBps)) {
      reasons.push("DRAWDOWN_LIMIT_REACHED");
      hardGate = true;
    }
    if (input.riskSnapshot.tradesToday >= input.strategy.spec.risk.maximumTradesPerDay) {
      reasons.push("TRADE_LIMIT_REACHED");
      hardGate = true;
    }
    if (
      currentPositionExposure === 0n
      && input.riskSnapshot.openPositionCount >= input.strategy.spec.risk.maximumOpenPositions
    ) {
      reasons.push("OPEN_POSITION_LIMIT_REACHED");
      hardGate = true;
    }
    if (availableBalance === 0n) reasons.push("NO_AVAILABLE_BALANCE");
    if (positionHeadroom === 0n) reasons.push("POSITION_LIMIT_REACHED");
    if (portfolioHeadroom === 0n) reasons.push("PORTFOLIO_LIMIT_REACHED");

    const maximumInputAmount = hardGate ? 0n : structuralCapacity;
    const requested = BigInt(input.requestedInputAmountAtomic);
    if (requested > maximumInputAmount) reasons.push("REQUEST_EXCEEDS_CAPACITY");
    const status = requested <= maximumInputAmount && maximumInputAmount > 0n ? "ADMITTED" as const : "BLOCKED" as const;
    const payload: Omit<PaperRiskCapacityPlan, "planHash"> = {
      status,
      policyVersion: this.config.policyVersion,
      agentId: input.agent.id,
      strategyVersion: input.strategy.version,
      strategyHash: input.strategy.strategyHash,
      accountSnapshot: structuredClone(input.account),
      riskSnapshot: structuredClone(input.riskSnapshot),
      marketObservation: structuredClone(input.marketObservation),
      inputAssetId,
      outputAssetId,
      requestedInputAmountAtomic: input.requestedInputAmountAtomic,
      admittedInputAmountAtomic: status === "ADMITTED" ? input.requestedInputAmountAtomic : null,
      maximumInputAmountAtomic: maximumInputAmount.toString(),
      capacity: {
        availableBalanceAtomic: availableBalance.toString(),
        positionLimitAtomic: positionLimit.toString(),
        currentPositionExposureAtomic: currentPositionExposure.toString(),
        positionHeadroomAtomic: positionHeadroom.toString(),
        portfolioLimitAtomic: portfolioLimit.toString(),
        currentPortfolioExposureAtomic: currentPortfolioExposure.toString(),
        portfolioHeadroomAtomic: portfolioHeadroom.toString(),
      },
      maximumSlippageBps: input.strategy.spec.execution.maximumSlippageBps,
      reasons,
      plannedAt,
    };
    const plan: PaperRiskCapacityPlan = { ...payload, planHash: hashCanonicalPayload(payload) };
    assertPaperRiskCapacityPlan(plan);
    return plan;
  }
}