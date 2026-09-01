import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { VNextPreSignEvidence } from "../vnext/pre-sign-evidence";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "../vnext/execution-settlement";

export const VNEXT_V2_VERIFICATION_COMMITMENT_VERSION = 1 as const;
export const VNEXT_V2_VERIFICATION_COMMITMENT_TTL_MS = 60_000;
const PURPOSE = "RMT_VNEXT_V2_VERIFY_AUTHORIZE" as const;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const IDENTITY_HASH = /^[0-9a-f]{64}$/;
const ZERO_HASH = `0x${"0".repeat(64)}`;

export class VNextV2VerificationCommitmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VNextV2VerificationCommitmentError";
  }
}

export class VNextV2VerificationCommitmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VNextV2VerificationCommitmentConfigurationError";
  }
}

function fail(message: string): never {
  throw new VNextV2VerificationCommitmentError(message);
}

export function vNextV2VerificationCommitmentSecret(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const value = env.RMT_VNEXT_VERIFICATION_COMMITMENT_SECRET?.trim() ?? "";
  if (value.length < 32 || value.length > 512) {
    throw new VNextV2VerificationCommitmentConfigurationError(
      "RMT V2 verification commitment signing is not configured."
    );
  }
  return value;
}

function identityHash(identityId: string) {
  if (!identityId) fail("The authenticated identity is missing.");
  return createHash("sha256").update(`rmt-vnext-v2-identity-v1:${identityId}`).digest("hex");
}

const claimsSchema = z.object({
  version: z.literal(VNEXT_V2_VERIFICATION_COMMITMENT_VERSION),
  purpose: z.literal(PURPOSE),
  identityHash: z.string().regex(IDENTITY_HASH),
  wallet: z.string().refine((value) => isAddress(value, { strict: false })),
  chainId: z.literal(4_663),
  quoteRequestId: z.string().uuid(),
  verificationId: z.string().uuid(),
  provider: z.literal("uniswap-v3"),
  status: z.enum(["verified", "approval_required"]),
  settlementMode: z.literal(VNEXT_V2_ATOMIC_INPUT_FEE),
  executor: z.string().refine((value) => isAddress(value, { strict: false })),
  executorRuntimeHash: z.string().regex(HASH),
  providerTarget: z.string().refine((value) => isAddress(value, { strict: false })),
  policyId: z.literal("RMT_EXECUTION_V2"),
  policyVersion: z.literal(2),
  policyHash: z.string().regex(HASH),
  treasury: z.string().refine((value) => isAddress(value, { strict: false })),
  feeBps: z.literal(25),
  feeSide: z.literal("input"),
  grossInputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  feeAmountAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/),
  providerInputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  inputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  outputAsset: z.string().refine((value) => isAddress(value, { strict: false })),
  expectedOutputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  protectedOutputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  indicativeProtectedOutputFloorAtomic: z.string().regex(/^[1-9][0-9]*$/),
  routeKind: z.enum(["direct", "weth_hop"]),
  pool0: z.string().refine((value) => isAddress(value, { strict: false })),
  pool1: z.string().refine((value) => isAddress(value, { strict: false })).nullable(),
  fee0: z.number().int().positive(),
  fee1: z.number().int().positive().nullable(),
  recipient: z.string().refine((value) => isAddress(value, { strict: false })),
  deadline: z.string().regex(/^[1-9][0-9]*$/),
  executionId: z.string().regex(HASH),
  swapCalldataHash: z.string().regex(HASH),
  transactionKind: z.enum(["approval", "swap"]),
  transactionTarget: z.string().refine((value) => isAddress(value, { strict: false })),
  transactionCalldataHash: z.string().regex(HASH),
  transactionValueAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/),
  gasLimitUnits: z.string().regex(/^[1-9][0-9]*$/),
  issuedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive()
}).strict();

export type VNextV2VerificationCommitmentClaims = z.infer<typeof claimsSchema>;

function evidenceFields(input: {
  evidence: VNextPreSignEvidence;
  executorRuntimeHash: Hex;
}) {
  const evidence = input.evidence;
  const economics = evidence.feeV2Economics;
  const settlement = evidence.feeV2Settlement;
  if (
    evidence.provider !== "uniswap-v3"
    || evidence.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE
    || evidence.rmtFeeEnabled
    || evidence.feeExecution != null
    || evidence.directNoRmtFee !== undefined
    || !economics
    || !settlement
    || settlement.provider !== "uniswap-v3"
    || settlement.settlementMode !== "v2-atomic-input-fee"
    || settlement.executionId === ZERO_HASH
    || !HASH.test(settlement.executionId)
    || !evidence.nextAction
    || !evidence.nextActionTarget
    || !evidence.nextActionCalldataHash
    || !evidence.gasLimitUnits
    || (evidence.route !== "direct" && evidence.route !== "weth_hop")
    || evidence.pools.length !== (evidence.route === "direct" ? 1 : 2)
    || evidence.fees.length !== (evidence.route === "direct" ? 1 : 2)
  ) fail("The V2 verification authority is incomplete or contradictory.");
  if (
    economics.userGrossInputAtomic !== evidence.inputAmountAtomic
    || economics.expectedFeeAtomic !== economics.maximumFeeAtomic
    || BigInt(economics.providerInputAtomic) + BigInt(economics.expectedFeeAtomic) !== BigInt(economics.userGrossInputAtomic)
    || economics.expectedUserNetOutputAtomic !== evidence.expectedOutputAtomic
    || economics.protectedUserNetOutputAtomic !== evidence.protectedOutputAtomic
    || getAddress(economics.treasury) === getAddress(settlement.executionTarget)
    || getAddress(settlement.recipient) !== getAddress(evidence.recipient)
    || settlement.deadline !== evidence.deadline
    || settlement.calldataHash.toLowerCase() !== evidence.calldataHash.toLowerCase()
  ) fail("The V2 verification economics or settlement authority changed.");
  return {
    provider: "uniswap-v3" as const,
    status: evidence.status === "verified" || evidence.status === "approval_required"
      ? evidence.status
      : fail("The V2 verification is not ready for authorization."),
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    executor: getAddress(settlement.executionTarget),
    executorRuntimeHash: input.executorRuntimeHash.toLowerCase() as Hex,
    providerTarget: getAddress(settlement.providerTarget),
    policyId: economics.policyId,
    policyVersion: economics.policyVersion,
    policyHash: economics.policyHash.toLowerCase() as Hex,
    treasury: getAddress(economics.treasury),
    feeBps: economics.feeBps,
    feeSide: economics.feeSide,
    grossInputAtomic: economics.userGrossInputAtomic,
    feeAmountAtomic: economics.expectedFeeAtomic,
    providerInputAtomic: economics.providerInputAtomic,
    inputAsset: getAddress(evidence.inputAsset),
    outputAsset: getAddress(evidence.outputAsset),
    expectedOutputAtomic: evidence.expectedOutputAtomic,
    protectedOutputAtomic: evidence.protectedOutputAtomic,
    indicativeProtectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic,
    routeKind: evidence.route,
    pool0: getAddress(evidence.pools[0]),
    pool1: evidence.route === "direct" ? null : getAddress(evidence.pools[1]),
    fee0: evidence.fees[0],
    fee1: evidence.route === "direct" ? null : evidence.fees[1],
    recipient: getAddress(evidence.recipient),
    deadline: evidence.deadline,
    executionId: settlement.executionId.toLowerCase() as Hex,
    swapCalldataHash: evidence.calldataHash.toLowerCase() as Hex,
    transactionKind: evidence.nextAction,
    transactionTarget: getAddress(evidence.nextActionTarget),
    transactionCalldataHash: evidence.nextActionCalldataHash.toLowerCase() as Hex,
    transactionValueAtomic: evidence.transactionValueAtomic,
    gasLimitUnits: evidence.gasLimitUnits
  };
}

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret)
    .update(`rmt-vnext-v2-verification-commitment-v1.${payload}`)
    .digest();
}

export function createVNextV2VerificationCommitment(input: {
  evidence: VNextPreSignEvidence;
  identityId: string;
  quoteRequestId: string;
  verificationId: string;
  executorRuntimeHash: Hex;
  nowMs: number;
  secret?: string;
}) {
  const fields = evidenceFields(input);
  const deadlineMs = Number(BigInt(fields.deadline) * 1_000n);
  const expiresAtMs = Math.min(input.nowMs + VNEXT_V2_VERIFICATION_COMMITMENT_TTL_MS, deadlineMs - 180_000);
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0 || expiresAtMs <= input.nowMs) {
    fail("The V2 verification commitment has insufficient wallet-review runway.");
  }
  const claims: VNextV2VerificationCommitmentClaims = {
    version: VNEXT_V2_VERIFICATION_COMMITMENT_VERSION,
    purpose: PURPOSE,
    identityHash: identityHash(input.identityId),
    wallet: getAddress(input.evidence.recipient),
    chainId: 4_663,
    quoteRequestId: input.quoteRequestId,
    verificationId: input.verificationId,
    ...fields,
    issuedAtMs: input.nowMs,
    expiresAtMs
  };
  claimsSchema.parse(claims);
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const secret = input.secret ?? vNextV2VerificationCommitmentSecret();
  return `v1.${payload}.${signature(secret, payload).toString("base64url")}`;
}

export function verifyVNextV2VerificationCommitment(input: {
  token: string;
  identityId: string;
  wallet: Address;
  quoteRequestId: string;
  verificationId: string;
  nowMs: number;
  secret?: string;
}) {
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) fail("The V2 verification commitment is malformed.");
  const secret = input.secret ?? vNextV2VerificationCommitmentSecret();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], "base64url");
  } catch {
    fail("The V2 verification commitment signature is malformed.");
  }
  const expected = signature(secret, parts[1]);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail("The V2 verification commitment signature is invalid.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    fail("The V2 verification commitment payload is malformed.");
  }
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) fail("The V2 verification commitment claims are invalid.");
  const claims = parsed.data;
  if (
    claims.identityHash !== identityHash(input.identityId)
    || getAddress(claims.wallet) !== getAddress(input.wallet)
    || claims.quoteRequestId !== input.quoteRequestId
    || claims.verificationId !== input.verificationId
  ) fail("The V2 verification commitment belongs to another identity, wallet, quote, or verification.");
  if (
    !Number.isSafeInteger(input.nowMs)
    || input.nowMs < claims.issuedAtMs - 5_000
    || input.nowMs >= claims.expiresAtMs
    || claims.expiresAtMs - claims.issuedAtMs > VNEXT_V2_VERIFICATION_COMMITMENT_TTL_MS
  ) fail("The V2 verification commitment expired.");
  return claims;
}

export function assertVNextV2AuthorizationRequestContinuity(input: {
  claims: VNextV2VerificationCommitmentClaims;
  request: {
    provider: string;
    executionId?: string;
    inputAsset: string;
    outputAsset: string;
    inputAmountAtomic: string;
    recipient: string;
    expectedStatus: string;
    indicativeProtectedOutputFloorAtomic: string;
    expectedProtectedOutputAtomic: string;
  };
}) {
  const request = input.request;
  const claims = input.claims;
  if (
    request.provider !== claims.provider
    || request.executionId?.toLowerCase() !== claims.executionId.toLowerCase()
    || !isAddress(request.inputAsset, { strict: false })
    || getAddress(request.inputAsset) !== getAddress(claims.inputAsset)
    || !isAddress(request.outputAsset, { strict: false })
    || getAddress(request.outputAsset) !== getAddress(claims.outputAsset)
    || request.inputAmountAtomic !== claims.grossInputAtomic
    || !isAddress(request.recipient, { strict: false })
    || getAddress(request.recipient) !== getAddress(claims.recipient)
    || request.expectedStatus !== claims.status
    || request.indicativeProtectedOutputFloorAtomic !== claims.indicativeProtectedOutputFloorAtomic
    || request.expectedProtectedOutputAtomic !== claims.protectedOutputAtomic
  ) fail("The V2 authorization request changed after verification.");
  return true;
}

export function assertVNextV2VerificationContinuity(input: {
  claims: VNextV2VerificationCommitmentClaims;
  evidence: VNextPreSignEvidence;
  executorRuntimeHash: Hex;
}) {
  const actual = evidenceFields(input);
  const expected = {
    provider: input.claims.provider,
    status: input.claims.status,
    settlementMode: input.claims.settlementMode,
    executor: getAddress(input.claims.executor),
    executorRuntimeHash: input.claims.executorRuntimeHash.toLowerCase(),
    providerTarget: getAddress(input.claims.providerTarget),
    policyId: input.claims.policyId,
    policyVersion: input.claims.policyVersion,
    policyHash: input.claims.policyHash.toLowerCase(),
    treasury: getAddress(input.claims.treasury),
    feeBps: input.claims.feeBps,
    feeSide: input.claims.feeSide,
    grossInputAtomic: input.claims.grossInputAtomic,
    feeAmountAtomic: input.claims.feeAmountAtomic,
    providerInputAtomic: input.claims.providerInputAtomic,
    inputAsset: getAddress(input.claims.inputAsset),
    outputAsset: getAddress(input.claims.outputAsset),
    expectedOutputAtomic: input.claims.expectedOutputAtomic,
    protectedOutputAtomic: input.claims.protectedOutputAtomic,
    indicativeProtectedOutputFloorAtomic: input.claims.indicativeProtectedOutputFloorAtomic,
    routeKind: input.claims.routeKind,
    pool0: getAddress(input.claims.pool0),
    pool1: input.claims.pool1 === null ? null : getAddress(input.claims.pool1),
    fee0: input.claims.fee0,
    fee1: input.claims.fee1,
    recipient: getAddress(input.claims.recipient),
    deadline: input.claims.deadline,
    executionId: input.claims.executionId.toLowerCase(),
    swapCalldataHash: input.claims.swapCalldataHash.toLowerCase(),
    transactionKind: input.claims.transactionKind,
    transactionTarget: getAddress(input.claims.transactionTarget),
    transactionCalldataHash: input.claims.transactionCalldataHash.toLowerCase(),
    transactionValueAtomic: input.claims.transactionValueAtomic,
    gasLimitUnits: input.claims.gasLimitUnits
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("The exact verified V2 transaction changed. Verify again.");
  return true;
}
