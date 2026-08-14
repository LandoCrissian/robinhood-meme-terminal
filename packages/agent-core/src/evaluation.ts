import { hashCanonicalPayload } from "./canonical.ts";
import {
  assertAtomicAmount,
  assertBps,
  assertNonEmptyString,
  assertPositiveInteger,
  assertUnitInterval,
  type PaperAccountRecord,
  type StrategySpec,
} from "./schema.ts";

export type PaperEvaluationAction = "NO_ACTION" | "PREDICTION" | "OPEN_POSITION" | "CLOSE_POSITION";

export interface MarketObservationDraft {
  assetId: string;
  quoteAssetId: string;
  aliases?: string[];
  referencePriceAtomic: string;
  referencePriceDecimals: number;
  liquidityUsdAtomic?: string;
  liquidityUsdDecimals?: number;
  features?: Record<string, string | number | boolean>;
}

export interface AgentMarketSnapshot {
  snapshotId: string;
  chainId: number;
  sourceId: string;
  capturedAt: number;
  observations: MarketObservationDraft[];
  snapshotHash: string;
}

export interface PredictionProposal {
  assetId: string;
  condition: string;
  forecastProbability: number;
  resolvesAt: number;
}

export interface OpenPositionProposal {
  assetId: string;
  requestedPositionBps: number;
}

export interface ClosePositionProposal {
  assetId: string;
  requestedReductionBps: number;
}

export interface AgentEvaluationProposal {
  action: PaperEvaluationAction;
  confidence: number;
  reasoningSummary: string;
  prediction?: PredictionProposal;
  openPosition?: OpenPositionProposal;
  closePosition?: ClosePositionProposal;
}

export interface AgentRunRecord {
  runId: string;
  evaluationKey: string;
  requestHash: string;
  agentId: string;
  accountId: string;
  accountSnapshot: PaperAccountRecord;
  strategyVersion: number;
  strategyHash: string;
  runnerVersion: string;
  marketSourceId: string;
  decisionAdapterId: string;
  modelIdentity: string;
  marketSnapshot: AgentMarketSnapshot;
  proposal: AgentEvaluationProposal;
  proposalHash: string;
  evaluatedAt: number;
  runHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertDecimals(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 30) fail(`${field} must be an integer from 0 to 30`);
}

function assertReasoningSummary(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("evaluation reasoningSummary must be non-empty");
  const normalized = value.trim();
  if (normalized.length > 1_024) fail("evaluation reasoningSummary exceeds 1024 characters");
  return normalized;
}

function parseAliases(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail("market aliases must be an array");
  if (value.length > 32) fail("market alias count exceeds 32");
  const aliases = new Map<string, string>();
  for (const alias of value) {
    if (typeof alias !== "string" || !alias.trim()) fail("market alias must be a non-empty string");
    const normalized = alias.trim();
    if (normalized.length > 256) fail("market alias exceeds 256 characters");
    const key = normalized.toLowerCase();
    if (!aliases.has(key)) aliases.set(key, normalized);
  }
  return aliases.size > 0 ? [...aliases.values()] : undefined;
}

function observationIdentityKeys(observation: MarketObservationDraft): Set<string> {
  return new Set([observation.assetId, ...(observation.aliases ?? [])].map((value) => value.toLowerCase()));
}

function proposalObservation(assetId: string, snapshot: AgentMarketSnapshot, label: string): MarketObservationDraft {
  const key = assetId.trim().toLowerCase();
  const matches = snapshot.observations.filter((observation) => observationIdentityKeys(observation).has(key));
  if (matches.length === 0) fail(`${label} asset is absent from market snapshot`);
  if (matches.length > 1) fail(`${label} asset alias is ambiguous in market snapshot`);
  return matches[0]!;
}

function assertStrategyAllowsObservation(strategy: StrategySpec, observation: MarketObservationDraft, label: string): void {
  const identityKeys = observationIdentityKeys(observation);
  const include = strategy.universe.includeAssets?.map((asset) => asset.toLowerCase());
  if (include?.length && !include.some((asset) => identityKeys.has(asset))) fail(`${label} asset is outside strategy includeAssets`);
  const exclude = strategy.universe.excludeAssets?.map((asset) => asset.toLowerCase()) ?? [];
  if (exclude.some((asset) => identityKeys.has(asset))) fail(`${label} asset is excluded by strategy`);
}

export function parseMarketObservationDraft(value: unknown, maximumFeatures: number): MarketObservationDraft {
  if (!Number.isInteger(maximumFeatures) || maximumFeatures < 0) fail("maximumFeatures must be a non-negative integer");
  if (!isRecord(value)) fail("market observation must be an object");
  assertNonEmptyString(value.assetId as string, "market assetId");
  assertNonEmptyString(value.quoteAssetId as string, "market quoteAssetId");
  const assetId = (value.assetId as string).trim();
  const quoteAssetId = (value.quoteAssetId as string).trim();
  if (assetId.toLowerCase() === quoteAssetId.toLowerCase()) fail("market assetId and quoteAssetId must differ");
  const aliases = parseAliases(value.aliases);
  if (aliases?.some((alias) => alias.toLowerCase() === quoteAssetId.toLowerCase())) fail("market alias cannot equal quoteAssetId");
  assertAtomicAmount(value.referencePriceAtomic as string, "referencePriceAtomic");
  if (BigInt(value.referencePriceAtomic as string) <= 0n) fail("referencePriceAtomic must be greater than zero");
  assertDecimals(value.referencePriceDecimals as number, "referencePriceDecimals");
  if (value.liquidityUsdAtomic !== undefined) {
    assertAtomicAmount(value.liquidityUsdAtomic as string, "liquidityUsdAtomic");
    assertDecimals(value.liquidityUsdDecimals as number, "liquidityUsdDecimals");
  } else if (value.liquidityUsdDecimals !== undefined) {
    fail("liquidityUsdDecimals requires liquidityUsdAtomic");
  }
  let features: Record<string, string | number | boolean> | undefined;
  if (value.features !== undefined) {
    if (!isRecord(value.features)) fail("market observation features must be an object");
    const entries = Object.entries(value.features);
    if (entries.length > maximumFeatures) fail("market observation feature count exceeds policy maximum");
    features = {};
    for (const [key, feature] of entries) {
      assertNonEmptyString(key, "market feature key");
      if (key.length > 128) fail("market feature key exceeds 128 characters");
      const type = typeof feature;
      if (type !== "string" && type !== "number" && type !== "boolean") fail(`market feature ${key} has unsupported type`);
      if (type === "number" && !Number.isFinite(feature as number)) fail(`market feature ${key} must be finite`);
      if (type === "string" && (feature as string).length > 512) fail(`market feature ${key} exceeds 512 characters`);
      features[key] = feature as string | number | boolean;
    }
  }
  return {
    assetId,
    quoteAssetId,
    aliases,
    referencePriceAtomic: value.referencePriceAtomic as string,
    referencePriceDecimals: value.referencePriceDecimals as number,
    liquidityUsdAtomic: value.liquidityUsdAtomic as string | undefined,
    liquidityUsdDecimals: value.liquidityUsdDecimals as number | undefined,
    features,
  };
}

export function buildMarketSnapshot(input: {
  chainId: number;
  sourceId: string;
  capturedAt: number;
  observations: MarketObservationDraft[];
}): AgentMarketSnapshot {
  assertPositiveInteger(input.chainId, "market chainId");
  assertNonEmptyString(input.sourceId, "market sourceId");
  assertTimestamp(input.capturedAt, "market capturedAt");
  if (input.observations.length === 0) fail("market snapshot requires at least one observation");
  const observations = input.observations
    .map((observation) => parseMarketObservationDraft(observation, Object.keys(observation.features ?? {}).length))
    .sort((a, b) => `${a.assetId}:${a.quoteAssetId}`.localeCompare(`${b.assetId}:${b.quoteAssetId}`));
  const identities = new Set<string>();
  for (const observation of observations) {
    const identity = `${observation.assetId.toLowerCase()}:${observation.quoteAssetId.toLowerCase()}`;
    if (identities.has(identity)) fail(`duplicate market observation: ${identity}`);
    identities.add(identity);
  }
  const payload = { chainId: input.chainId, sourceId: input.sourceId.trim(), capturedAt: input.capturedAt, observations };
  const snapshotHash = hashCanonicalPayload(payload);
  return { snapshotId: snapshotHash, ...payload, snapshotHash };
}

export function assertAgentMarketSnapshot(snapshot: AgentMarketSnapshot): void {
  assertHash(snapshot.snapshotId, "snapshotId");
  assertHash(snapshot.snapshotHash, "snapshotHash");
  const rebuilt = buildMarketSnapshot({
    chainId: snapshot.chainId,
    sourceId: snapshot.sourceId,
    capturedAt: snapshot.capturedAt,
    observations: snapshot.observations,
  });
  if (snapshot.snapshotId !== rebuilt.snapshotId || snapshot.snapshotHash !== rebuilt.snapshotHash) fail("market snapshot hash mismatch");
}

export function parseEvaluationProposal(value: unknown, strategy: StrategySpec, evaluatedAt: number): AgentEvaluationProposal {
  assertTimestamp(evaluatedAt, "evaluatedAt");
  if (!isRecord(value)) fail("evaluation proposal must be an object");
  if (
    value.action !== "NO_ACTION"
    && value.action !== "PREDICTION"
    && value.action !== "OPEN_POSITION"
    && value.action !== "CLOSE_POSITION"
  ) {
    fail("evaluation action is not admitted in paper runner v2");
  }
  assertUnitInterval(value.confidence as number, "evaluation confidence");
  const reasoningSummary = assertReasoningSummary(value.reasoningSummary);
  if ((value.confidence as number) < strategy.prediction.minimumConfidence && value.action !== "NO_ACTION") {
    fail("evaluation confidence is below strategy minimum");
  }
  if (value.action === "NO_ACTION") {
    if (value.prediction !== undefined || value.openPosition !== undefined || value.closePosition !== undefined) {
      fail("NO_ACTION proposal cannot include action payloads");
    }
    return { action: "NO_ACTION", confidence: value.confidence as number, reasoningSummary };
  }
  if (value.action === "PREDICTION") {
    if (value.openPosition !== undefined || value.closePosition !== undefined) fail("PREDICTION proposal cannot include trade payloads");
    if (!strategy.prediction.enabled) fail("strategy predictions are disabled");
    if (!isRecord(value.prediction)) fail("PREDICTION proposal requires prediction object");
    assertNonEmptyString(value.prediction.assetId as string, "prediction assetId");
    assertNonEmptyString(value.prediction.condition as string, "prediction condition");
    if ((value.prediction.condition as string).trim().length > 512) fail("prediction condition exceeds 512 characters");
    assertUnitInterval(value.prediction.forecastProbability as number, "forecastProbability");
    const resolvesAt = evaluatedAt + strategy.timeframe.predictionHorizonSeconds * 1_000;
    if (!Number.isSafeInteger(resolvesAt)) fail("prediction resolution timestamp exceeds safe integer range");
    return {
      action: "PREDICTION",
      confidence: value.confidence as number,
      reasoningSummary,
      prediction: {
        assetId: (value.prediction.assetId as string).trim(),
        condition: (value.prediction.condition as string).trim(),
        forecastProbability: value.prediction.forecastProbability as number,
        resolvesAt,
      },
    };
  }
  if (value.action === "OPEN_POSITION") {
    if (value.prediction !== undefined || value.closePosition !== undefined) fail("OPEN_POSITION proposal cannot include other action payloads");
    if (!isRecord(value.openPosition)) fail("OPEN_POSITION proposal requires openPosition object");
    assertNonEmptyString(value.openPosition.assetId as string, "openPosition assetId");
    assertBps(value.openPosition.requestedPositionBps as number, "requestedPositionBps");
    if ((value.openPosition.requestedPositionBps as number) <= 0) fail("requestedPositionBps must be greater than zero");
    if ((value.openPosition.requestedPositionBps as number) > strategy.risk.maximumPositionBps) {
      fail("requestedPositionBps exceeds strategy maximumPositionBps");
    }
    return {
      action: "OPEN_POSITION",
      confidence: value.confidence as number,
      reasoningSummary,
      openPosition: {
        assetId: (value.openPosition.assetId as string).trim(),
        requestedPositionBps: value.openPosition.requestedPositionBps as number,
      },
    };
  }
  if (value.prediction !== undefined || value.openPosition !== undefined) fail("CLOSE_POSITION proposal cannot include other action payloads");
  if (!isRecord(value.closePosition)) fail("CLOSE_POSITION proposal requires closePosition object");
  assertNonEmptyString(value.closePosition.assetId as string, "closePosition assetId");
  assertBps(value.closePosition.requestedReductionBps as number, "requestedReductionBps");
  if ((value.closePosition.requestedReductionBps as number) <= 0) fail("requestedReductionBps must be greater than zero");
  return {
    action: "CLOSE_POSITION",
    confidence: value.confidence as number,
    reasoningSummary,
    closePosition: {
      assetId: (value.closePosition.assetId as string).trim(),
      requestedReductionBps: value.closePosition.requestedReductionBps as number,
    },
  };
}

export function canonicalizeEvaluationProposalAssets(
  proposal: AgentEvaluationProposal,
  strategy: StrategySpec,
  snapshot: AgentMarketSnapshot,
): AgentEvaluationProposal {
  const canonical = structuredClone(proposal);
  if (canonical.prediction) {
    const observation = proposalObservation(canonical.prediction.assetId, snapshot, "prediction");
    assertStrategyAllowsObservation(strategy, observation, "prediction");
    canonical.prediction.assetId = observation.assetId;
  }
  if (canonical.openPosition) {
    const observation = proposalObservation(canonical.openPosition.assetId, snapshot, "openPosition");
    assertStrategyAllowsObservation(strategy, observation, "openPosition");
    canonical.openPosition.assetId = observation.assetId;
  }
  if (canonical.closePosition) {
    const observation = proposalObservation(canonical.closePosition.assetId, snapshot, "closePosition");
    assertStrategyAllowsObservation(strategy, observation, "closePosition");
    canonical.closePosition.assetId = observation.assetId;
  }
  return canonical;
}

export function canonicalizePredictionAsset(
  proposal: AgentEvaluationProposal,
  strategy: StrategySpec,
  snapshot: AgentMarketSnapshot,
): AgentEvaluationProposal {
  return canonicalizeEvaluationProposalAssets(proposal, strategy, snapshot);
}

export function assertPredictionAssetAllowed(proposal: AgentEvaluationProposal, strategy: StrategySpec, snapshot: AgentMarketSnapshot): void {
  const canonical = canonicalizeEvaluationProposalAssets(proposal, strategy, snapshot);
  if (proposal.prediction && canonical.prediction?.assetId !== proposal.prediction.assetId) {
    fail("prediction asset must be canonicalized before persistence");
  }
}

export function hashAgentRunPayload(record: Omit<AgentRunRecord, "runHash">): string {
  return hashCanonicalPayload(record);
}

function assertCanonicalProposalAsset(assetId: string, snapshot: AgentMarketSnapshot, label: string): void {
  assertNonEmptyString(assetId, `${label} assetId`);
  const key = assetId.toLowerCase();
  const exactMatches = snapshot.observations.filter((observation) => observation.assetId.toLowerCase() === key);
  if (exactMatches.length !== 1) fail(`${label} asset must exactly match one canonical market observation assetId`);
}

export function assertAgentRunRecord(record: AgentRunRecord): void {
  assertNonEmptyString(record.runId, "runId");
  assertNonEmptyString(record.evaluationKey, "evaluationKey");
  assertNonEmptyString(record.agentId, "run agentId");
  assertNonEmptyString(record.accountId, "run accountId");
  if (record.accountSnapshot.accountId !== record.accountId) fail("agent run account snapshot does not match accountId");
  if (record.accountSnapshot.participantType !== "AGENT" || record.accountSnapshot.participantId !== record.agentId) fail("agent run account snapshot does not belong to agent");
  assertNonEmptyString(record.accountSnapshot.seasonId, "run account seasonId");
  assertTimestamp(record.accountSnapshot.openedAt, "run account openedAt");
  for (const [assetId, amount] of Object.entries(record.accountSnapshot.balances)) {
    assertNonEmptyString(assetId, "run account balance assetId");
    assertAtomicAmount(amount, "run account balance");
  }
  assertPositiveInteger(record.strategyVersion, "run strategyVersion");
  assertHash(record.strategyHash, "run strategyHash");
  assertNonEmptyString(record.runnerVersion, "runnerVersion");
  assertNonEmptyString(record.marketSourceId, "marketSourceId");
  assertNonEmptyString(record.decisionAdapterId, "decisionAdapterId");
  assertNonEmptyString(record.modelIdentity, "run modelIdentity");
  assertHash(record.requestHash, "run requestHash");
  assertHash(record.proposalHash, "proposalHash");
  assertHash(record.runHash, "runHash");
  assertTimestamp(record.evaluatedAt, "run evaluatedAt");
  assertAgentMarketSnapshot(record.marketSnapshot);
  if (record.marketSourceId !== record.marketSnapshot.sourceId) fail("agent run market source does not match snapshot source");
  if (record.marketSnapshot.capturedAt > record.evaluatedAt) fail("agent run market snapshot is from the future");
  if (
    record.proposal.action !== "NO_ACTION"
    && record.proposal.action !== "PREDICTION"
    && record.proposal.action !== "OPEN_POSITION"
    && record.proposal.action !== "CLOSE_POSITION"
  ) fail("agent run proposal action is invalid");
  assertUnitInterval(record.proposal.confidence, "run proposal confidence");
  assertReasoningSummary(record.proposal.reasoningSummary);
  if (record.proposal.action === "NO_ACTION") {
    if (record.proposal.prediction !== undefined || record.proposal.openPosition !== undefined || record.proposal.closePosition !== undefined) {
      fail("NO_ACTION run cannot include action payloads");
    }
  } else if (record.proposal.action === "PREDICTION") {
    if (!record.proposal.prediction || record.proposal.openPosition !== undefined || record.proposal.closePosition !== undefined) {
      fail("PREDICTION run payload is invalid");
    }
    assertNonEmptyString(record.proposal.prediction.condition, "run prediction condition");
    if (record.proposal.prediction.condition.length > 512) fail("run prediction condition exceeds 512 characters");
    assertUnitInterval(record.proposal.prediction.forecastProbability, "run forecastProbability");
    assertTimestamp(record.proposal.prediction.resolvesAt, "run prediction resolvesAt");
    if (record.proposal.prediction.resolvesAt <= record.evaluatedAt) fail("run prediction must resolve after evaluatedAt");
    assertCanonicalProposalAsset(record.proposal.prediction.assetId, record.marketSnapshot, "run prediction");
  } else if (record.proposal.action === "OPEN_POSITION") {
    if (!record.proposal.openPosition || record.proposal.prediction !== undefined || record.proposal.closePosition !== undefined) {
      fail("OPEN_POSITION run payload is invalid");
    }
    assertBps(record.proposal.openPosition.requestedPositionBps, "run requestedPositionBps");
    if (record.proposal.openPosition.requestedPositionBps <= 0) fail("run requestedPositionBps must be greater than zero");
    assertCanonicalProposalAsset(record.proposal.openPosition.assetId, record.marketSnapshot, "run openPosition");
  } else {
    if (!record.proposal.closePosition || record.proposal.prediction !== undefined || record.proposal.openPosition !== undefined) {
      fail("CLOSE_POSITION run payload is invalid");
    }
    assertBps(record.proposal.closePosition.requestedReductionBps, "run requestedReductionBps");
    if (record.proposal.closePosition.requestedReductionBps <= 0) fail("run requestedReductionBps must be greater than zero");
    assertCanonicalProposalAsset(record.proposal.closePosition.assetId, record.marketSnapshot, "run closePosition");
  }
  if (record.proposalHash !== hashCanonicalPayload(record.proposal)) fail("agent run proposal hash mismatch");
  const { runHash, ...payload } = record;
  if (runHash !== hashAgentRunPayload(payload)) fail("agent run hash mismatch");
}
