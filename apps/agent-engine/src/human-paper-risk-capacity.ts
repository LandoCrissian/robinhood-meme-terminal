import {
  assertAtomicAmount,
  assertBps,
  assertNonEmptyString,
  assertPaperAccountParticipantIdentity,
  assertPositiveAtomicAmount,
  assertPositiveInteger,
  assertSafetyEnvelope,
  hashCanonicalPayload,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
  type PaperAccountRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperRiskSnapshot,
  type PaperRiskCapacityReason,
  type PaperRiskSnapshot,
} from "./paper-risk-capacity.ts";

export interface HumanPaperRiskPolicy {
  policyVersion: string;
  maximumPositionBps: number;
  maximumPortfolioExposureBps: number;
  maximumOpenPositions: number;
  maximumDailyLossBps: number;
  maximumDrawdownBps: number;
  maximumTradesPerDay: number;
  maximumSlippageBps: number;
  maximumPriceImpactBps: number;
}

export interface HumanPaperRiskCapacityPlan {
  schemaVersion: 1;
  status: "ADMITTED" | "BLOCKED";
  participantType: "HUMAN";
  participantId: string;
  policy: HumanPaperRiskPolicy;
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
  requestedMaximumSlippageBps: number;
  maximumPriceImpactBps: number;
  reasons: PaperRiskCapacityReason[];
  plannedAt: number;
  planHash: string;
}

export interface HumanPaperRiskCapacityPlannerConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  policy: HumanPaperRiskPolicy;
  maximumRiskSnapshotAgeMs: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTimestamp(value: number, field: string): void {
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
  assertBps(bps, "human paper capacity bps");
  return amount * BigInt(bps) / 10_000n;
}

function headroom(limit: bigint, current: bigint): bigint {
  return current >= limit ? 0n : limit - current;
}

function thresholdReached(current: number, maximum: number): boolean {
  assertBps(current, "human current risk bps");
  assertBps(maximum, "human maximum risk bps");
  return maximum === 0 ? current > 0 : current >= maximum;
}

export function assertHumanPaperRiskPolicyWithinSafety(
  policy: HumanPaperRiskPolicy,
  safety: AgentSafetyEnvelope,
): void {
  assertNonEmptyString(policy.policyVersion, "human paper risk policyVersion");
  assertBps(policy.maximumPositionBps, "human maximumPositionBps");
  assertBps(policy.maximumPortfolioExposureBps, "human maximumPortfolioExposureBps");
  assertPositiveInteger(policy.maximumOpenPositions, "human maximumOpenPositions");
  assertBps(policy.maximumDailyLossBps, "human maximumDailyLossBps");
  assertBps(policy.maximumDrawdownBps, "human maximumDrawdownBps");
  assertPositiveInteger(policy.maximumTradesPerDay, "human maximumTradesPerDay");
  assertBps(policy.maximumSlippageBps, "human maximumSlippageBps");
  assertBps(policy.maximumPriceImpactBps, "human maximumPriceImpactBps");
  const comparisons: Array<[number, number, string]> = [
    [policy.maximumPositionBps, safety.maximumPositionBps, "maximumPositionBps"],
    [policy.maximumPortfolioExposureBps, safety.maximumPortfolioExposureBps, "maximumPortfolioExposureBps"],
    [policy.maximumOpenPositions, safety.maximumOpenPositions, "maximumOpenPositions"],
    [policy.maximumDailyLossBps, safety.maximumDailyLossBps, "maximumDailyLossBps"],
    [policy.maximumDrawdownBps, safety.maximumDrawdownBps, "maximumDrawdownBps"],
    [policy.maximumTradesPerDay, safety.maximumTradesPerDay, "maximumTradesPerDay"],
    [policy.maximumSlippageBps, safety.maximumSlippageBps, "maximumSlippageBps"],
    [policy.maximumPriceImpactBps, safety.maximumPriceImpactBps, "maximumPriceImpactBps"],
  ];
  for (const [requested, maximum, field] of comparisons) {
    if (requested > maximum) fail(`human paper ${field} exceeds RMT safety envelope`);
  }
}

export function assertHumanPaperRiskCapacityPlan(plan: HumanPaperRiskCapacityPlan): void {
  if (plan.schemaVersion !== 1) fail("unsupported human paper risk capacity schema version");
  if (plan.participantType !== "HUMAN") fail("human paper capacity participant type mismatch");
  assertPaperAccountParticipantIdentity(plan.accountSnapshot);
  if (plan.accountSnapshot.participantType !== "HUMAN" || plan.accountSnapshot.participantId !== plan.participantId) {
    fail("human paper capacity account identity mismatch");
  }
  assertPaperRiskSnapshot(plan.riskSnapshot);
  assertHash(plan.planHash, "human paper capacity planHash");
  const { planHash, ...payload } = plan;
  if (planHash !== hashCanonicalPayload(payload)) fail("human paper capacity plan hash mismatch");
}

export class HumanPaperRiskCapacityPlanner {
  private readonly config: HumanPaperRiskCapacityPlannerConfig;

  constructor(config: HumanPaperRiskCapacityPlannerConfig) {
    this.config = structuredClone(config);
    assertSafetyEnvelope(this.config.safetyEnvelope);
    assertHumanPaperRiskPolicyWithinSafety(this.config.policy, this.config.safetyEnvelope);
    if (!Number.isSafeInteger(this.config.maximumRiskSnapshotAgeMs) || this.config.maximumRiskSnapshotAgeMs <= 0) {
      fail("human maximumRiskSnapshotAgeMs must be a positive safe integer");
    }
  }

  plan(input: {
    account: PaperAccountRecord;
    riskSnapshot: PaperRiskSnapshot;
    marketObservation: MarketObservationDraft;
    requestedInputAmountAtomic: string;
    requestedMaximumSlippageBps: number;
    plannedAt?: number;
  }): HumanPaperRiskCapacityPlan {
    const plannedAt = input.plannedAt ?? Date.now();
    assertTimestamp(plannedAt, "human paper capacity plannedAt");
    assertPaperAccountParticipantIdentity(input.account);
    if (input.account.participantType !== "HUMAN") fail("human paper capacity requires a HUMAN account");
    if (plannedAt < input.account.openedAt) fail("human paper capacity predates account");
    assertPaperRiskSnapshot(input.riskSnapshot);
    if (input.riskSnapshot.accountId !== input.account.accountId) fail("human paper capacity risk snapshot account mismatch");
    if (input.riskSnapshot.capturedAt > plannedAt) fail("human paper capacity risk snapshot is from the future");
    if (plannedAt - input.riskSnapshot.capturedAt > this.config.maximumRiskSnapshotAgeMs) fail("human paper capacity risk snapshot is stale");
    assertNonEmptyString(input.marketObservation.assetId, "human paper capacity market assetId");
    if (input.marketObservation.assetId.toLowerCase() !== input.riskSnapshot.positionAssetId.toLowerCase()) {
      fail("human paper capacity market observation does not match risk position asset");
    }
    assertPositiveAtomicAmount(input.requestedInputAmountAtomic, "human paper capacity requestedInputAmountAtomic");
    assertBps(input.requestedMaximumSlippageBps, "human paper requestedMaximumSlippageBps");
    if (input.requestedMaximumSlippageBps > this.config.policy.maximumSlippageBps) fail("human paper requested slippage exceeds risk policy");

    const inputAssetId = input.riskSnapshot.quoteAssetId;
    const outputAssetId = input.marketObservation.assetId;
    if (inputAssetId.toLowerCase() === outputAssetId.toLowerCase()) fail("human paper capacity input and output assets must differ");
    const balanceRaw = input.account.balances[inputAssetId] ?? "0";
    assertAtomicAmount(balanceRaw, "human paper capacity available balance");
    const availableBalance = BigInt(balanceRaw);
    const nav = BigInt(input.riskSnapshot.markNavAtomic);
    const currentPortfolioExposure = BigInt(input.riskSnapshot.currentPortfolioExposureAtomic);
    const currentPositionExposure = BigInt(input.riskSnapshot.currentPositionExposureAtomic);
    const positionLimit = bpsAmount(nav, this.config.policy.maximumPositionBps);
    const portfolioLimit = bpsAmount(nav, this.config.policy.maximumPortfolioExposureBps);
    const positionHeadroom = headroom(positionLimit, currentPositionExposure);
    const portfolioHeadroom = headroom(portfolioLimit, currentPortfolioExposure);
    const structuralCapacity = minimum([availableBalance, positionHeadroom, portfolioHeadroom]);

    const reasons: PaperRiskCapacityReason[] = [];
    let hardGate = false;
    if (thresholdReached(input.riskSnapshot.dailyLossBps, this.config.policy.maximumDailyLossBps)) {
      reasons.push("DAILY_LOSS_LIMIT_REACHED");
      hardGate = true;
    }
    if (thresholdReached(input.riskSnapshot.drawdownBps, this.config.policy.maximumDrawdownBps)) {
      reasons.push("DRAWDOWN_LIMIT_REACHED");
      hardGate = true;
    }
    if (input.riskSnapshot.tradesToday >= this.config.policy.maximumTradesPerDay) {
      reasons.push("TRADE_LIMIT_REACHED");
      hardGate = true;
    }
    if (currentPositionExposure === 0n && input.riskSnapshot.openPositionCount >= this.config.policy.maximumOpenPositions) {
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
    const payload: Omit<HumanPaperRiskCapacityPlan, "planHash"> = {
      schemaVersion: 1,
      status,
      participantType: "HUMAN",
      participantId: input.account.participantId,
      policy: structuredClone(this.config.policy),
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
      requestedMaximumSlippageBps: input.requestedMaximumSlippageBps,
      maximumPriceImpactBps: this.config.policy.maximumPriceImpactBps,
      reasons,
      plannedAt,
    };
    const plan: HumanPaperRiskCapacityPlan = { ...payload, planHash: hashCanonicalPayload(payload) };
    assertHumanPaperRiskCapacityPlan(plan);
    return plan;
  }
}
