import { randomUUID } from "node:crypto";
import {
  assertAtomicAmount,
  assertBps,
  assertNonEmptyString,
  assertPerformanceTransition,
  assertPositiveAtomicAmount,
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
  type PredictionRecord,
  type StrategySpec,
  type StrategyVersionRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";

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

function assertNonNegativeTimestamp(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
}

function assertEvmAddress(address: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("ownerAddress must be a 20-byte EVM address");
}

export class AgentEngine {
  private readonly config: AgentEngineConfig;
  private readonly agents = new Map<string, AgentRecord>();
  private readonly strategies = new Map<string, StrategyVersionRecord[]>();
  private readonly accounts = new Map<string, PaperAccountRecord>();
  private readonly decisions = new Map<string, AgentDecision>();
  private readonly predictions = new Map<string, PredictionRecord>();
  private readonly orders = new Map<string, PaperOrderRecord>();
  private readonly fills = new Map<string, PaperFillRecord>();

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
    assertNonEmptyString(input.seasonId, "seasonId");
    const balances: Record<string, string> = {};
    for (const [assetId, amount] of Object.entries(input.initialBalances)) {
      assertNonEmptyString(assetId, "assetId");
      assertAtomicAmount(amount, `balance ${assetId}`);
      balances[assetId] = amount;
    }
    if (Object.keys(balances).length === 0) throw new Error("paper account requires at least one starting balance");
    const openedAt = input.openedAt ?? Date.now();
    assertNonNegativeTimestamp(openedAt, "openedAt");
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
    };
    this.fills.set(fill.fillId, fill);
    return clone(fill);
  }

  getPaperAccount(accountId: string): PaperAccountRecord {
    return clone(this.requireAccount(accountId));
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
