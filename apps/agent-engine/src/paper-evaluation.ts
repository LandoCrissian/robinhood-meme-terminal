import { randomUUID } from "node:crypto";
import {
  assertAgentRunRecord,
  assertPredictionAssetAllowed,
  buildMarketSnapshot,
  canonicalizePredictionAsset,
  hashAgentRunPayload,
  hashCanonicalPayload,
  parseEvaluationProposal,
  parseMarketObservationDraft,
  type AgentDecision,
  type AgentMarketSnapshot,
  type AgentRecord,
  type AgentRunRecord,
  type PaperAccountRecord,
  type PredictionRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import type { AgentRunStore } from "./agent-run-store.ts";

export interface PaperEvaluationMarketSourceInput {
  agentId: string;
  accountId: string;
  strategy: StrategySpec;
  evaluatedAt: number;
}

export interface PaperEvaluationMarketSource {
  readonly sourceId: string;
  capture(input: PaperEvaluationMarketSourceInput): Promise<unknown>;
}

export interface PaperDecisionAdapterInput {
  agentId: string;
  account: PaperAccountRecord;
  strategy: StrategySpec;
  marketSnapshot: AgentMarketSnapshot;
  evaluatedAt: number;
  outputInstruction: "NO_ACTION_OR_PREDICTION_ONLY";
}

export interface PaperDecisionAdapter {
  readonly adapterId: string;
  readonly modelIdentity: string;
  evaluate(input: PaperDecisionAdapterInput): Promise<unknown>;
}

export interface PaperEvaluationWriter {
  getAgentSummary(agentId: string): { agent: AgentRecord; latestStrategy?: StrategyVersionRecord };
  getPaperAccount(accountId: string): PaperAccountRecord;
  recordDecision(
    input: Omit<AgentDecision, "decisionId" | "decisionHash" | "policyVersion">,
    idempotencyKey: string,
  ): Promise<AgentDecision>;
  submitPrediction(
    input: Omit<PredictionRecord, "predictionId" | "resolvedOutcome" | "resolvedAt">,
    idempotencyKey: string,
  ): Promise<PredictionRecord>;
}

export interface PaperEvaluationConfig {
  streamId: string;
  chainId: number;
  runnerVersion: string;
  maximumSnapshotAgeMs: number;
  maximumObservations: number;
  maximumFeaturesPerObservation: number;
}

export interface PaperEvaluationResult {
  run: AgentRunRecord;
  decision: AgentDecision;
  prediction?: PredictionRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be non-empty`);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
}

function buildRunRequestHash(input: {
  evaluationKey: string;
  agentId: string;
  accountId: string;
  strategy: StrategyVersionRecord;
  config: PaperEvaluationConfig;
  marketSourceId: string;
  decisionAdapterId: string;
  modelIdentity: string;
}): string {
  return hashCanonicalPayload({
    schemaVersion: 1,
    evaluationKey: input.evaluationKey,
    agentId: input.agentId,
    accountId: input.accountId,
    strategyVersion: input.strategy.version,
    strategyHash: input.strategy.strategyHash,
    chainId: input.config.chainId,
    runnerVersion: input.config.runnerVersion,
    maximumSnapshotAgeMs: input.config.maximumSnapshotAgeMs,
    maximumObservations: input.config.maximumObservations,
    maximumFeaturesPerObservation: input.config.maximumFeaturesPerObservation,
    marketSourceId: input.marketSourceId,
    decisionAdapterId: input.decisionAdapterId,
    modelIdentity: input.modelIdentity,
  });
}

export class PaperEvaluationService {
  private readonly config: PaperEvaluationConfig;
  private readonly marketSource: PaperEvaluationMarketSource;
  private readonly decisionAdapter: PaperDecisionAdapter;
  private readonly runStore: AgentRunStore;
  private readonly writer: PaperEvaluationWriter;

  constructor(input: {
    config: PaperEvaluationConfig;
    marketSource: PaperEvaluationMarketSource;
    decisionAdapter: PaperDecisionAdapter;
    runStore: AgentRunStore;
    writer: PaperEvaluationWriter;
  }) {
    this.config = structuredClone(input.config);
    this.marketSource = input.marketSource;
    this.decisionAdapter = input.decisionAdapter;
    this.runStore = input.runStore;
    this.writer = input.writer;
    assertNonEmpty(this.config.streamId, "streamId");
    assertPositiveInteger(this.config.chainId, "chainId");
    assertNonEmpty(this.config.runnerVersion, "runnerVersion");
    assertPositiveInteger(this.config.maximumSnapshotAgeMs, "maximumSnapshotAgeMs");
    assertPositiveInteger(this.config.maximumObservations, "maximumObservations");
    assertPositiveInteger(this.config.maximumFeaturesPerObservation, "maximumFeaturesPerObservation");
    assertNonEmpty(this.marketSource.sourceId, "market sourceId");
    assertNonEmpty(this.decisionAdapter.adapterId, "decision adapterId");
    assertNonEmpty(this.decisionAdapter.modelIdentity, "decision modelIdentity");
  }

  async evaluate(input: {
    agentId: string;
    accountId: string;
    evaluationKey: string;
    evaluatedAt?: number;
  }): Promise<PaperEvaluationResult> {
    assertNonEmpty(input.agentId, "agentId");
    assertNonEmpty(input.accountId, "accountId");
    assertNonEmpty(input.evaluationKey, "evaluationKey");
    const evaluatedAt = input.evaluatedAt ?? Date.now();
    assertTimestamp(evaluatedAt, "evaluatedAt");

    const summary = this.writer.getAgentSummary(input.agentId);
    const agent = summary.agent;
    const strategy = summary.latestStrategy;
    if (agent.executionMode !== "PAPER_ONLY") throw new Error("paper evaluation refuses non-paper execution mode");
    if (!["PAPER_ACTIVE", "QUALIFIED", "ELITE"].includes(agent.performanceState)) throw new Error("agent is not paper-active");
    if (!strategy) throw new Error("paper evaluation requires an admitted strategy version");
    const account = this.writer.getPaperAccount(input.accountId);
    if (account.participantType !== "AGENT" || account.participantId !== agent.id) throw new Error("paper account does not belong to agent");

    const requestHash = buildRunRequestHash({
      evaluationKey: input.evaluationKey,
      agentId: agent.id,
      accountId: account.accountId,
      strategy,
      config: this.config,
      marketSourceId: this.marketSource.sourceId,
      decisionAdapterId: this.decisionAdapter.adapterId,
      modelIdentity: this.decisionAdapter.modelIdentity,
    });

    let run = await this.runStore.getByEvaluationKey(this.config.streamId, input.evaluationKey);
    if (!run) {
      const rawSnapshot = await this.marketSource.capture({
        agentId: agent.id,
        accountId: account.accountId,
        strategy: structuredClone(strategy.spec),
        evaluatedAt,
      });
      if (!isRecord(rawSnapshot)) throw new Error("market source output must be an object");
      if (rawSnapshot.chainId !== this.config.chainId) throw new Error("market snapshot chainId mismatch");
      assertTimestamp(rawSnapshot.capturedAt as number, "market capturedAt");
      const capturedAt = rawSnapshot.capturedAt as number;
      if (capturedAt > evaluatedAt) throw new Error("market snapshot cannot be captured in the future");
      if (evaluatedAt - capturedAt > this.config.maximumSnapshotAgeMs) throw new Error("market snapshot is stale");
      if (!Array.isArray(rawSnapshot.observations) || rawSnapshot.observations.length === 0) throw new Error("market source requires observations");
      if (rawSnapshot.observations.length > this.config.maximumObservations) throw new Error("market observation count exceeds policy maximum");
      const marketSnapshot = buildMarketSnapshot({
        chainId: this.config.chainId,
        sourceId: this.marketSource.sourceId,
        capturedAt,
        observations: rawSnapshot.observations.map((observation) =>
          parseMarketObservationDraft(observation, this.config.maximumFeaturesPerObservation)),
      });

      const rawProposal = await this.decisionAdapter.evaluate({
        agentId: agent.id,
        account: structuredClone(account),
        strategy: structuredClone(strategy.spec),
        marketSnapshot: structuredClone(marketSnapshot),
        evaluatedAt,
        outputInstruction: "NO_ACTION_OR_PREDICTION_ONLY",
      });
      const parsedProposal = parseEvaluationProposal(rawProposal, strategy.spec, evaluatedAt);
      const proposal = canonicalizePredictionAsset(parsedProposal, strategy.spec, marketSnapshot);
      assertPredictionAssetAllowed(proposal, strategy.spec, marketSnapshot);
      const proposalHash = hashCanonicalPayload(proposal);
      const payload: Omit<AgentRunRecord, "runHash"> = {
        runId: randomUUID(),
        evaluationKey: input.evaluationKey,
        requestHash,
        agentId: agent.id,
        accountId: account.accountId,
        accountSnapshot: structuredClone(account),
        strategyVersion: strategy.version,
        strategyHash: strategy.strategyHash,
        runnerVersion: this.config.runnerVersion,
        marketSourceId: this.marketSource.sourceId,
        decisionAdapterId: this.decisionAdapter.adapterId,
        modelIdentity: this.decisionAdapter.modelIdentity,
        marketSnapshot,
        proposal,
        proposalHash,
        evaluatedAt,
      };
      const proposedRun: AgentRunRecord = { ...payload, runHash: hashAgentRunPayload(payload) };
      assertAgentRunRecord(proposedRun);
      run = await this.runStore.putIfAbsent(this.config.streamId, proposedRun);
    }

    assertAgentRunRecord(run);
    if (run.requestHash !== requestHash || run.agentId !== agent.id || run.accountId !== account.accountId) {
      throw new Error("stored agent run does not match evaluation request");
    }
    if (run.strategyVersion !== strategy.version || run.strategyHash !== strategy.strategyHash) {
      throw new Error("stored agent run strategy does not match current evaluation request");
    }

    const decision = await this.writer.recordDecision({
      agentId: run.agentId,
      strategyVersion: run.strategyVersion,
      marketSnapshotId: run.marketSnapshot.snapshotId,
      createdAt: run.evaluatedAt,
      action: run.proposal.action,
      confidence: run.proposal.confidence,
      reasoningSummary: run.proposal.reasoningSummary,
      modelIdentity: run.modelIdentity,
      compilerVersion: run.runnerVersion,
    }, `agent-run:${run.runHash}:decision`);

    let prediction: PredictionRecord | undefined;
    if (run.proposal.prediction) {
      prediction = await this.writer.submitPrediction({
        agentId: run.agentId,
        strategyVersion: run.strategyVersion,
        assetId: run.proposal.prediction.assetId,
        condition: run.proposal.prediction.condition,
        forecastProbability: run.proposal.prediction.forecastProbability,
        createdAt: run.evaluatedAt,
        resolvesAt: run.proposal.prediction.resolvesAt,
      }, `agent-run:${run.runHash}:prediction`);
    }

    return { run: structuredClone(run), decision, prediction };
  }
}