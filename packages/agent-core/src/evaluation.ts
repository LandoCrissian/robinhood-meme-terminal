import { hashCanonicalPayload } from "./canonical.ts";
import {
  assertAtomicAmount,
  assertNonEmptyString,
  assertPositiveInteger,
  assertUnitInterval,
  type PaperAccountRecord,
  type StrategySpec,
} from "./schema.ts";

export type PaperEvaluationAction = "NO_ACTION" | "PREDICTION";

export interface MarketObservationDraft {
  assetId: string;
  quoteAssetId: string;
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

export interface AgentEvaluationProposal {
  action: PaperEvaluationAction;
  confidence: number;
  reasoningSummary: string;
  prediction?: PredictionProposal;
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

function observationIdentityKeys(observation: MarketObservationDraft): Set<string> {
  const keys = new Set<string>([observation.assetId.toLowerCase()]);
  for (const field of ["contractAddress", "registryAssetId", "registrySymbol"] as const) {
    const value = observation.features?.[field];
    if (typeof value === "string" && value.trim()) keys.add(value.trim().toLowerCase());
  }
  return keys;
}

function predictionObservation(assetId: string, snapshot: AgentMarketSnapshot): MarketObservationDraft {
  const key = assetId.trim().toLowerCase();
  const matches = snapshot.observations.filter((observation) => observationIdentityKeys(observation).has(key));
  if (matches.length === 0) fail("prediction asset is absent from market snapshot");
  if (matches.length > 1) fail("prediction asset alias is ambiguous in market snapshot");
  return matches[0]!;
}

export function parseMarketObservationDraft(value: unknown, maximumFeatures: number): MarketObservationDraft {
  if (!Number.isInteger(maximumFeatures) || maximumFeatures < 0) fail("maximumFeatures must be a non-negative integer");
  if (!isRecord(value)) fail("market observation must be an object");
  assertNonEmptyString(value.assetId as string, "market assetId");
  assertNonEmptyString(value.quoteAssetId as string, "market quoteAssetId");
  const assetId = (value.assetId as string).trim();
  const quoteAssetId = (value.quoteAssetId as string).trim();
  if (assetId.toLowerCase() === quoteAssetId.toLowerCase()) fail("market assetId and quoteAssetId must differ");
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
  if (value.action !== "NO_ACTION" && value.action !== "PREDICTION") fail("evaluation action is not admitted in paper runner v1");
  assertUnitInterval(value.confidence as number, "evaluation confidence");
  const reasoningSummary = assertReasoningSummary(value.reasoningSummary);
  if ((value.confidence as number) < strategy.prediction.minimumConfidence && value.action !== "NO_ACTION") {
    fail("evaluation confidence is below strategy minimum");
  }
  if (value.action === "NO_ACTION") {
    if (value.prediction !== undefined) fail("NO_ACTION proposal cannot include prediction");
    return {
      action: "NO_ACTION",
      confidence: value.confidence as number,
      reasoningSummary,
    };
  }
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

export function canonicalizePredictionAsset(
  proposal: AgentEvaluationProposal,
  strategy: StrategySpec,
  snapshot: AgentMarketSnapshot,
): AgentEvaluationProposal {
  if (!proposal.prediction) return structuredClone(proposal);
  const observation = predictionObservation(proposal.prediction.assetId, snapshot);
  const identityKeys = observationIdentityKeys(observation);
  const include = strategy.universe.includeAssets?.map((asset) => asset.toLowerCase());
  if (include?.length && !include.some((asset) => identityKeys.has(asset))) fail("prediction asset is outside strategy includeAssets");
  const exclude = strategy.universe.excludeAssets?.map((asset) => asset.toLowerCase()) ?? [];
  if (exclude.some((asset) => identityKeys.has(asset))) fail("prediction asset is excluded by strategy");
  return {
    ...structuredClone(proposal),
    prediction: {
      ...structuredClone(proposal.prediction),
      assetId: observation.assetId,
    },
  };
}

export function assertPredictionAssetAllowed(proposal: AgentEvaluationProposal, strategy: StrategySpec, snapshot: AgentMarketSnapshot): void {
  const canonical = canonicalizePredictionAsset(proposal, strategy, snapshot);
  if (proposal.prediction && canonical.prediction?.assetId !== proposal.prediction.assetId) {
    fail("prediction asset must be canonicalized before persistence");
  }
}

export function hashAgentRunPayload(record: Omit<AgentRunRecord, "runHash">): string {
  return hashCanonicalPayload(record);
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
  if (record.proposal.action !== "NO_ACTION" && record.proposal.action !== "PREDICTION") fail("agent run proposal action is invalid");
  assertUnitInterval(record.proposal.confidence, "run proposal confidence");
  assertReasoningSummary(record.proposal.reasoningSummary);
  if (record.proposal.action === "NO_ACTION") {
    if (record.proposal.prediction !== undefined) fail("NO_ACTION run cannot include prediction");
  } else {
    if (!record.proposal.prediction) fail("PREDICTION run is missing prediction");
    assertNonEmptyString(record.proposal.prediction.assetId, "run prediction assetId");
    assertNonEmptyString(record.proposal.prediction.condition, "run prediction condition");
    if (record.proposal.prediction.condition.length > 512) fail("run prediction condition exceeds 512 characters");
    assertUnitInterval(record.proposal.prediction.forecastProbability, "run forecastProbability");
    assertTimestamp(record.proposal.prediction.resolvesAt, "run prediction resolvesAt");
    if (record.proposal.prediction.resolvesAt <= record.evaluatedAt) fail("run prediction must resolve after evaluatedAt");
    const exactMatches = record.marketSnapshot.observations.filter((observation) => observation.assetId.toLowerCase() === record.proposal.prediction!.assetId.toLowerCase());
    if (exactMatches.length !== 1) fail("run prediction asset must exactly match one canonical market observation assetId");
  }
  if (record.proposalHash !== hashCanonicalPayload(record.proposal)) fail("agent run proposal hash mismatch");
  const { runHash, ...payload } = record;
  if (runHash !== hashAgentRunPayload(payload)) fail("agent run hash mismatch");
}