import { randomUUID } from "node:crypto";
import {
  assertAtomicAmount,
  assertBps,
  assertNonEmptyString,
  assertPerformanceTransition,
  assertPositiveAtomicAmount,
  assertPositiveInteger,
  assertStrategyWithinSafetyEnvelope,
  assertUnitInterval,
  calculateTimeDecayedBrier,
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type AgentDecision,
  type AgentRecord,
  type AgentSafetyEnvelope,
  type PaperAccountRecord,
  type PaperExecutionCosts,
  type PaperFillRecord,
  type PaperOrderIntent,
  type PaperOrderRecord,
  type PortfolioSnapshot,
  type PredictionRecord,
  type RiskEventRecord,
  type RiskSeverity,
  type ScoreSnapshotRecord,
  type SeasonRecord,
  type StrategySpec,
  type StrategyVersionRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import { emptyAgentEngineSnapshot, type AgentEngineSnapshot } from "./snapshot.ts";

export interface AgentEngineConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  paperFillDelayMs: number;
  policyVersion: string;
}

export interface AgentSummary {
  agent: AgentRecord;
  latestStrategy?: StrategyVersionRecord;
  totalPredictions: number;
  resolvedPredictions: number;
  brierScore: number;
  paperFills: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertDecisionAction(action: string): void {
  if (!["NO_ACTION", "PREDICTION", "OPEN_POSITION", "CLOSE_POSITION"].includes(action)) {
    throw new Error("unsupported decision action");
  }
}

function assertRiskSeverity(severity: string): asserts severity is RiskSeverity {
  if (!["INFO", "WARNING", "CRITICAL"].includes(severity)) throw new Error("unsupported risk severity");
}

function assertNonNegativeTimestamp(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
}

function assertEvmAddress(address: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("ownerAddress must be a 20-byte EVM address");
}

function assertHash(value: string, field: string): void {
  if (!/^0x[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a sha256 hex hash`);
}

function sortBy<T>(values: Iterable<T>, selector: (value: T) => string): T[] {
  return [...values].sort((a, b) => selector(a).localeCompare(selector(b)));
}

export class AgentEngine {
  private readonly config: AgentEngineConfig;
  private readonly seasons = new Map<string, SeasonRecord>();
  private readonly agents = new Map<string, AgentRecord>();
  private readonly strategies = new Map<string, StrategyVersionRecord[]>();
  private readonly accounts = new Map<string, PaperAccountRecord>();
  private readonly decisions = new Map<string, AgentDecision>();
  private readonly predictions = new Map<string, PredictionRecord>();
  private readonly orders = new Map<string, PaperOrderRecord>();
  private readonly fills = new Map<string, PaperFillRecord>();
  private readonly portfolioSnapshots = new Map<string, PortfolioSnapshot>();
  private readonly riskEvents = new Map<string, RiskEventRecord>();
  private readonly scoreSnapshots = new Map<string, ScoreSnapshotRecord>();

  constructor(config: AgentEngineConfig) {
    this.config = clone(config);
    if (!Number.isInteger(config.paperFillDelayMs) || config.paperFillDelayMs < 0) throw new Error("paperFillDelayMs must be a non-negative integer");
    assertNonEmptyString(config.policyVersion, "policyVersion");
    assertStrategyWithinSafetyEnvelope({
      schemaVersion: 1,
      universe: { assetClasses: ["RWA"] },
      timeframe: { evaluationIntervalSeconds: config.safetyEnvelope.minimumEvaluationIntervalSeconds, predictionHorizonSeconds: 1 },
      signals: [{ type: "safety-self-check", weight: 1 }],
      prediction: { enabled: false, minimumConfidence: 0 },
      risk: {
        maximumPositionBps: config.safetyEnvelope.maximumPositionBps,
        maximumPortfolioExposureBps: config.safetyEnvelope.maximumPortfolioExposureBps,
        maximumOpenPositions: config.safetyEnvelope.maximumOpenPositions,
        maximumDailyLossBps: config.safetyEnvelope.maximumDailyLossBps,
        maximumDrawdownBps: config.safetyEnvelope.maximumDrawdownBps,
        maximumTradesPerDay: config.safetyEnvelope.maximumTradesPerDay,
      },
      execution: {
        venuePolicy: "RMT_BEST_VERIFIED",
        maximumSlippageBps: config.safetyEnvelope.maximumSlippageBps,
        maximumPriceImpactBps: config.safetyEnvelope.maximumPriceImpactBps,
      },
      prohibitedActions: [],
    }, config.safetyEnvelope);
  }

  static fromSnapshot(config: AgentEngineConfig, snapshot: AgentEngineSnapshot): AgentEngine {
    const engine = new AgentEngine(config);
    engine.loadSnapshot(snapshot);
    return engine;
  }

  createSeason(input: { seasonId: string; name: string; startsAt: number; endsAt?: number; createdAt?: number }): SeasonRecord {
    assertNonEmptyString(input.seasonId, "seasonId");
    assertNonEmptyString(input.name, "season name");
    assertNonNegativeTimestamp(input.startsAt, "season startsAt");
    if (input.endsAt !== undefined) {
      assertNonNegativeTimestamp(input.endsAt, "season endsAt");
      if (input.endsAt <= input.startsAt) throw new Error("season endsAt must be after startsAt");
    }
    if (this.seasons.has(input.seasonId)) throw new Error("season already exists");
    const createdAt = input.createdAt ?? Date.now();
    assertNonNegativeTimestamp(createdAt, "season createdAt");
    const season: SeasonRecord = {
      seasonId: input.seasonId.trim(),
      name: input.name.trim(),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt,
    };
    this.seasons.set(season.seasonId, season);
    return clone(season);
  }

  registerAgent(input: { ownerAddress: string; name: string; thesis: string; createdAt?: number }): AgentRecord {
    assertEvmAddress(input.ownerAddress);
    assertNonEmptyString(input.name, "agent name");
    assertNonEmptyString(input.thesis, "agent thesis");
    const createdAt = input.createdAt ?? Date.now();
    assertNonNegativeTimestamp(createdAt, "createdAt");
    const agent: AgentRecord = {
      id: randomUUID(),
      ownerAddress: input.ownerAddress.toLowerCase(),
      name: input.name.trim(),
      thesis: input.thesis.trim(),
      performanceState: "INCUBATING",
      executionMode: "PAPER_ONLY",
      createdAt,
    };
    this.agents.set(agent.id, agent);
    return clone(agent);
  }

  createStrategyVersion(agentId: string, spec: StrategySpec, createdAt = Date.now()): StrategyVersionRecord {
    this.requireAgent(agentId);
    assertNonNegativeTimestamp(createdAt, "strategy createdAt");
    assertStrategyWithinSafetyEnvelope(spec, this.config.safetyEnvelope);
    const existing = this.strategies.get(agentId) ?? [];
    const version = existing.length + 1;
    const strategy: StrategyVersionRecord = {
      id: randomUUID(),
      agentId,
      version,
      spec: clone(spec),
      strategyHash: hashCanonicalPayload({ agentId, version, spec }),
      createdAt,
    };
    existing.push(strategy);
    this.strategies.set(agentId, existing);
    return clone(strategy);
  }

  activatePaperAgent(agentId: string): AgentRecord {
    const agent = this.requireAgent(agentId);
    if ((this.strategies.get(agentId) ?? []).length === 0) throw new Error("agent requires a strategy before paper activation");
    assertPerformanceTransition(agent.performanceState, "PAPER_ACTIVE");
    agent.performanceState = "PAPER_ACTIVE";
    return clone(agent);
  }

  openPaperAccount(input: { agentId: string; seasonId: string; initialBalances: Record<string, string>; openedAt?: number }): PaperAccountRecord {
    const agent = this.requirePaperActiveAgent(input.agentId);
    if (agent.executionMode !== "PAPER_ONLY") throw new Error("foundation agent execution must remain PAPER_ONLY");
    const season = this.requireSeason(input.seasonId);
    const balances: Record<string, string> = {};
    for (const [assetId, amount] of Object.entries(input.initialBalances)) {
      assertNonEmptyString(assetId, "assetId");
      assertAtomicAmount(amount, `balance ${assetId}`);
      balances[assetId] = amount;
    }
    if (Object.keys(balances).length === 0) throw new Error("paper account requires at least one starting balance");
    const openedAt = input.openedAt ?? Date.now();
    assertNonNegativeTimestamp(openedAt, "openedAt");
    if (openedAt < season.startsAt) throw new Error("paper account cannot open before season start");
    if (season.endsAt !== undefined && openedAt > season.endsAt) throw new Error("paper account cannot open after season end");
    const existing = [...this.accounts.values()].find((account) => account.participantId === input.agentId && account.seasonId === input.seasonId);
    if (existing) throw new Error("agent already has a paper account for season");
    const account: PaperAccountRecord = {
      accountId: randomUUID(),
      seasonId: input.seasonId,
      participantType: "AGENT",
      participantId: input.agentId,
      balances,
      openedAt,
    };
    this.accounts.set(account.accountId, account);
    return clone(account);
  }

  recordDecision(input: Omit<AgentDecision, "decisionId" | "decisionHash" | "policyVersion">): AgentDecision {
    this.requirePaperActiveAgent(input.agentId);
    this.requireStrategyVersion(input.agentId, input.strategyVersion);
    assertNonEmptyString(input.marketSnapshotId, "marketSnapshotId");
    assertUnitInterval(input.confidence, "decision confidence");
    assertDecisionAction(input.action);
    assertNonEmptyString(input.reasoningSummary, "reasoningSummary");
    if (input.reasoningSummary.length > 1_024) throw new Error("reasoningSummary exceeds 1024 characters");
    assertNonEmptyString(input.modelIdentity, "modelIdentity");
    assertNonEmptyString(input.compilerVersion, "compilerVersion");
    assertNonNegativeTimestamp(input.createdAt, "decision createdAt");
    const decisionBase = { ...clone(input), policyVersion: this.config.policyVersion };
    const decision: AgentDecision = {
      ...decisionBase,
      decisionId: randomUUID(),
      decisionHash: hashCanonicalPayload(decisionBase),
    };
    this.decisions.set(decision.decisionId, decision);
    return clone(decision);
  }

  submitPrediction(input: Omit<PredictionRecord, "predictionId" | "resolvedOutcome" | "resolvedAt">): PredictionRecord {
    this.requirePaperActiveAgent(input.agentId);
    const strategy = this.requireStrategyVersion(input.agentId, input.strategyVersion);
    if (!strategy.spec.prediction.enabled) throw new Error("strategy predictions are disabled");
    assertNonEmptyString(input.assetId, "assetId");
    assertNonEmptyString(input.condition, "prediction condition");
    assertUnitInterval(input.forecastProbability, "forecastProbability");
    assertNonNegativeTimestamp(input.createdAt, "prediction createdAt");
    assertNonNegativeTimestamp(input.resolvesAt, "prediction resolvesAt");
    if (input.resolvesAt <= input.createdAt) throw new Error("prediction resolvesAt must be after createdAt");
    const prediction: PredictionRecord = { ...clone(input), predictionId: randomUUID() };
    this.predictions.set(prediction.predictionId, prediction);
    return clone(prediction);
  }

  resolvePrediction(predictionId: string, outcome: 0 | 1, resolvedAt: number): PredictionRecord {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) throw new Error("unknown prediction");
    if (prediction.resolvedOutcome !== undefined) throw new Error("prediction already resolved");
    if (outcome !== 0 && outcome !== 1) throw new Error("prediction outcome must be 0 or 1");
    assertNonNegativeTimestamp(resolvedAt, "resolvedAt");
    if (resolvedAt < prediction.resolvesAt) throw new Error("prediction cannot resolve before resolvesAt");
    prediction.resolvedOutcome = outcome;
    prediction.resolvedAt = resolvedAt;
    return clone(prediction);
  }

  submitPaperOrder(intent: PaperOrderIntent): PaperOrderRecord {
    this.requirePaperActiveAgent(intent.agentId);
    const strategy = this.requireStrategyVersion(intent.agentId, intent.strategyVersion);
    const account = this.requireAccount(intent.accountId);
    if (account.participantId !== intent.agentId || account.participantType !== "AGENT") throw new Error("paper account does not belong to agent");
    assertNonEmptyString(intent.inputAssetId, "inputAssetId");
    assertNonEmptyString(intent.outputAssetId, "outputAssetId");
    if (intent.inputAssetId === intent.outputAssetId) throw new Error("paper order assets must differ");
    assertPositiveAtomicAmount(intent.inputAmountAtomic, "inputAmountAtomic");
    assertBps(intent.maximumSlippageBps, "maximumSlippageBps");
    if (intent.maximumSlippageBps > strategy.spec.execution.maximumSlippageBps || intent.maximumSlippageBps > this.config.safetyEnvelope.maximumSlippageBps) {
      throw new Error("paper order slippage exceeds strategy or safety policy");
    }
    assertNonNegativeTimestamp(intent.createdAt, "order createdAt");
    const season = this.requireSeason(account.seasonId);
    if (intent.createdAt < account.openedAt || intent.createdAt < season.startsAt) throw new Error("paper order predates account or season");
    if (season.endsAt !== undefined && intent.createdAt > season.endsAt) throw new Error("paper order is outside season window");
    const order: PaperOrderRecord = { ...clone(intent), orderId: randomUUID(), status: "PENDING" };
    this.orders.set(order.orderId, order);
    return clone(order);
  }

  fillPaperOrder(
    orderId: string,
    quote: VerifiedPaperQuoteEvidence,
    costs: PaperExecutionCosts = { feeAmountAtomic: "0", gasCostAtomic: "0" },
  ): PaperFillRecord {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("unknown paper order");
    if (order.status !== "PENDING") throw new Error("paper order is not pending");
    assertPositiveAtomicAmount(quote.outputAmountAtomic, "quote.outputAmountAtomic");
    assertPositiveAtomicAmount(quote.inputAmountAtomic, "quote.inputAmountAtomic");
    assertAtomicAmount(costs.feeAmountAtomic, "feeAmountAtomic");
    assertAtomicAmount(costs.gasCostAtomic, "gasCostAtomic");
    assertNonEmptyString(quote.quoteId, "quoteId");
    assertNonEmptyString(quote.providerId, "providerId");
    assertNonEmptyString(quote.evidenceHash, "evidenceHash");
    assertHash(quote.evidenceHash, "evidenceHash");
    assertBps(quote.priceImpactBps, "quote.priceImpactBps");
    const strategy = this.requireStrategyVersion(order.agentId, order.strategyVersion);
    if (quote.priceImpactBps > strategy.spec.execution.maximumPriceImpactBps || quote.priceImpactBps > this.config.safetyEnvelope.maximumPriceImpactBps) {
      throw new Error("paper quote price impact exceeds strategy or safety policy");
    }
    const { evidenceHash, ...quotePayload } = quote;
    if (evidenceHash !== hashPaperQuoteEvidence(quotePayload)) throw new Error("paper quote evidence hash mismatch");
    if (BigInt(costs.feeAmountAtomic) > 0n && !costs.feeAssetId) throw new Error("non-zero fee requires feeAssetId");
    if (BigInt(costs.gasCostAtomic) > 0n && !costs.gasAssetId) throw new Error("non-zero gas cost requires gasAssetId");
    if (costs.feeAssetId) assertNonEmptyString(costs.feeAssetId, "feeAssetId");
    if (costs.gasAssetId) assertNonEmptyString(costs.gasAssetId, "gasAssetId");
    if (quote.inputAssetId !== order.inputAssetId || quote.outputAssetId !== order.outputAssetId || quote.inputAmountAtomic !== order.inputAmountAtomic) {
      throw new Error("paper quote does not match order");
    }
    const earliestFill = order.createdAt + this.config.paperFillDelayMs;
    assertNonNegativeTimestamp(quote.observedAt, "quote.observedAt");
    if (quote.observedAt < earliestFill) throw new Error("paper quote observed before fill-delay boundary");
    if (quote.expiresAt !== undefined) {
      assertNonNegativeTimestamp(quote.expiresAt, "quote.expiresAt");
      if (quote.observedAt > quote.expiresAt) throw new Error("paper quote is expired");
    }
    if (quote.quoteBlockNumber !== undefined) assertAtomicAmount(quote.quoteBlockNumber, "quoteBlockNumber");

    const account = this.requireAccount(order.accountId);
    const season = this.requireSeason(account.seasonId);
    if (season.endsAt !== undefined && quote.observedAt > season.endsAt) throw new Error("paper fill is outside season window");
    const nextBalances = new Map<string, bigint>(Object.entries(account.balances).map(([assetId, amount]) => [assetId, BigInt(amount)]));
    const debit = (assetId: string, amount: bigint, label: string) => {
      if (amount === 0n) return;
      const balance = nextBalances.get(assetId) ?? 0n;
      if (balance < amount) throw new Error(`insufficient paper balance for ${label}`);
      nextBalances.set(assetId, balance - amount);
    };
    const credit = (assetId: string, amount: bigint) => nextBalances.set(assetId, (nextBalances.get(assetId) ?? 0n) + amount);

    debit(order.inputAssetId, BigInt(order.inputAmountAtomic), "trade input");
    credit(order.outputAssetId, BigInt(quote.outputAmountAtomic));
    if (costs.feeAssetId) debit(costs.feeAssetId, BigInt(costs.feeAmountAtomic), "simulated fee");
    if (costs.gasAssetId) debit(costs.gasAssetId, BigInt(costs.gasCostAtomic), "simulated gas");

    account.balances = Object.fromEntries([...nextBalances.entries()].map(([assetId, amount]) => [assetId, amount.toString()]));
    order.status = "FILLED";

    const fill: PaperFillRecord = {
      fillId: randomUUID(),
      orderId: order.orderId,
      quoteId: quote.quoteId,
      agentId: order.agentId,
      accountId: order.accountId,
      inputAssetId: order.inputAssetId,
      outputAssetId: order.outputAssetId,
      inputAmountAtomic: order.inputAmountAtomic,
      outputAmountAtomic: quote.outputAmountAtomic,
      providerId: quote.providerId,
      feeAssetId: costs.feeAssetId,
      feeAmountAtomic: costs.feeAmountAtomic,
      gasAssetId: costs.gasAssetId,
      gasCostAtomic: costs.gasCostAtomic,
      filledAt: quote.observedAt,
      evidenceHash: quote.evidenceHash,
      quoteEvidence: clone(quote),
    };
    this.fills.set(fill.fillId, fill);
    return clone(fill);
  }

  recordPortfolioSnapshot(input: PortfolioSnapshot): PortfolioSnapshot {
    const account = this.requireAccount(input.accountId);
    assertNonNegativeTimestamp(input.capturedAt, "portfolio capturedAt");
    if (input.capturedAt < account.openedAt) throw new Error("portfolio snapshot predates account");
    assertNonEmptyString(input.quoteAssetId, "quoteAssetId");
    assertPositiveAtomicAmount(input.markNavAtomic, "markNavAtomic");
    assertPositiveAtomicAmount(input.liquidationNavAtomic, "liquidationNavAtomic");
    const key = `${input.accountId}:${input.capturedAt}`;
    if (this.portfolioSnapshots.has(key)) throw new Error("portfolio snapshot already exists for timestamp");
    const snapshot = clone(input);
    this.portfolioSnapshots.set(key, snapshot);
    return clone(snapshot);
  }

  recordRiskEvent(input: Omit<RiskEventRecord, "riskEventId" | "policyVersion">): RiskEventRecord {
    this.requireAgent(input.agentId);
    if (input.accountId) {
      const account = this.requireAccount(input.accountId);
      if (account.participantId !== input.agentId) throw new Error("risk event account does not belong to agent");
    }
    assertNonEmptyString(input.type, "risk event type");
    assertRiskSeverity(input.severity);
    assertNonEmptyString(input.detail, "risk detail");
    if (input.detail.length > 1_024) throw new Error("risk detail exceeds 1024 characters");
    assertNonNegativeTimestamp(input.occurredAt, "risk occurredAt");
    const event: RiskEventRecord = {
      ...clone(input),
      riskEventId: randomUUID(),
      policyVersion: this.config.policyVersion,
    };
    this.riskEvents.set(event.riskEventId, event);
    return clone(event);
  }

  captureScoreSnapshot(input: { agentId: string; seasonId: string; capturedAt: number }): ScoreSnapshotRecord {
    this.requireAgent(input.agentId);
    const season = this.requireSeason(input.seasonId);
    assertNonNegativeTimestamp(input.capturedAt, "score capturedAt");
    if (input.capturedAt < season.startsAt) throw new Error("score snapshot predates season");
    const inSeason = (timestamp: number) => timestamp >= season.startsAt && (season.endsAt === undefined || timestamp <= season.endsAt) && timestamp <= input.capturedAt;
    const predictions = [...this.predictions.values()].filter((prediction) => prediction.agentId === input.agentId && inSeason(prediction.createdAt));
    const fills = [...this.fills.values()].filter((fill) => fill.agentId === input.agentId && inSeason(fill.filledAt));
    const snapshot: ScoreSnapshotRecord = {
      scoreSnapshotId: randomUUID(),
      agentId: input.agentId,
      seasonId: input.seasonId,
      brierScore: calculateTimeDecayedBrier(predictions),
      predictionCount: predictions.length,
      resolvedPredictionCount: predictions.filter((prediction) => prediction.resolvedOutcome !== undefined).length,
      paperFillCount: fills.length,
      capturedAt: input.capturedAt,
    };
    this.scoreSnapshots.set(snapshot.scoreSnapshotId, snapshot);
    return clone(snapshot);
  }

  getPaperAccount(accountId: string): PaperAccountRecord {
    return clone(this.requireAccount(accountId));
  }

  getSeason(seasonId: string): SeasonRecord {
    return clone(this.requireSeason(seasonId));
  }

  getAgentSummary(agentId: string): AgentSummary {
    const agent = this.requireAgent(agentId);
    const strategies = this.strategies.get(agentId) ?? [];
    const predictions = [...this.predictions.values()].filter((prediction) => prediction.agentId === agentId);
    const fills = [...this.fills.values()].filter((fill) => fill.agentId === agentId);
    return {
      agent: clone(agent),
      latestStrategy: strategies.length ? clone(strategies[strategies.length - 1]!) : undefined,
      totalPredictions: predictions.length,
      resolvedPredictions: predictions.filter((prediction) => prediction.resolvedOutcome !== undefined).length,
      brierScore: calculateTimeDecayedBrier(predictions),
      paperFills: fills.length,
    };
  }

  exportSnapshot(): AgentEngineSnapshot {
    const snapshot = emptyAgentEngineSnapshot();
    snapshot.seasons = sortBy(this.seasons.values(), (value) => value.seasonId).map(clone);
    snapshot.agents = sortBy(this.agents.values(), (value) => value.id).map(clone);
    snapshot.strategyVersions = sortBy(
      [...this.strategies.values()].flat(),
      (value) => `${value.agentId}:${String(value.version).padStart(12, "0")}:${value.id}`,
    ).map(clone);
    snapshot.paperAccounts = sortBy(this.accounts.values(), (value) => value.accountId).map(clone);
    snapshot.decisions = sortBy(this.decisions.values(), (value) => value.decisionId).map(clone);
    snapshot.predictions = sortBy(this.predictions.values(), (value) => value.predictionId).map(clone);
    snapshot.paperOrders = sortBy(this.orders.values(), (value) => value.orderId).map(clone);
    snapshot.paperFills = sortBy(this.fills.values(), (value) => value.fillId).map(clone);
    snapshot.portfolioSnapshots = sortBy(this.portfolioSnapshots.values(), (value) => `${value.accountId}:${String(value.capturedAt).padStart(16, "0")}`).map(clone);
    snapshot.riskEvents = sortBy(this.riskEvents.values(), (value) => value.riskEventId).map(clone);
    snapshot.scoreSnapshots = sortBy(this.scoreSnapshots.values(), (value) => value.scoreSnapshotId).map(clone);
    return snapshot;
  }

  private loadSnapshot(snapshotInput: AgentEngineSnapshot): void {
    const snapshot = clone(snapshotInput);
    if (snapshot.schemaVersion !== 1) throw new Error("unsupported agent engine snapshot version");

    for (const season of snapshot.seasons) {
      assertNonEmptyString(season.seasonId, "snapshot seasonId");
      assertNonEmptyString(season.name, "snapshot season name");
      assertNonNegativeTimestamp(season.startsAt, "snapshot season startsAt");
      assertNonNegativeTimestamp(season.createdAt, "snapshot season createdAt");
      if (season.endsAt !== undefined) {
        assertNonNegativeTimestamp(season.endsAt, "snapshot season endsAt");
        if (season.endsAt <= season.startsAt) throw new Error("snapshot season endsAt must be after startsAt");
      }
      if (this.seasons.has(season.seasonId)) throw new Error("duplicate season in snapshot");
      this.seasons.set(season.seasonId, season);
    }

    for (const agent of snapshot.agents) {
      assertNonEmptyString(agent.id, "snapshot agent id");
      assertEvmAddress(agent.ownerAddress);
      if (agent.executionMode !== "PAPER_ONLY") throw new Error("snapshot contains non-paper execution mode");
      assertNonEmptyString(agent.name, "snapshot agent name");
      assertNonEmptyString(agent.thesis, "snapshot agent thesis");
      assertNonNegativeTimestamp(agent.createdAt, "snapshot agent createdAt");
      if (this.agents.has(agent.id)) throw new Error("duplicate agent in snapshot");
      this.agents.set(agent.id, agent);
    }

    for (const strategy of snapshot.strategyVersions) {
      this.requireAgent(strategy.agentId);
      assertPositiveInteger(strategy.version, "snapshot strategy version");
      assertNonNegativeTimestamp(strategy.createdAt, "snapshot strategy createdAt");
      assertStrategyWithinSafetyEnvelope(strategy.spec, this.config.safetyEnvelope);
      assertHash(strategy.strategyHash, "snapshot strategyHash");
      if (strategy.strategyHash !== hashCanonicalPayload({ agentId: strategy.agentId, version: strategy.version, spec: strategy.spec })) {
        throw new Error("snapshot strategy hash mismatch");
      }
      const existing = this.strategies.get(strategy.agentId) ?? [];
      if (existing.some((candidate) => candidate.version === strategy.version || candidate.id === strategy.id)) throw new Error("duplicate strategy in snapshot");
      existing.push(strategy);
      existing.sort((a, b) => a.version - b.version);
      this.strategies.set(strategy.agentId, existing);
    }
    for (const [agentId, versions] of this.strategies.entries()) {
      versions.forEach((strategy, index) => {
        if (strategy.version !== index + 1) throw new Error(`snapshot strategy versions are not contiguous for agent ${agentId}`);
      });
    }
    for (const agent of this.agents.values()) {
      if (["PAPER_ACTIVE", "QUALIFIED", "ELITE"].includes(agent.performanceState) && (this.strategies.get(agent.id) ?? []).length === 0) {
        throw new Error("snapshot paper-active agent is missing a strategy");
      }
    }

    for (const account of snapshot.paperAccounts) {
      this.requireAgent(account.participantId);
      this.requireSeason(account.seasonId);
      if (account.participantType !== "AGENT") throw new Error("foundation snapshot only supports AGENT paper accounts");
      assertNonNegativeTimestamp(account.openedAt, "snapshot account openedAt");
      const season = this.requireSeason(account.seasonId);
      if (account.openedAt < season.startsAt || (season.endsAt !== undefined && account.openedAt > season.endsAt)) throw new Error("snapshot account is outside season window");
      for (const [assetId, amount] of Object.entries(account.balances)) {
        assertNonEmptyString(assetId, "snapshot balance assetId");
        assertAtomicAmount(amount, "snapshot balance");
      }
      if (this.accounts.has(account.accountId)) throw new Error("duplicate paper account in snapshot");
      this.accounts.set(account.accountId, account);
    }

    for (const decision of snapshot.decisions) {
      this.requireAgent(decision.agentId);
      this.requireStrategyVersion(decision.agentId, decision.strategyVersion);
      assertDecisionAction(decision.action);
      assertNonEmptyString(decision.marketSnapshotId, "snapshot marketSnapshotId");
      assertNonEmptyString(decision.reasoningSummary, "snapshot reasoningSummary");
      assertNonEmptyString(decision.modelIdentity, "snapshot modelIdentity");
      assertNonEmptyString(decision.compilerVersion, "snapshot compilerVersion");
      assertNonEmptyString(decision.policyVersion, "snapshot policyVersion");
      assertUnitInterval(decision.confidence, "snapshot decision confidence");
      assertNonNegativeTimestamp(decision.createdAt, "snapshot decision createdAt");
      assertHash(decision.decisionHash, "snapshot decisionHash");
      const { decisionId: _id, decisionHash: _hash, ...base } = decision;
      if (decision.decisionHash !== hashCanonicalPayload(base)) throw new Error("snapshot decision hash mismatch");
      if (this.decisions.has(decision.decisionId)) throw new Error("duplicate decision in snapshot");
      this.decisions.set(decision.decisionId, decision);
    }

    for (const prediction of snapshot.predictions) {
      this.requireAgent(prediction.agentId);
      this.requireStrategyVersion(prediction.agentId, prediction.strategyVersion);
      assertNonEmptyString(prediction.assetId, "snapshot prediction assetId");
      assertNonEmptyString(prediction.condition, "snapshot prediction condition");
      assertUnitInterval(prediction.forecastProbability, "snapshot forecastProbability");
      assertNonNegativeTimestamp(prediction.createdAt, "snapshot prediction createdAt");
      assertNonNegativeTimestamp(prediction.resolvesAt, "snapshot prediction resolvesAt");
      if (prediction.resolvesAt <= prediction.createdAt) throw new Error("snapshot prediction resolvesAt must be after createdAt");
      const resolved = prediction.resolvedOutcome !== undefined || prediction.resolvedAt !== undefined;
      if (resolved && (prediction.resolvedOutcome === undefined || prediction.resolvedAt === undefined)) throw new Error("snapshot prediction resolution is incomplete");
      if (prediction.resolvedOutcome !== undefined && prediction.resolvedOutcome !== 0 && prediction.resolvedOutcome !== 1) throw new Error("snapshot prediction outcome invalid");
      if (prediction.resolvedAt !== undefined && prediction.resolvedAt < prediction.resolvesAt) throw new Error("snapshot prediction resolved too early");
      if (this.predictions.has(prediction.predictionId)) throw new Error("duplicate prediction in snapshot");
      this.predictions.set(prediction.predictionId, prediction);
    }

    for (const order of snapshot.paperOrders) {
      this.requireAgent(order.agentId);
      this.requireStrategyVersion(order.agentId, order.strategyVersion);
      const account = this.requireAccount(order.accountId);
      if (account.participantId !== order.agentId) throw new Error("snapshot order account does not belong to agent");
      assertNonEmptyString(order.inputAssetId, "snapshot inputAssetId");
      assertNonEmptyString(order.outputAssetId, "snapshot outputAssetId");
      if (order.inputAssetId === order.outputAssetId) throw new Error("snapshot paper order assets must differ");
      assertPositiveAtomicAmount(order.inputAmountAtomic, "snapshot inputAmountAtomic");
      assertBps(order.maximumSlippageBps, "snapshot maximumSlippageBps");
      const strategy = this.requireStrategyVersion(order.agentId, order.strategyVersion);
      if (order.maximumSlippageBps > strategy.spec.execution.maximumSlippageBps || order.maximumSlippageBps > this.config.safetyEnvelope.maximumSlippageBps) throw new Error("snapshot paper order slippage exceeds policy");
      assertNonNegativeTimestamp(order.createdAt, "snapshot order createdAt");
      const orderSeason = this.requireSeason(account.seasonId);
      if (order.createdAt < account.openedAt || order.createdAt < orderSeason.startsAt || (orderSeason.endsAt !== undefined && order.createdAt > orderSeason.endsAt)) throw new Error("snapshot paper order is outside account or season window");
      if (!["PENDING", "FILLED", "CANCELLED"].includes(order.status)) throw new Error("snapshot order status invalid");
      if (this.orders.has(order.orderId)) throw new Error("duplicate order in snapshot");
      this.orders.set(order.orderId, order);
    }

    const filledOrderIds = new Set<string>();
    for (const fill of snapshot.paperFills) {
      const order = this.orders.get(fill.orderId);
      if (!order) throw new Error("snapshot fill references unknown order");
      if (filledOrderIds.has(fill.orderId)) throw new Error("snapshot contains multiple fills for order");
      filledOrderIds.add(fill.orderId);
      if (order.status !== "FILLED") throw new Error("snapshot fill references non-filled order");
      if (fill.agentId !== order.agentId || fill.accountId !== order.accountId || fill.inputAssetId !== order.inputAssetId || fill.outputAssetId !== order.outputAssetId || fill.inputAmountAtomic !== order.inputAmountAtomic) {
        throw new Error("snapshot fill does not match order");
      }
      assertPositiveAtomicAmount(fill.outputAmountAtomic, "snapshot fill outputAmountAtomic");
      assertAtomicAmount(fill.feeAmountAtomic, "snapshot feeAmountAtomic");
      assertAtomicAmount(fill.gasCostAtomic, "snapshot gasCostAtomic");
      assertNonNegativeTimestamp(fill.filledAt, "snapshot filledAt");
      assertHash(fill.evidenceHash, "snapshot evidenceHash");
      if (fill.quoteEvidence.evidenceHash !== fill.evidenceHash) throw new Error("snapshot fill evidence hash does not match quote evidence");
      const { evidenceHash: storedQuoteHash, ...storedQuotePayload } = fill.quoteEvidence;
      if (storedQuoteHash !== hashPaperQuoteEvidence(storedQuotePayload)) throw new Error("snapshot fill quote evidence hash mismatch");
      if (
        fill.quoteEvidence.quoteId !== fill.quoteId ||
        fill.quoteEvidence.providerId !== fill.providerId ||
        fill.quoteEvidence.inputAssetId !== fill.inputAssetId ||
        fill.quoteEvidence.outputAssetId !== fill.outputAssetId ||
        fill.quoteEvidence.inputAmountAtomic !== fill.inputAmountAtomic ||
        fill.quoteEvidence.outputAmountAtomic !== fill.outputAmountAtomic ||
        fill.quoteEvidence.observedAt !== fill.filledAt
      ) throw new Error("snapshot fill quote evidence does not match fill");
      if (BigInt(fill.feeAmountAtomic) > 0n && !fill.feeAssetId) throw new Error("snapshot non-zero fee is missing fee asset");
      if (BigInt(fill.gasCostAtomic) > 0n && !fill.gasAssetId) throw new Error("snapshot non-zero gas cost is missing gas asset");
      if (this.fills.has(fill.fillId)) throw new Error("duplicate fill in snapshot");
      this.fills.set(fill.fillId, fill);
    }
    for (const order of this.orders.values()) {
      if (order.status === "FILLED" && !filledOrderIds.has(order.orderId)) throw new Error("snapshot filled order is missing fill record");
    }

    for (const portfolio of snapshot.portfolioSnapshots) {
      this.requireAccount(portfolio.accountId);
      assertNonNegativeTimestamp(portfolio.capturedAt, "snapshot portfolio capturedAt");
      assertNonEmptyString(portfolio.quoteAssetId, "snapshot quoteAssetId");
      assertPositiveAtomicAmount(portfolio.markNavAtomic, "snapshot markNavAtomic");
      assertPositiveAtomicAmount(portfolio.liquidationNavAtomic, "snapshot liquidationNavAtomic");
      const key = `${portfolio.accountId}:${portfolio.capturedAt}`;
      if (this.portfolioSnapshots.has(key)) throw new Error("duplicate portfolio snapshot");
      this.portfolioSnapshots.set(key, portfolio);
    }

    for (const risk of snapshot.riskEvents) {
      this.requireAgent(risk.agentId);
      if (risk.accountId) {
        const account = this.requireAccount(risk.accountId);
        if (account.participantId !== risk.agentId) throw new Error("snapshot risk account does not belong to agent");
      }
      assertRiskSeverity(risk.severity);
      assertNonEmptyString(risk.type, "snapshot risk type");
      assertNonEmptyString(risk.detail, "snapshot risk detail");
      assertNonEmptyString(risk.policyVersion, "snapshot risk policyVersion");
      assertNonNegativeTimestamp(risk.occurredAt, "snapshot risk occurredAt");
      if (this.riskEvents.has(risk.riskEventId)) throw new Error("duplicate risk event in snapshot");
      this.riskEvents.set(risk.riskEventId, risk);
    }

    for (const score of snapshot.scoreSnapshots) {
      this.requireAgent(score.agentId);
      this.requireSeason(score.seasonId);
      assertUnitInterval(score.brierScore, "snapshot brierScore");
      if (!Number.isInteger(score.predictionCount) || score.predictionCount < 0) throw new Error("snapshot predictionCount invalid");
      if (!Number.isInteger(score.resolvedPredictionCount) || score.resolvedPredictionCount < 0 || score.resolvedPredictionCount > score.predictionCount) throw new Error("snapshot resolvedPredictionCount invalid");
      if (!Number.isInteger(score.paperFillCount) || score.paperFillCount < 0) throw new Error("snapshot paperFillCount invalid");
      assertNonNegativeTimestamp(score.capturedAt, "snapshot score capturedAt");
      if (this.scoreSnapshots.has(score.scoreSnapshotId)) throw new Error("duplicate score snapshot");
      this.scoreSnapshots.set(score.scoreSnapshotId, score);
    }
  }

  private requireSeason(seasonId: string): SeasonRecord {
    const season = this.seasons.get(seasonId);
    if (!season) throw new Error("unknown season");
    return season;
  }

  private requireAgent(agentId: string): AgentRecord {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("unknown agent");
    return agent;
  }

  private requirePaperActiveAgent(agentId: string): AgentRecord {
    const agent = this.requireAgent(agentId);
    if (!["PAPER_ACTIVE", "QUALIFIED", "ELITE"].includes(agent.performanceState)) throw new Error("agent is not paper-active");
    if (agent.executionMode !== "PAPER_ONLY") throw new Error("foundation engine refuses non-paper execution modes");
    return agent;
  }

  private requireStrategyVersion(agentId: string, version: number): StrategyVersionRecord {
    if (!Number.isInteger(version) || version <= 0) throw new Error("strategyVersion must be a positive integer");
    const strategy = (this.strategies.get(agentId) ?? []).find((candidate) => candidate.version === version);
    if (!strategy) throw new Error("unknown strategy version");
    return strategy;
  }

  private requireAccount(accountId: string): PaperAccountRecord {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error("unknown paper account");
    return account;
  }
}
