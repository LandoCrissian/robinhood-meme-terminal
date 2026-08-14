import type {
  AgentDecision,
  AgentRecord,
  HumanPaperFillRecord,
  HumanPaperOrderIntent,
  HumanPaperOrderRecord,
  PaperAccountRecord,
  PaperExecutionCosts,
  PaperFillRecord,
  PaperOrderIntent,
  PaperOrderRecord,
  PortfolioSnapshot,
  PredictionRecord,
  RiskEventRecord,
  ScoreSnapshotRecord,
  SeasonRecord,
  StrategySpec,
  StrategyVersionRecord,
  VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import { AgentEngine, type AgentEngineConfig, type AgentSummary } from "./engine.ts";
import type { AgentStateStore } from "./persistence/store.ts";
import { hashDurableRequest } from "./persistence/store.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DurableAgentEngine {
  private readonly config: AgentEngineConfig;
  private readonly store: AgentStateStore;
  private readonly streamId: string;
  private engine: AgentEngine;
  private revision: number;

  private constructor(input: {
    config: AgentEngineConfig;
    store: AgentStateStore;
    streamId: string;
    engine: AgentEngine;
    revision: number;
  }) {
    this.config = clone(input.config);
    this.store = input.store;
    this.streamId = input.streamId;
    this.engine = input.engine;
    this.revision = input.revision;
  }

  static async initialize(input: {
    config: AgentEngineConfig;
    store: AgentStateStore;
    streamId?: string;
  }): Promise<DurableAgentEngine> {
    const streamId = input.streamId ?? "paper-default";
    if (typeof streamId !== "string" || streamId.trim().length === 0) throw new Error("streamId must be non-empty");
    const stored = await input.store.load(streamId);
    const engine = stored ? AgentEngine.fromSnapshot(input.config, stored.snapshot) : new AgentEngine(input.config);
    return new DurableAgentEngine({
      config: input.config,
      store: input.store,
      streamId,
      engine,
      revision: stored?.revision ?? 0,
    });
  }

  getRevision(): number {
    return this.revision;
  }

  getAgentSummary(agentId: string): AgentSummary {
    return this.engine.getAgentSummary(agentId);
  }

  getPaperAccount(accountId: string): PaperAccountRecord {
    return this.engine.getPaperAccount(accountId);
  }

  getSeason(seasonId: string): SeasonRecord {
    return this.engine.getSeason(seasonId);
  }

  async createSeason(
    input: { seasonId: string; name: string; startsAt: number; endsAt?: number; createdAt?: number },
    idempotencyKey: string,
  ): Promise<SeasonRecord> {
    return this.mutate("createSeason", input, idempotencyKey, (engine) => engine.createSeason(input));
  }

  async registerAgent(
    input: { ownerAddress: string; name: string; thesis: string; createdAt?: number },
    idempotencyKey: string,
  ): Promise<AgentRecord> {
    return this.mutate("registerAgent", input, idempotencyKey, (engine) => engine.registerAgent(input));
  }

  async createStrategyVersion(
    agentId: string,
    spec: StrategySpec,
    idempotencyKey: string,
    createdAt?: number,
  ): Promise<StrategyVersionRecord> {
    const payload = { agentId, spec, createdAt };
    return this.mutate("createStrategyVersion", payload, idempotencyKey, (engine) => engine.createStrategyVersion(agentId, spec, createdAt));
  }

  async activatePaperAgent(agentId: string, idempotencyKey: string): Promise<AgentRecord> {
    return this.mutate("activatePaperAgent", { agentId }, idempotencyKey, (engine) => engine.activatePaperAgent(agentId));
  }

  async openPaperAccount(
    input: { agentId: string; seasonId: string; initialBalances: Record<string, string>; openedAt?: number },
    idempotencyKey: string,
  ): Promise<PaperAccountRecord> {
    return this.mutate("openPaperAccount", input, idempotencyKey, (engine) => engine.openPaperAccount(input));
  }

  async openHumanPaperAccount(
    input: { walletAddress: string; seasonId: string; initialBalances: Record<string, string>; openedAt?: number },
    idempotencyKey: string,
  ): Promise<PaperAccountRecord> {
    return this.mutate("openHumanPaperAccount", input, idempotencyKey, (engine) => engine.openHumanPaperAccount(input));
  }

  async recordDecision(
    input: Omit<AgentDecision, "decisionId" | "decisionHash" | "policyVersion">,
    idempotencyKey: string,
  ): Promise<AgentDecision> {
    return this.mutate("recordDecision", input, idempotencyKey, (engine) => engine.recordDecision(input));
  }

  async submitPrediction(
    input: Omit<PredictionRecord, "predictionId" | "resolvedOutcome" | "resolvedAt">,
    idempotencyKey: string,
  ): Promise<PredictionRecord> {
    return this.mutate("submitPrediction", input, idempotencyKey, (engine) => engine.submitPrediction(input));
  }

  async resolvePrediction(predictionId: string, outcome: 0 | 1, resolvedAt: number, idempotencyKey: string): Promise<PredictionRecord> {
    const payload = { predictionId, outcome, resolvedAt };
    return this.mutate("resolvePrediction", payload, idempotencyKey, (engine) => engine.resolvePrediction(predictionId, outcome, resolvedAt));
  }

  async submitPaperOrder(intent: PaperOrderIntent, idempotencyKey: string): Promise<PaperOrderRecord> {
    return this.mutate("submitPaperOrder", intent, idempotencyKey, (engine) => engine.submitPaperOrder(intent));
  }

  async submitHumanPaperOrder(
    intent: HumanPaperOrderIntent,
    idempotencyKey: string,
    expectedRevision: number,
    authorizationHash: string,
  ): Promise<HumanPaperOrderRecord> {
    if (!/^0x[0-9a-f]{64}$/.test(authorizationHash)) throw new Error("human paper authorizationHash must be a sha256 hex hash");
    return this.mutate(
      "submitHumanPaperOrder",
      { intent, expectedRevision, authorizationHash },
      idempotencyKey,
      (engine) => engine.submitHumanPaperOrder(intent),
      expectedRevision,
    );
  }

  async fillPaperOrder(
    orderId: string,
    quote: VerifiedPaperQuoteEvidence,
    idempotencyKey: string,
    costs: PaperExecutionCosts = { feeAmountAtomic: "0", gasCostAtomic: "0" },
  ): Promise<PaperFillRecord> {
    const payload = { orderId, quote, costs };
    return this.mutate("fillPaperOrder", payload, idempotencyKey, (engine) => engine.fillPaperOrder(orderId, quote, costs));
  }

  async fillHumanPaperOrder(
    orderId: string,
    quote: VerifiedPaperQuoteEvidence,
    idempotencyKey: string,
    costs: PaperExecutionCosts = { feeAmountAtomic: "0", gasCostAtomic: "0" },
  ): Promise<HumanPaperFillRecord> {
    const payload = { orderId, quote, costs };
    return this.mutate("fillHumanPaperOrder", payload, idempotencyKey, (engine) => engine.fillHumanPaperOrder(orderId, quote, costs));
  }

  async recordPortfolioSnapshot(input: PortfolioSnapshot, idempotencyKey: string): Promise<PortfolioSnapshot> {
    return this.mutate("recordPortfolioSnapshot", input, idempotencyKey, (engine) => engine.recordPortfolioSnapshot(input));
  }

  async recordRiskEvent(
    input: Omit<RiskEventRecord, "riskEventId" | "policyVersion">,
    idempotencyKey: string,
  ): Promise<RiskEventRecord> {
    return this.mutate("recordRiskEvent", input, idempotencyKey, (engine) => engine.recordRiskEvent(input));
  }

  async captureScoreSnapshot(
    input: { agentId: string; seasonId: string; capturedAt: number },
    idempotencyKey: string,
  ): Promise<ScoreSnapshotRecord> {
    return this.mutate("captureScoreSnapshot", input, idempotencyKey, (engine) => engine.captureScoreSnapshot(input));
  }

  private async mutate<T>(
    operation: string,
    payload: unknown,
    idempotencyKey: string,
    apply: (engine: AgentEngine) => T,
    requiredRevision?: number,
  ): Promise<T> {
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) throw new Error("idempotencyKey must be non-empty");
    if (requiredRevision !== undefined && (!Number.isSafeInteger(requiredRevision) || requiredRevision < 0)) throw new Error("requiredRevision must be a non-negative safe integer");
    const requestHash = hashDurableRequest(operation, payload);
    const prior = await this.store.lookupMutation(this.streamId, idempotencyKey, requestHash);
    if (prior) {
      if (prior.operation !== operation) throw new Error("idempotency key was already used for a different operation");
      this.engine = AgentEngine.fromSnapshot(this.config, prior.snapshot);
      this.revision = prior.revision;
      return clone(prior.result as T);
    }

    if (requiredRevision !== undefined && this.revision !== requiredRevision) {
      throw new Error(`agent engine required revision mismatch: required ${requiredRevision}, local ${this.revision}`);
    }
    const before = this.engine.exportSnapshot();
    const expectedRevision = this.revision;
    let result: T;
    try {
      result = apply(this.engine);
    } catch (error) {
      this.engine = AgentEngine.fromSnapshot(this.config, before);
      throw error;
    }

    try {
      const committed = await this.store.commit({
        streamId: this.streamId,
        expectedRevision,
        idempotencyKey,
        operation,
        requestHash,
        result,
        snapshot: this.engine.exportSnapshot(),
        createdAt: Date.now(),
      });
      this.engine = AgentEngine.fromSnapshot(this.config, committed.snapshot);
      this.revision = committed.revision;
      if (committed.status === "CONFLICT") {
        throw new Error(`agent engine revision conflict: expected ${expectedRevision}, canonical ${committed.revision}`);
      }
      return clone(committed.result as T);
    } catch (error) {
      const current = await this.store.load(this.streamId);
      if (current) {
        this.engine = AgentEngine.fromSnapshot(this.config, current.snapshot);
        this.revision = current.revision;
      } else {
        this.engine = AgentEngine.fromSnapshot(this.config, before);
        this.revision = expectedRevision;
      }
      throw error;
    }
  }
}
