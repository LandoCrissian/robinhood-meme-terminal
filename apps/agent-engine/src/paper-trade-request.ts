import {
  assertAgentRunRecord,
  assertAtomicAmount,
  assertBps,
  assertNonEmptyString,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
  type AgentRunRecord,
  type MarketObservationDraft,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperRiskSnapshot,
  type PaperRiskSnapshot,
} from "./paper-risk-capacity.ts";

export interface PaperTradeRequestPolicy {
  policyVersion: string;
  maximumRiskSnapshotAgeMs: number;
}

export interface PaperTradeRequestRecord {
  schemaVersion: 1;
  policyVersion: string;
  maximumRiskSnapshotAgeMs: number;
  run: AgentRunRecord;
  strategy: StrategyVersionRecord;
  riskSnapshot: PaperRiskSnapshot;
  marketObservation: MarketObservationDraft;
  inputAssetId: string;
  outputAssetId: string;
  requestedPositionBps: number;
  requestedInputAmountAtomic: string;
  requestedAt: number;
  requestHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function strategyHash(strategy: StrategyVersionRecord): string {
  return hashCanonicalPayload({ agentId: strategy.agentId, version: strategy.version, spec: strategy.spec });
}

function targetObservation(run: AgentRunRecord): MarketObservationDraft {
  if (run.proposal.action !== "OPEN_POSITION" || !run.proposal.openPosition) {
    fail("paper trade request requires an OPEN_POSITION run");
  }
  const assetId = run.proposal.openPosition.assetId.toLowerCase();
  const matches = run.marketSnapshot.observations.filter((observation) => observation.assetId.toLowerCase() === assetId);
  if (matches.length !== 1) fail("paper trade request target must match exactly one canonical market observation");
  return structuredClone(matches[0]!);
}

export function assertPaperTradeRequestRecord(record: PaperTradeRequestRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper trade request schema version");
  assertNonEmptyString(record.policyVersion, "paper trade request policyVersion");
  assertPositiveSafeInteger(record.maximumRiskSnapshotAgeMs, "maximumRiskSnapshotAgeMs");
  assertAgentRunRecord(record.run);
  assertPaperRiskSnapshot(record.riskSnapshot);
  assertHash(record.strategy.strategyHash, "paper trade request strategyHash");
  if (record.strategy.strategyHash !== strategyHash(record.strategy)) fail("paper trade request strategy hash mismatch");
  if (
    record.strategy.agentId !== record.run.agentId
    || record.strategy.version !== record.run.strategyVersion
    || record.strategy.strategyHash !== record.run.strategyHash
  ) {
    fail("paper trade request strategy does not match agent run");
  }
  if (record.run.proposal.action !== "OPEN_POSITION" || !record.run.proposal.openPosition) {
    fail("paper trade request run is not OPEN_POSITION");
  }
  const openPosition = record.run.proposal.openPosition;
  assertBps(openPosition.requestedPositionBps, "paper trade request proposal bps");
  if (openPosition.requestedPositionBps <= 0) fail("paper trade request proposal bps must be greater than zero");
  if (openPosition.requestedPositionBps > record.strategy.spec.risk.maximumPositionBps) {
    fail("paper trade request proposal exceeds strategy maximumPositionBps");
  }
  if (record.riskSnapshot.accountId !== record.run.accountId) fail("paper trade request risk account mismatch");
  if (record.riskSnapshot.positionAssetId !== openPosition.assetId) fail("paper trade request risk position asset mismatch");
  if (record.riskSnapshot.capturedAt < record.run.evaluatedAt) fail("paper trade request risk snapshot predates agent decision");
  assertTimestamp(record.requestedAt, "paper trade request requestedAt");
  if (record.requestedAt < record.riskSnapshot.capturedAt) fail("paper trade request predates risk snapshot");
  if (record.requestedAt - record.riskSnapshot.capturedAt > record.maximumRiskSnapshotAgeMs) fail("paper trade request risk snapshot is stale");
  const observation = targetObservation(record.run);
  if (hashCanonicalPayload(observation) !== hashCanonicalPayload(record.marketObservation)) {
    fail("paper trade request market observation differs from agent run");
  }
  if (record.inputAssetId !== record.riskSnapshot.quoteAssetId || record.outputAssetId !== openPosition.assetId) {
    fail("paper trade request asset IDs do not match risk/proposal evidence");
  }
  if (record.inputAssetId.toLowerCase() === record.outputAssetId.toLowerCase()) fail("paper trade request assets must differ");
  if (record.requestedPositionBps !== openPosition.requestedPositionBps) fail("paper trade request bps changed from model proposal");
  assertPositiveAtomicAmount(record.requestedInputAmountAtomic, "paper trade requestedInputAmountAtomic");
  const expectedAmount = BigInt(record.riskSnapshot.markNavAtomic) * BigInt(record.requestedPositionBps) / 10_000n;
  if (record.requestedInputAmountAtomic !== expectedAmount.toString()) fail("paper trade atomic amount does not match NAV bps request");
  assertHash(record.requestHash, "paper trade requestHash");
  const { requestHash, ...payload } = record;
  if (requestHash !== hashCanonicalPayload(payload)) fail("paper trade request hash mismatch");
}

export function buildPaperTradeRequest(input: {
  run: AgentRunRecord;
  strategy: StrategyVersionRecord;
  riskSnapshot: PaperRiskSnapshot;
  policy: PaperTradeRequestPolicy;
  requestedAt?: number;
}): PaperTradeRequestRecord {
  assertAgentRunRecord(input.run);
  assertPaperRiskSnapshot(input.riskSnapshot);
  assertNonEmptyString(input.policy.policyVersion, "paper trade request policyVersion");
  assertPositiveSafeInteger(input.policy.maximumRiskSnapshotAgeMs, "maximumRiskSnapshotAgeMs");
  assertHash(input.strategy.strategyHash, "paper trade request strategyHash");
  if (input.strategy.strategyHash !== strategyHash(input.strategy)) fail("paper trade request strategy hash mismatch");
  if (
    input.strategy.agentId !== input.run.agentId
    || input.strategy.version !== input.run.strategyVersion
    || input.strategy.strategyHash !== input.run.strategyHash
  ) {
    fail("paper trade request strategy does not match agent run");
  }
  if (input.run.proposal.action !== "OPEN_POSITION" || !input.run.proposal.openPosition) {
    fail("paper trade request requires an OPEN_POSITION run");
  }
  const openPosition = input.run.proposal.openPosition;
  assertBps(openPosition.requestedPositionBps, "paper trade request proposal bps");
  if (openPosition.requestedPositionBps <= 0) fail("paper trade request proposal bps must be greater than zero");
  if (openPosition.requestedPositionBps > input.strategy.spec.risk.maximumPositionBps) {
    fail("paper trade request proposal exceeds strategy maximumPositionBps");
  }
  if (input.riskSnapshot.accountId !== input.run.accountId) fail("paper trade request risk account mismatch");
  if (input.riskSnapshot.positionAssetId !== openPosition.assetId) fail("paper trade request risk position asset mismatch");
  if (input.riskSnapshot.capturedAt < input.run.evaluatedAt) fail("paper trade request risk snapshot predates agent decision");
  const requestedAt = input.requestedAt ?? Date.now();
  assertTimestamp(requestedAt, "paper trade request requestedAt");
  if (requestedAt < input.riskSnapshot.capturedAt) fail("paper trade request predates risk snapshot");
  if (requestedAt - input.riskSnapshot.capturedAt > input.policy.maximumRiskSnapshotAgeMs) fail("paper trade request risk snapshot is stale");
  const observation = targetObservation(input.run);
  const requestedInputAmount = BigInt(input.riskSnapshot.markNavAtomic) * BigInt(openPosition.requestedPositionBps) / 10_000n;
  if (requestedInputAmount <= 0n) fail("paper trade request rounds to zero atomic input");
  assertAtomicAmount(requestedInputAmount.toString(), "paper trade requestedInputAmountAtomic");
  const payload: Omit<PaperTradeRequestRecord, "requestHash"> = {
    schemaVersion: 1,
    policyVersion: input.policy.policyVersion,
    maximumRiskSnapshotAgeMs: input.policy.maximumRiskSnapshotAgeMs,
    run: structuredClone(input.run),
    strategy: structuredClone(input.strategy),
    riskSnapshot: structuredClone(input.riskSnapshot),
    marketObservation: observation,
    inputAssetId: input.riskSnapshot.quoteAssetId,
    outputAssetId: openPosition.assetId,
    requestedPositionBps: openPosition.requestedPositionBps,
    requestedInputAmountAtomic: requestedInputAmount.toString(),
    requestedAt,
  };
  const record: PaperTradeRequestRecord = { ...payload, requestHash: hashCanonicalPayload(payload) };
  assertPaperTradeRequestRecord(record);
  return record;
}
