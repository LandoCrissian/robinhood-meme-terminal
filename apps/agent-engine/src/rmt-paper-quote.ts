import {
  assertAtomicAmount,
  assertBps,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";

const ROBINHOOD_CHAIN_ID = 4_663;
const MAX_CLOCK_SKEW_MS = 5_000;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RmtPaperQuoteProvider =
  | "sushi"
  | "uniswap-v3"
  | "uniswapx"
  | "zero-x-swap"
  | "zero-x-gasless"
  | "up-v2"
  | "up-cl";

export type RmtPaperQuoteAttemptStatus =
  | "indicative"
  | "no_route"
  | "temporarily_unavailable"
  | "invalid_response";

export interface RmtNormalizedPaperQuoteAttempt {
  provider: RmtPaperQuoteProvider;
  adapterVersion: 1;
  status: RmtPaperQuoteAttemptStatus;
  chainId: 4_663;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  expectedOutputAtomic: string | null;
  protectedOutputAtomic: string | null;
  outputDecimals: number | null;
  priceImpact: number | null;
  quotedAtMs: number | null;
  expiresAtMs: number | null;
  latencyMs: number;
  strictVerificationAvailable: boolean;
  authorizationReady: false;
  userPaysGas: boolean | null;
  networkFeeNativeAtomic: string | null;
  networkFeeNativeSymbol: "ETH" | null;
  costState: "network_fee_pending" | null;
}

export interface RmtNormalizedPaperQuoteResponse {
  requestId: string;
  chainId: 4_663;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  requestedAtMs: number;
  completedAtMs: number;
  attempts: RmtNormalizedPaperQuoteAttempt[];
}

export interface RmtPaperQuoteReaderInput {
  chainId: 4_663;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  observedAtMs: number;
}

export interface RmtPaperQuoteReader {
  readonly sourceId: string;
  compare(input: RmtPaperQuoteReaderInput): Promise<unknown>;
}

export interface RmtPaperQuotePolicy {
  maximumQuoteAgeMs: number;
  maximumPriceImpactBps: number;
}

export interface RmtPaperQuoteResult {
  readerSourceId: string;
  sourceRequestId: string;
  provider: RmtPaperQuoteProvider;
  outputDecimals: number;
  userPaysGas: boolean;
  costState: "NETWORK_FEE_PENDING" | "NO_SEPARATE_COST_LEDGER";
  comparison: RmtNormalizedPaperQuoteResponse;
  comparisonHash: string;
  selectedAttemptHash: string;
  evidence: VerifiedPaperQuoteEvidence;
  resultHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
  return value.trim();
}

function assertTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
  return value;
}

function assertHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
  return value;
}

function normalizeAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value) || /^0x0{40}$/i.test(value)) fail(`${field} must be a nonzero EVM address`);
  return value.toLowerCase();
}

function canonicalAssetId(address: string): string {
  return `eip155:${ROBINHOOD_CHAIN_ID}/contract:${address.toLowerCase()}`;
}

function isProvider(value: unknown): value is RmtPaperQuoteProvider {
  return ["sushi", "uniswap-v3", "uniswapx", "zero-x-swap", "zero-x-gasless", "up-v2", "up-cl"].includes(value as string);
}

function isAttemptStatus(value: unknown): value is RmtPaperQuoteAttemptStatus {
  return ["indicative", "no_route", "temporarily_unavailable", "invalid_response"].includes(value as string);
}

function parseAtomicOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail(`${field} must be an atomic string or null`);
  assertAtomicAmount(value, field);
  return value;
}

function parseNullableTimestamp(value: unknown, field: string): number | null {
  return value === null ? null : assertTimestamp(value, field);
}

function parseAttempt(
  value: unknown,
  expected: { inputAsset: string; outputAsset: string; inputAmountAtomic: string },
  nowMs: number,
): RmtNormalizedPaperQuoteAttempt {
  if (!isRecord(value)) fail("paper quote attempt must be an object");
  if (!isProvider(value.provider)) fail("paper quote provider is unsupported");
  if (value.adapterVersion !== 1) fail("paper quote adapterVersion is unsupported");
  if (!isAttemptStatus(value.status)) fail("paper quote attempt status is invalid");
  if (value.chainId !== ROBINHOOD_CHAIN_ID) fail("paper quote attempt chainId mismatch");
  const inputAsset = normalizeAddress(value.inputAsset, "paper quote inputAsset");
  const outputAsset = normalizeAddress(value.outputAsset, "paper quote outputAsset");
  if (inputAsset !== expected.inputAsset || outputAsset !== expected.outputAsset) fail("paper quote attempt assets changed");
  if (value.inputAmountAtomic !== expected.inputAmountAtomic) fail("paper quote attempt input amount changed");
  assertPositiveAtomicAmount(value.inputAmountAtomic as string, "paper quote inputAmountAtomic");
  const latencyMs = assertTimestamp(value.latencyMs, "paper quote latencyMs");
  if (value.authorizationReady !== false) fail("paper quote observation cannot claim wallet authorization readiness");
  if (typeof value.strictVerificationAvailable !== "boolean") fail("paper quote strictVerificationAvailable must be boolean");
  if (value.userPaysGas !== null && typeof value.userPaysGas !== "boolean") fail("paper quote userPaysGas must be boolean or null");
  if (value.networkFeeNativeSymbol !== null && value.networkFeeNativeSymbol !== "ETH") fail("paper quote network fee symbol is invalid");
  const networkFeeNativeAtomic = parseAtomicOrNull(value.networkFeeNativeAtomic, "paper quote networkFeeNativeAtomic");
  if (value.costState !== null && value.costState !== "network_fee_pending") fail("paper quote costState is invalid");

  const expectedOutputAtomic = parseAtomicOrNull(value.expectedOutputAtomic, "paper quote expectedOutputAtomic");
  const protectedOutputAtomic = parseAtomicOrNull(value.protectedOutputAtomic, "paper quote protectedOutputAtomic");
  const quotedAtMs = parseNullableTimestamp(value.quotedAtMs, "paper quote quotedAtMs");
  const expiresAtMs = parseNullableTimestamp(value.expiresAtMs, "paper quote expiresAtMs");
  const outputDecimals = value.outputDecimals;
  const priceImpact = value.priceImpact;

  if (value.status === "indicative") {
    if (expectedOutputAtomic === null || protectedOutputAtomic === null) fail("indicative paper quote is missing output amounts");
    if (BigInt(expectedOutputAtomic) <= 0n || BigInt(protectedOutputAtomic) <= 0n || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)) {
      fail("indicative paper quote output amounts are invalid");
    }
    if (typeof outputDecimals !== "number" || !Number.isSafeInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 255) {
      fail("indicative paper quote outputDecimals is invalid");
    }
    if (typeof priceImpact !== "number" || !Number.isFinite(priceImpact) || priceImpact < 0 || priceImpact > 1) {
      fail("indicative paper quote requires a finite priceImpact from 0 to 1");
    }
    if (quotedAtMs === null || expiresAtMs === null) fail("indicative paper quote is missing timestamps");
    if (quotedAtMs > nowMs + MAX_CLOCK_SKEW_MS) fail("indicative paper quote is from the future");
    if (expiresAtMs <= nowMs || expiresAtMs <= quotedAtMs) fail("indicative paper quote is expired or has an invalid expiry");
    if (value.userPaysGas === null) fail("indicative paper quote is missing gas-payer semantics");
    if (value.userPaysGas === true) {
      if (value.networkFeeNativeSymbol !== "ETH" || value.costState !== "network_fee_pending") {
        fail("wallet-gas paper quote omitted pending network-fee semantics");
      }
    } else if (value.costState !== null || value.networkFeeNativeSymbol !== null || networkFeeNativeAtomic !== null) {
      fail("non-wallet-gas paper quote exposed wallet network-fee semantics");
    }
  } else if (
    expectedOutputAtomic !== null
    || protectedOutputAtomic !== null
    || outputDecimals !== null
    || priceImpact !== null
    || quotedAtMs !== null
    || expiresAtMs !== null
    || value.userPaysGas !== null
    || networkFeeNativeAtomic !== null
    || value.networkFeeNativeSymbol !== null
    || value.costState !== null
  ) {
    fail("unavailable paper quote attempt exposed partial economics");
  }

  return {
    provider: value.provider,
    adapterVersion: 1,
    status: value.status,
    chainId: ROBINHOOD_CHAIN_ID,
    inputAsset,
    outputAsset,
    inputAmountAtomic: value.inputAmountAtomic as string,
    expectedOutputAtomic,
    protectedOutputAtomic,
    outputDecimals: outputDecimals as number | null,
    priceImpact: priceImpact as number | null,
    quotedAtMs,
    expiresAtMs,
    latencyMs,
    strictVerificationAvailable: value.strictVerificationAvailable,
    authorizationReady: false,
    userPaysGas: value.userPaysGas as boolean | null,
    networkFeeNativeAtomic,
    networkFeeNativeSymbol: value.networkFeeNativeSymbol as "ETH" | null,
    costState: value.costState as "network_fee_pending" | null,
  };
}

function parseResponse(value: unknown, input: RmtPaperQuoteReaderInput): RmtNormalizedPaperQuoteResponse {
  if (!isRecord(value)) fail("paper quote response must be an object");
  if (typeof value.requestId !== "string" || !UUID_PATTERN.test(value.requestId)) fail("paper quote requestId must be a UUID");
  if (value.chainId !== ROBINHOOD_CHAIN_ID) fail("paper quote response chainId mismatch");
  const expected = {
    inputAsset: normalizeAddress(input.inputAsset, "requested inputAsset"),
    outputAsset: normalizeAddress(input.outputAsset, "requested outputAsset"),
    inputAmountAtomic: input.inputAmountAtomic,
  };
  assertPositiveAtomicAmount(expected.inputAmountAtomic, "requested inputAmountAtomic");
  if (normalizeAddress(value.inputAsset, "paper quote response inputAsset") !== expected.inputAsset) fail("paper quote response inputAsset changed");
  if (normalizeAddress(value.outputAsset, "paper quote response outputAsset") !== expected.outputAsset) fail("paper quote response outputAsset changed");
  if (value.inputAmountAtomic !== expected.inputAmountAtomic) fail("paper quote response input amount changed");
  const requestedAtMs = assertTimestamp(value.requestedAtMs, "paper quote requestedAtMs");
  const completedAtMs = assertTimestamp(value.completedAtMs, "paper quote completedAtMs");
  if (requestedAtMs > completedAtMs || completedAtMs > input.observedAtMs + MAX_CLOCK_SKEW_MS) fail("paper quote response timestamps are inconsistent");
  if (!Array.isArray(value.attempts) || value.attempts.length === 0 || value.attempts.length > 8) fail("paper quote response must contain 1 to 8 attempts");
  const attempts = value.attempts.map((attempt) => parseAttempt(attempt, expected, input.observedAtMs));
  if (new Set(attempts.map((attempt) => attempt.provider)).size !== attempts.length) fail("paper quote response contains duplicate providers");
  for (const attempt of attempts) {
    if (attempt.status !== "indicative") continue;
    if (attempt.quotedAtMs! < requestedAtMs - MAX_CLOCK_SKEW_MS || attempt.quotedAtMs! > completedAtMs + MAX_CLOCK_SKEW_MS) {
      fail("paper quote attempt timestamp is inconsistent with comparison window");
    }
  }
  const decimals = new Set(attempts.filter((attempt) => attempt.status === "indicative").map((attempt) => attempt.outputDecimals));
  if (decimals.size > 1) fail("paper quote attempts disagree on output decimals");
  return {
    requestId: value.requestId,
    chainId: ROBINHOOD_CHAIN_ID,
    inputAsset: expected.inputAsset,
    outputAsset: expected.outputAsset,
    inputAmountAtomic: expected.inputAmountAtomic,
    requestedAtMs,
    completedAtMs,
    attempts,
  };
}

function priceImpactBps(priceImpact: number): number {
  const bps = Math.ceil(priceImpact * 10_000);
  assertBps(bps, "paper quote priceImpactBps");
  return bps;
}

function selectAttempt(response: RmtNormalizedPaperQuoteResponse, policy: RmtPaperQuotePolicy, nowMs: number): RmtNormalizedPaperQuoteAttempt {
  const eligible = response.attempts
    .filter((attempt) => attempt.status === "indicative")
    .filter((attempt) => attempt.strictVerificationAvailable)
    .filter((attempt) => attempt.quotedAtMs !== null && Math.max(0, nowMs - attempt.quotedAtMs) <= policy.maximumQuoteAgeMs)
    .filter((attempt) => attempt.priceImpact !== null && priceImpactBps(attempt.priceImpact) <= policy.maximumPriceImpactBps)
    .sort((left, right) => {
      const leftOutput = BigInt(left.protectedOutputAtomic!);
      const rightOutput = BigInt(right.protectedOutputAtomic!);
      if (leftOutput !== rightOutput) return leftOutput > rightOutput ? -1 : 1;
      if (left.latencyMs !== right.latencyMs) return left.latencyMs - right.latencyMs;
      return left.provider.localeCompare(right.provider);
    });
  const selected = eligible[0];
  if (!selected) fail("no strictly verified paper quote satisfies freshness and price-impact policy");
  return selected;
}

export function assertRmtPaperQuoteResult(result: RmtPaperQuoteResult): void {
  assertNonEmpty(result.readerSourceId, "paper quote readerSourceId");
  if (!UUID_PATTERN.test(result.sourceRequestId)) fail("paper quote sourceRequestId must be a UUID");
  assertHash(result.comparisonHash, "paper quote comparisonHash");
  assertHash(result.selectedAttemptHash, "paper quote selectedAttemptHash");
  assertHash(result.resultHash, "paper quote resultHash");
  assertHash(result.evidence.evidenceHash, "paper quote evidenceHash");
  if (result.comparison.requestId !== result.sourceRequestId) fail("paper quote comparison requestId mismatch");
  if (result.comparisonHash !== hashCanonicalPayload(result.comparison)) fail("paper quote comparison hash mismatch");
  const selected = result.comparison.attempts.filter((attempt) => hashCanonicalPayload(attempt) === result.selectedAttemptHash);
  if (selected.length !== 1) fail("paper quote selected attempt hash does not identify exactly one comparison attempt");
  const attempt = selected[0]!;
  if (attempt.status !== "indicative" || !attempt.strictVerificationAvailable) fail("paper quote selected attempt is not strictly verified indicative evidence");
  if (attempt.provider !== result.provider) fail("paper quote selected provider mismatch");
  if (attempt.outputDecimals !== result.outputDecimals) fail("paper quote selected output decimals mismatch");
  if (attempt.userPaysGas !== result.userPaysGas) fail("paper quote selected gas-payer mismatch");
  const expectedCostState = attempt.userPaysGas ? "NETWORK_FEE_PENDING" : "NO_SEPARATE_COST_LEDGER";
  if (result.costState !== expectedCostState) fail("paper quote costState mismatch");
  if (result.evidence.inputAssetId !== canonicalAssetId(result.comparison.inputAsset)) fail("paper quote evidence input asset mismatch");
  if (result.evidence.outputAssetId !== canonicalAssetId(result.comparison.outputAsset)) fail("paper quote evidence output asset mismatch");
  if (result.evidence.inputAmountAtomic !== result.comparison.inputAmountAtomic) fail("paper quote evidence input amount mismatch");
  if (result.evidence.outputAmountAtomic !== attempt.protectedOutputAtomic) fail("paper quote evidence output amount is not selected protected output");
  if (result.evidence.providerId !== `rmt-vnext:${attempt.provider}:adapter-v1`) fail("paper quote evidence providerId mismatch");
  if (result.evidence.priceImpactBps !== priceImpactBps(attempt.priceImpact!)) fail("paper quote evidence price impact mismatch");
  if (result.evidence.observedAt !== attempt.quotedAtMs || result.evidence.expiresAt !== attempt.expiresAtMs) fail("paper quote evidence timestamps mismatch");
  const { evidenceHash, ...evidencePayload } = result.evidence;
  if (evidenceHash !== hashPaperQuoteEvidence(evidencePayload)) fail("paper quote evidence hash mismatch");
  const { resultHash, ...resultPayload } = result;
  if (resultHash !== hashCanonicalPayload(resultPayload)) fail("paper quote result hash mismatch");
}

export class RmtPaperQuoteService {
  private readonly reader: RmtPaperQuoteReader;
  private readonly policy: RmtPaperQuotePolicy;

  constructor(input: { reader: RmtPaperQuoteReader; policy: RmtPaperQuotePolicy }) {
    this.reader = input.reader;
    this.policy = structuredClone(input.policy);
    assertNonEmpty(this.reader.sourceId, "paper quote reader sourceId");
    if (!Number.isSafeInteger(this.policy.maximumQuoteAgeMs) || this.policy.maximumQuoteAgeMs <= 0) fail("maximumQuoteAgeMs must be a positive safe integer");
    assertBps(this.policy.maximumPriceImpactBps, "maximumPriceImpactBps");
  }

  async quote(input: {
    inputAsset: string;
    outputAsset: string;
    inputAmountAtomic: string;
    observedAtMs?: number;
  }): Promise<RmtPaperQuoteResult> {
    const observedAtMs = input.observedAtMs ?? Date.now();
    assertTimestamp(observedAtMs, "paper quote observedAtMs");
    const inputAsset = normalizeAddress(input.inputAsset, "paper quote requested inputAsset");
    const outputAsset = normalizeAddress(input.outputAsset, "paper quote requested outputAsset");
    if (inputAsset === outputAsset) fail("paper quote assets must differ");
    assertPositiveAtomicAmount(input.inputAmountAtomic, "paper quote requested inputAmountAtomic");
    const readerInput: RmtPaperQuoteReaderInput = {
      chainId: ROBINHOOD_CHAIN_ID,
      inputAsset,
      outputAsset,
      inputAmountAtomic: input.inputAmountAtomic,
      observedAtMs,
    };
    const comparison = parseResponse(await this.reader.compare(structuredClone(readerInput)), readerInput);
    const selected = selectAttempt(comparison, this.policy, observedAtMs);
    const comparisonHash = hashCanonicalPayload(comparison);
    const selectedAttemptHash = hashCanonicalPayload(selected);
    const inputAssetId = canonicalAssetId(inputAsset);
    const outputAssetId = canonicalAssetId(outputAsset);
    const quotePayload: Omit<VerifiedPaperQuoteEvidence, "evidenceHash"> = {
      quoteId: hashCanonicalPayload({
        schemaVersion: 1,
        sourceId: this.reader.sourceId,
        comparisonHash,
        selectedAttemptHash,
        provider: selected.provider,
        quotedAtMs: selected.quotedAtMs,
        protectedOutputAtomic: selected.protectedOutputAtomic,
      }),
      inputAssetId,
      outputAssetId,
      inputAmountAtomic: comparison.inputAmountAtomic,
      outputAmountAtomic: selected.protectedOutputAtomic!,
      providerId: `rmt-vnext:${selected.provider}:adapter-v1`,
      priceImpactBps: priceImpactBps(selected.priceImpact!),
      observedAt: selected.quotedAtMs!,
      expiresAt: selected.expiresAtMs!,
    };
    const evidence: VerifiedPaperQuoteEvidence = {
      ...quotePayload,
      evidenceHash: hashPaperQuoteEvidence(quotePayload),
    };
    const resultPayload: Omit<RmtPaperQuoteResult, "resultHash"> = {
      readerSourceId: this.reader.sourceId,
      sourceRequestId: comparison.requestId,
      provider: selected.provider,
      outputDecimals: selected.outputDecimals!,
      userPaysGas: selected.userPaysGas!,
      costState: selected.userPaysGas ? "NETWORK_FEE_PENDING" : "NO_SEPARATE_COST_LEDGER",
      comparison: structuredClone(comparison),
      comparisonHash,
      selectedAttemptHash,
      evidence,
    };
    const result: RmtPaperQuoteResult = {
      ...resultPayload,
      resultHash: hashCanonicalPayload(resultPayload),
    };
    assertRmtPaperQuoteResult(result);
    return result;
  }
}