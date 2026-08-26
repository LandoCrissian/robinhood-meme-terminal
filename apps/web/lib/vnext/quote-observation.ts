import { getAddress, isAddress } from "viem";
import { z } from "zod";
import {
  assertRmtNetExecutionEconomics,
  type RmtNetExecutionEconomics
} from "./execution-fee-policy";
import {
  assertRmtExecutionFeeV2Economics,
  type RmtExecutionFeeV2Economics
} from "./execution-fee-policy-v2";
import {
  hasVNextWalletAuthorizationCodec,
  isVNextWalletExecutionAdmitted
} from "./provider-execution-capability";

export { hasVNextWalletAuthorizationCodec } from "./provider-execution-capability";

const MAX_CLOCK_SKEW_MS = 5_000;

export type VNextQuoteProvider = "sushi" | "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "uniswapx" | "zero-x-swap" | "zero-x-gasless" | "up-v2" | "up-cl";

export type VNextLiquidityFeeEvidence = {
  source: "uniswap-v2-factory" | "up-v2-factory" | "up-cl-pool";
  poolAddress: string;
  fee: number;
  denominator: 10_000 | 1_000_000;
  stable: boolean | null;
  tickSpacing: number | null;
  observedBlock: string;
  observedBlockHash: `0x${string}`;
};

export type VNextQuoteAttemptStatus =
  | "indicative"
  | "no_route"
  | "temporarily_unavailable"
  | "invalid_response";

export type VNextQuoteAttempt = {
  provider: VNextQuoteProvider;
  providerLabel: string;
  providerFamily: "sushi" | "uniswap" | "uniswapx" | "zeroex" | "up";
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
  liquidityFeeEvidence: VNextLiquidityFeeEvidence[];
  quotedAtMs: number | null;
  expiresAtMs: number | null;
  latencyMs: number;
  executionKind: "aggregator" | "direct_amm" | "gasless" | "rfq_intent";
  strictVerificationAvailable: boolean;
  userPaysGas: boolean | null;
  providerFeeAsset: string | null;
  providerFeeAtomic: string | null;
  gasSponsorshipFeeAsset: string | null;
  gasSponsorshipFeeAtomic: string | null;
  explicitProviderFeeOutputAtomic: string | null;
  netEconomics: RmtNetExecutionEconomics | null;
  feeV2Economics?: RmtExecutionFeeV2Economics;
  networkFeeNativeAtomic: string | null;
  networkFeeNativeSymbol: "ETH" | null;
  protectedNetOutputAtomic: string | null;
  costState: "network_fee_pending" | null;
  authorizationReady: false;
  v4Evidence?: {
    poolId: `0x${string}`;
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
    recipient: string;
    provenance: "canonical-market-indexer+uniswap-v4-quoter+robinhood-rpc";
    observedBlock: string;
    observedBlockHash: `0x${string}`;
    observedAtMs: number;
  };
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
  provider: z.enum(["sushi", "uniswap-v2", "uniswap-v3", "uniswap-v4", "uniswapx", "zero-x-swap", "zero-x-gasless", "up-v2", "up-cl"]),
  providerLabel: z.string().min(1).max(40),
  providerFamily: z.enum(["sushi", "uniswap", "uniswapx", "zeroex", "up"]),
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
  liquidityFeeEvidence: z.array(z.object({
    source: z.enum(["uniswap-v2-factory", "up-v2-factory", "up-cl-pool"]),
    poolAddress: z.string(),
    fee: z.number(),
    denominator: z.union([z.literal(10_000), z.literal(1_000_000)]),
    stable: z.boolean().nullable(),
    tickSpacing: z.number().nullable(),
    observedBlock: z.string(),
    observedBlockHash: z.string()
  })).max(2),
  quotedAtMs: z.number().nullable(),
  expiresAtMs: z.number().nullable(),
  latencyMs: z.number(),
  executionKind: z.enum(["aggregator", "direct_amm", "gasless", "rfq_intent"]),
  strictVerificationAvailable: z.boolean(),
  userPaysGas: z.boolean().nullable(),
  providerFeeAsset: z.string().nullable(),
  providerFeeAtomic: z.string().nullable(),
  gasSponsorshipFeeAsset: z.string().nullable(),
  gasSponsorshipFeeAtomic: z.string().nullable(),
  explicitProviderFeeOutputAtomic: z.string().nullable(),
  netEconomics: z.unknown().nullable(),
  feeV2Economics: z.unknown().optional(),
  networkFeeNativeAtomic: z.string().nullable(),
  networkFeeNativeSymbol: z.literal("ETH").nullable(),
  protectedNetOutputAtomic: z.string().nullable(),
  costState: z.literal("network_fee_pending").nullable(),
  authorizationReady: z.literal(false),
  v4Evidence: z.object({
    poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    currency0: z.string(), currency1: z.string(), fee: z.number().int(), tickSpacing: z.number().int(), hooks: z.string(),
    recipient: z.string(),
    provenance: z.literal("canonical-market-indexer+uniswap-v4-quoter+robinhood-rpc"),
    observedBlock: z.string().regex(/^[1-9][0-9]*$/),
    observedBlockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    observedAtMs: z.number().int().positive()
  }).optional(),
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
  attempts: z.array(attemptSchema).min(1).max(9)
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
  const expectedProviderFamily = attempt.provider === "sushi"
    ? "sushi"
    : attempt.provider === "uniswap-v2" || attempt.provider === "uniswap-v3" || attempt.provider === "uniswap-v4"
      ? "uniswap"
      : attempt.provider === "uniswapx"
        ? "uniswapx"
        : attempt.provider === "up-v2" || attempt.provider === "up-cl"
          ? "up"
          : "zeroex";
  if (attempt.providerFamily !== expectedProviderFamily) throw new Error("Quote attempt provider family changed.");
  if (!isAddress(attempt.inputAsset) || getAddress(attempt.inputAsset) !== getAddress(expected.inputAsset)) throw new Error("Quote attempt input asset changed.");
  if (!isAddress(attempt.outputAsset) || getAddress(attempt.outputAsset) !== getAddress(expected.outputAsset)) throw new Error("Quote attempt output asset changed.");
  if (attempt.inputAmountAtomic !== expected.inputAmountAtomic || !atomic(attempt.inputAmountAtomic) || BigInt(attempt.inputAmountAtomic) <= 0n) throw new Error("Quote attempt input amount changed.");
  if (!Number.isFinite(attempt.latencyMs) || attempt.latencyMs < 0) throw new Error("Quote attempt latency is invalid.");
  if (attempt.authorizationReady !== false) throw new Error("Indicative quote cannot claim authorization readiness.");
  if (attempt.status === "indicative") {
    const expectedOutput = attempt.expectedOutputAtomic ? atomic(attempt.expectedOutputAtomic) : null;
    const protectedOutput = attempt.protectedOutputAtomic ? atomic(attempt.protectedOutputAtomic) : null;
    if (!expectedOutput || !protectedOutput || expectedOutput <= 0n || protectedOutput <= 0n || protectedOutput > expectedOutput) throw new Error("Quote attempt output is invalid.");
    if (!Number.isSafeInteger(attempt.outputDecimals) || attempt.outputDecimals! < 0 || attempt.outputDecimals! > 255) throw new Error("Quote attempt output decimals are invalid.");
    if (!Number.isSafeInteger(attempt.quotedAtMs) || !Number.isSafeInteger(attempt.expiresAtMs) || attempt.quotedAtMs! > nowMs + MAX_CLOCK_SKEW_MS || attempt.expiresAtMs! <= nowMs) throw new Error("Quote attempt is stale or from the future.");
    if (attempt.priceImpact !== null && (!Number.isFinite(attempt.priceImpact) || attempt.priceImpact < 0 || attempt.priceImpact > 1)) throw new Error("Quote attempt price impact is invalid.");
    for (const evidence of attempt.liquidityFeeEvidence) {
      if (
        !isAddress(evidence.poolAddress)
        || !Number.isSafeInteger(evidence.fee)
        || evidence.fee < 0
        || evidence.fee > evidence.denominator
        || !/^[1-9][0-9]*$/.test(evidence.observedBlock)
        || !/^0x[0-9a-fA-F]{64}$/.test(evidence.observedBlockHash)
      ) throw new Error("Quote attempt liquidity-fee evidence is invalid.");
    }
    const feeBlocks = new Set(attempt.liquidityFeeEvidence.map((evidence) => `${evidence.observedBlock}:${evidence.observedBlockHash.toLowerCase()}`));
    const feePools = new Set(attempt.liquidityFeeEvidence.map((evidence) => getAddress(evidence.poolAddress)));
    if (feeBlocks.size > 1 || feePools.size !== attempt.liquidityFeeEvidence.length) throw new Error("Quote attempt liquidity-fee evidence is inconsistent.");
    if (attempt.provider === "up-v2" && (
      attempt.liquidityFeeEvidence.length === 0
      || attempt.liquidityFeeEvidence.some((evidence) => (
        evidence.source !== "up-v2-factory" || evidence.denominator !== 10_000 || evidence.fee > 300
        || evidence.stable === null || evidence.tickSpacing !== null
      ))
    )) throw new Error("up v2 quote omitted live fee evidence.");
    if (attempt.provider === "uniswap-v2" && (
      attempt.liquidityFeeEvidence.length === 0
      || attempt.liquidityFeeEvidence.some((evidence) => (
        evidence.source !== "uniswap-v2-factory" || evidence.denominator !== 10_000 || evidence.fee !== 30
        || evidence.stable !== null || evidence.tickSpacing !== null
      ))
    )) throw new Error("Uniswap V2 quote omitted canonical pair fee evidence.");
    if (attempt.provider === "up-cl" && (
      attempt.liquidityFeeEvidence.length === 0
      || attempt.liquidityFeeEvidence.some((evidence) => (
        evidence.source !== "up-cl-pool" || evidence.denominator !== 1_000_000
        || evidence.stable !== null || !Number.isSafeInteger(evidence.tickSpacing)
        || evidence.tickSpacing! <= 0 || evidence.tickSpacing! > 16_383
      ))
    )) throw new Error("up CL quote omitted live fee evidence.");
    if (attempt.provider !== "uniswap-v2" && attempt.provider !== "up-v2" && attempt.provider !== "up-cl" && attempt.liquidityFeeEvidence.length !== 0) {
      throw new Error("Non-up quote exposed unexpected up liquidity-fee evidence.");
    }
    if (attempt.provider === "uniswap-v4") {
      const evidence = attempt.v4Evidence;
      if (!evidence
        || !isAddress(evidence.currency0)
        || !isAddress(evidence.currency1)
        || !isAddress(evidence.hooks)
        || !isAddress(evidence.recipient)
        || evidence.currency0.toLowerCase() === evidence.currency1.toLowerCase()
        || !Number.isSafeInteger(evidence.fee) || evidence.fee < 0 || evidence.fee > 16_777_215
        || !Number.isSafeInteger(evidence.tickSpacing) || evidence.tickSpacing <= 0 || evidence.tickSpacing > 32_767
      ) throw new Error("Uniswap v4 quote omitted canonical PoolKey evidence.");
    } else if (attempt.v4Evidence !== undefined) {
      throw new Error("Non-v4 quote exposed V4 PoolKey evidence.");
    }
    const providerFee = attempt.providerFeeAtomic === null ? null : atomic(attempt.providerFeeAtomic);
    const gasSponsorshipFee = attempt.gasSponsorshipFeeAtomic === null ? null : atomic(attempt.gasSponsorshipFeeAtomic);
    if (attempt.feeV2Economics) {
      assertRmtExecutionFeeV2Economics(attempt.feeV2Economics);
      if (
        attempt.netEconomics !== null
        || attempt.feeV2Economics.inputAsset !== (isRobinhoodNativeAssetForQuote(attempt.inputAsset)
          ? "eip155:4663/native"
          : `eip155:4663/contract:${getAddress(attempt.inputAsset).toLowerCase()}`)
        || attempt.feeV2Economics.outputAsset !== (isRobinhoodNativeAssetForQuote(attempt.outputAsset)
          ? "eip155:4663/native"
          : `eip155:4663/contract:${getAddress(attempt.outputAsset).toLowerCase()}`)
        || attempt.feeV2Economics.userGrossInputAtomic !== attempt.inputAmountAtomic
        || attempt.feeV2Economics.expectedUserNetOutputAtomic !== attempt.expectedOutputAtomic
        || attempt.feeV2Economics.protectedUserNetOutputAtomic !== attempt.protectedOutputAtomic
      ) throw new Error("Indicative quote exposed inconsistent V2 fee economics.");
    } else {
      if (!attempt.netEconomics) throw new Error("Indicative quote omitted explicit RMT fee economics.");
      assertRmtNetExecutionEconomics(attempt.netEconomics);
    }
    if (
      (attempt.providerFeeAsset === null) !== (attempt.providerFeeAtomic === null)
      || (attempt.providerFeeAsset !== null && (!isAddress(attempt.providerFeeAsset) || providerFee === null))
      || (attempt.gasSponsorshipFeeAsset === null) !== (attempt.gasSponsorshipFeeAtomic === null)
      || (attempt.gasSponsorshipFeeAsset !== null && (!isAddress(attempt.gasSponsorshipFeeAsset) || gasSponsorshipFee === null))
      || attempt.explicitProviderFeeOutputAtomic !== (attempt.providerFeeAsset !== null && getAddress(attempt.providerFeeAsset) === getAddress(attempt.outputAsset) ? attempt.providerFeeAtomic : null)
      || (attempt.netEconomics !== null && (
        attempt.netEconomics.userGrossInputAtomic !== attempt.inputAmountAtomic
        || attempt.netEconomics.expectedUserNetOutputAtomic !== attempt.expectedOutputAtomic
        || attempt.netEconomics.protectedUserNetOutputAtomic !== attempt.protectedOutputAtomic
      ))
    ) throw new Error("Indicative quote exposed incomplete or inconsistent fee economics.");
    if (attempt.userPaysGas === true) {
      if (
        attempt.gasSponsorshipFeeAsset !== null
        || (attempt.networkFeeNativeAtomic !== null && atomic(attempt.networkFeeNativeAtomic) === null)
        || attempt.networkFeeNativeSymbol !== "ETH"
        || attempt.protectedNetOutputAtomic !== null
        || attempt.costState !== "network_fee_pending"
      ) throw new Error("Indicative quote exposed incomplete or inconsistent wallet-gas economics.");
    } else if (attempt.userPaysGas === false && attempt.executionKind === "rfq_intent") {
      if (
        attempt.gasSponsorshipFeeAsset !== null
        || attempt.networkFeeNativeAtomic !== null
        || attempt.networkFeeNativeSymbol !== null
        || attempt.protectedNetOutputAtomic !== attempt.protectedOutputAtomic
        || attempt.costState !== null
      ) throw new Error("Indicative quote exposed incomplete or inconsistent intent-gas economics.");
    } else if (attempt.userPaysGas === false) {
      if (
        attempt.gasSponsorshipFeeAsset === null
        || attempt.networkFeeNativeAtomic !== null
        || attempt.networkFeeNativeSymbol !== null
        || attempt.protectedNetOutputAtomic !== attempt.protectedOutputAtomic
        || attempt.costState !== null
      ) throw new Error("Indicative quote exposed incomplete or inconsistent gasless economics.");
    } else throw new Error("Indicative quote omitted gas-payer economics.");
  } else if (
    attempt.expectedOutputAtomic !== null
    || attempt.protectedOutputAtomic !== null
    || attempt.outputDecimals !== null
    || attempt.priceImpact !== null
    || attempt.liquidityFeeEvidence.length !== 0
    || attempt.quotedAtMs !== null
    || attempt.expiresAtMs !== null
    || attempt.userPaysGas !== null
    || attempt.providerFeeAsset !== null
    || attempt.providerFeeAtomic !== null
    || attempt.gasSponsorshipFeeAsset !== null
    || attempt.gasSponsorshipFeeAtomic !== null
    || attempt.explicitProviderFeeOutputAtomic !== null
    || attempt.netEconomics !== null
    || attempt.networkFeeNativeAtomic !== null
    || attempt.networkFeeNativeSymbol !== null
    || attempt.protectedNetOutputAtomic !== null
    || attempt.costState !== null
  ) {
    throw new Error("Unavailable quote attempt exposed partial economics.");
  }
  return true;
}

function isRobinhoodNativeAssetForQuote(address: string) {
  return getAddress(address) === "0x0000000000000000000000000000000000000000";
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
  selectionBasis: "protected_output_before_network_fee" | "none";
  netOutcomeReady: false;
};

export function selectVNextRoute(attempts: VNextQuoteAttempt[]): VNextRouteSelection {
  const bestObserved = bestIndicativeAttempt(attempts);
  const verificationCandidate = bestIndicativeAttempt(
    attempts.filter((attempt) => (
      attempt.strictVerificationAvailable
      && hasVNextWalletAuthorizationCodec(attempt.provider)
      && isVNextWalletExecutionAdmitted(attempt.provider)
    ))
  );
  return {
    bestObserved,
    verificationCandidate,
    usesVerifiedBackup: Boolean(
      bestObserved
      && verificationCandidate
      && bestObserved.provider !== verificationCandidate.provider
    ),
    selectionBasis: bestObserved ? "protected_output_before_network_fee" : "none",
    netOutcomeReady: false
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
