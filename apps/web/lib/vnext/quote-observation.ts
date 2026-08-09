import { getAddress, isAddress } from "viem";
import { z } from "zod";

const MAX_CLOCK_SKEW_MS = 5_000;

export type VNextQuoteProvider = "sushi" | "uniswap-v3";
export type VNextQuoteAttemptStatus =
  | "indicative"
  | "no_route"
  | "temporarily_unavailable"
  | "invalid_response";

export type VNextQuoteAttempt = {
  provider: VNextQuoteProvider;
  providerLabel: string;
  providerFamily: "sushi" | "uniswap";
  adapterVersion: 1;
  status: VNextQuoteAttemptStatus;
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
  executionKind: "aggregator" | "direct_amm";
  strictVerificationAvailable: boolean;
  userPaysGas: null;
  authorizationReady: false;
  detail: string;
};

export type VNextQuoteResponse = {
  requestId: string;
  chainId: 4_663;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  requestedAtMs: number;
  completedAtMs: number;
  attempts: VNextQuoteAttempt[];
};

const attemptSchema = z.object({
  provider: z.enum(["sushi", "uniswap-v3"]),
  providerLabel: z.string().min(1).max(40),
  providerFamily: z.enum(["sushi", "uniswap"]),
  adapterVersion: z.literal(1),
  status: z.enum(["indicative", "no_route", "temporarily_unavailable", "invalid_response"]),
  chainId: z.literal(4_663),
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmountAtomic: z.string(),
  expectedOutputAtomic: z.string().nullable(),
  protectedOutputAtomic: z.string().nullable(),
  outputDecimals: z.number().nullable(),
  priceImpact: z.number().nullable(),
  quotedAtMs: z.number().nullable(),
  expiresAtMs: z.number().nullable(),
  latencyMs: z.number(),
  executionKind: z.enum(["aggregator", "direct_amm"]),
  strictVerificationAvailable: z.boolean(),
  userPaysGas: z.null(),
  authorizationReady: z.literal(false),
  detail: z.string().min(1).max(240)
});

const responseSchema = z.object({
  requestId: z.string().uuid(),
  chainId: z.literal(4_663),
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmountAtomic: z.string(),
  requestedAtMs: z.number(),
  completedAtMs: z.number(),
  attempts: z.array(attemptSchema).min(1).max(8)
});

function atomic(value: string) {
  return /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}

export function assertVNextQuoteAttempt(
  attempt: VNextQuoteAttempt,
  expected: { inputAsset: string; outputAsset: string; inputAmountAtomic: string },
  nowMs: number
) {
  if (attempt.chainId !== 4_663) throw new Error("Quote attempt chain changed.");
  if ((attempt.provider === "sushi") !== (attempt.providerFamily === "sushi")) throw new Error("Quote attempt provider family changed.");
  if (!isAddress(attempt.inputAsset) || getAddress(attempt.inputAsset) !== getAddress(expected.inputAsset)) throw new Error("Quote attempt input asset changed.");
  if (!isAddress(attempt.outputAsset) || getAddress(attempt.outputAsset) !== getAddress(expected.outputAsset)) throw new Error("Quote attempt output asset changed.");
  if (attempt.inputAmountAtomic !== expected.inputAmountAtomic || !atomic(attempt.inputAmountAtomic) || BigInt(attempt.inputAmountAtomic) <= 0n) throw new Error("Quote attempt input amount changed.");
  if (!Number.isFinite(attempt.latencyMs) || attempt.latencyMs < 0) throw new Error("Quote attempt latency is invalid.");
  if (attempt.authorizationReady !== false || attempt.userPaysGas !== null) throw new Error("Indicative quote cannot claim authorization or gas economics.");
  if (attempt.status === "indicative") {
    const expectedOutput = attempt.expectedOutputAtomic ? atomic(attempt.expectedOutputAtomic) : null;
    const protectedOutput = attempt.protectedOutputAtomic ? atomic(attempt.protectedOutputAtomic) : null;
    if (!expectedOutput || !protectedOutput || expectedOutput <= 0n || protectedOutput <= 0n || protectedOutput > expectedOutput) throw new Error("Quote attempt output is invalid.");
    if (!Number.isSafeInteger(attempt.outputDecimals) || attempt.outputDecimals! < 0 || attempt.outputDecimals! > 255) throw new Error("Quote attempt output decimals are invalid.");
    if (!Number.isSafeInteger(attempt.quotedAtMs) || !Number.isSafeInteger(attempt.expiresAtMs) || attempt.quotedAtMs! > nowMs + MAX_CLOCK_SKEW_MS || attempt.expiresAtMs! <= nowMs) throw new Error("Quote attempt is stale or from the future.");
    if (attempt.priceImpact !== null && (!Number.isFinite(attempt.priceImpact) || attempt.priceImpact < 0 || attempt.priceImpact > 1)) throw new Error("Quote attempt price impact is invalid.");
  } else if (
    attempt.expectedOutputAtomic !== null
    || attempt.protectedOutputAtomic !== null
    || attempt.outputDecimals !== null
    || attempt.quotedAtMs !== null
    || attempt.expiresAtMs !== null
  ) {
    throw new Error("Unavailable quote attempt exposed partial economics.");
  }
  return true;
}

export function bestIndicativeAttempt(attempts: VNextQuoteAttempt[]) {
  const ready = attempts.filter((attempt) => attempt.status === "indicative");
  return [...ready].sort((left, right) => {
    const leftOut = BigInt(left.protectedOutputAtomic!);
    const rightOut = BigInt(right.protectedOutputAtomic!);
    if (leftOut !== rightOut) return leftOut > rightOut ? -1 : 1;
    return left.latencyMs - right.latencyMs;
  })[0];
}

export type VNextRouteSelection = {
  bestObserved: VNextQuoteAttempt | undefined;
  verificationCandidate: VNextQuoteAttempt | undefined;
  usesVerifiedBackup: boolean;
};

export function selectVNextRoute(attempts: VNextQuoteAttempt[]): VNextRouteSelection {
  const bestObserved = bestIndicativeAttempt(attempts);
  const verificationCandidate = bestIndicativeAttempt(
    attempts.filter((attempt) => attempt.strictVerificationAvailable)
  );
  return {
    bestObserved,
    verificationCandidate,
    usesVerifiedBackup: Boolean(
      bestObserved
      && verificationCandidate
      && bestObserved.provider !== verificationCandidate.provider
    )
  };
}

export function parseVNextQuoteResponse(
  value: unknown,
  expected: { inputAsset: string; outputAsset: string; inputAmountAtomic: string },
  nowMs: number
): VNextQuoteResponse {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new Error("RMT rejected a malformed quote comparison response.");
  const response = parsed.data as VNextQuoteResponse;
  if (
    getAddress(response.inputAsset) !== getAddress(expected.inputAsset)
    || getAddress(response.outputAsset) !== getAddress(expected.outputAsset)
    || response.inputAmountAtomic !== expected.inputAmountAtomic
    || response.requestedAtMs > response.completedAtMs
    || response.completedAtMs > nowMs + MAX_CLOCK_SKEW_MS
    || new Set(response.attempts.map((attempt) => attempt.provider)).size !== response.attempts.length
  ) throw new Error("RMT rejected an inconsistent quote comparison response.");
  response.attempts.forEach((attempt) => assertVNextQuoteAttempt(attempt, expected, nowMs));
  const outputDecimals = new Set(response.attempts
    .filter((attempt) => attempt.status === "indicative")
    .map((attempt) => attempt.outputDecimals));
  if (outputDecimals.size > 1) throw new Error("RMT rejected quotes with inconsistent output decimals.");
  return response;
}
