import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { encodeFunctionData, erc20Abi, getAddress, isAddress, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { VNextPreSignEvidence } from "../vnext/pre-sign-evidence";
import { VNEXT_V2_ATOMIC_INPUT_FEE } from "../vnext/execution-settlement";
import type { VNextVerifyAgainReason } from "../vnext/authorization-failure";
export { VNEXT_VERIFY_AGAIN_REASONS, type VNextVerifyAgainReason } from "../vnext/authorization-failure";
import { ROBINHOOD_WETH_ADDRESS, isRobinhoodNativeAsset } from "../vnext/robinhood-assets";
import {
  RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
  RMT_UNISWAP_V2_V2_PROVIDER_ID,
  assertRmtUniswapV2FeeCalldataV2,
  createRmtUniswapV2FeeExecutionV2,
  rmtUniswapV2RouteIdentityV2,
  type RmtUniswapV2FeeRouteV2
} from "../vnext/uniswap-v2-fee-executor-v2";
import { RMT_UNISWAP_V3_V2_PROVIDER_ID } from "../vnext/uniswap-v3-fee-executor-v2";

export const VNEXT_V2_VERIFICATION_COMMITMENT_VERSION = 1 as const;
export const VNEXT_V2_VERIFICATION_COMMITMENT_TTL_MS = 60_000;
const PURPOSE = "RMT_VNEXT_V2_VERIFY_AUTHORIZE" as const;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const IDENTITY_HASH = /^[0-9a-f]{64}$/;
const ZERO_HASH = `0x${"0".repeat(64)}`;

export class VNextV2VerificationCommitmentError extends Error {
  readonly reason: VNextVerifyAgainReason;

  constructor(message: string, reason: VNextVerifyAgainReason = "IMMUTABLE_CONTINUITY_CHANGED") {
    super(message);
    this.name = "VNextV2VerificationCommitmentError";
    this.reason = reason;
  }
}

export class VNextV2VerificationCommitmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VNextV2VerificationCommitmentConfigurationError";
  }
}

function fail(message: string, reason?: VNextVerifyAgainReason): never {
  throw new VNextV2VerificationCommitmentError(message, reason);
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
  provider: z.enum(["uniswap-v2", "uniswap-v3"]),
  status: z.enum(["verified", "approval_required"]),
  settlementMode: z.literal(VNEXT_V2_ATOMIC_INPUT_FEE),
  implementationId: z.string().min(1),
  executor: z.string().refine((value) => isAddress(value, { strict: false })),
  executorRuntimeHash: z.string().regex(HASH),
  providerTarget: z.string().refine((value) => isAddress(value, { strict: false })),
  providerId: z.string().regex(HASH),
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
  feeAsset: z.string().min(1),
  expectedOutputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  protectedOutputAtomic: z.string().regex(/^[1-9][0-9]*$/),
  indicativeProtectedOutputFloorAtomic: z.string().regex(/^[1-9][0-9]*$/),
  routeKind: z.enum(["direct", "weth_hop"]),
  pool0: z.string().refine((value) => isAddress(value, { strict: false })),
  pool1: z.string().refine((value) => isAddress(value, { strict: false })).nullable(),
  fee0: z.number().int().positive(),
  fee1: z.number().int().positive().nullable(),
  routeIdentity: z.string().regex(HASH).nullable(),
  recipient: z.string().refine((value) => isAddress(value, { strict: false })),
  approvalSpender: z.string().refine((value) => isAddress(value, { strict: false })),
  approvalRequired: z.boolean(),
  deadline: z.string().regex(/^[1-9][0-9]*$/),
  executionId: z.string().regex(HASH),
  swapCalldataHash: z.string().regex(HASH),
  transactionKind: z.enum(["approval", "swap"]),
  transactionTarget: z.string().refine((value) => isAddress(value, { strict: false })),
  transactionCalldataHash: z.string().regex(HASH),
  transactionValueAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/),
  gasLimitUnits: z.string().regex(/^[1-9][0-9]*$/),
  infrastructureVerifiedAtBlock: z.string().regex(/^[1-9][0-9]*$/).nullable(),
  infrastructureVerifiedAtBlockHash: z.string().regex(HASH).nullable(),
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
    (evidence.provider !== "uniswap-v2" && evidence.provider !== "uniswap-v3")
    || evidence.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE
    || evidence.rmtFeeEnabled
    || evidence.feeExecution != null
    || evidence.directNoRmtFee !== undefined
    || !economics
    || !settlement
    || settlement.provider !== evidence.provider
    || settlement.settlementMode !== "v2-atomic-input-fee"
    || settlement.executionId === ZERO_HASH
    || !HASH.test(settlement.executionId)
    || !evidence.nextAction
    || !evidence.nextActionTarget
    || !evidence.nextActionCalldataHash
    || !evidence.gasLimitUnits
  ) fail("The V2 verification authority is incomplete or contradictory.");
  if (
    (evidence.route !== "direct" && evidence.route !== "weth_hop")
    || evidence.pools.length !== (evidence.route === "direct" ? 1 : 2)
    || evidence.fees.length !== (evidence.route === "direct" ? 1 : 2)
  ) fail("The verified V2 route evidence is incomplete or contradictory.", "ROUTE_CHANGED");
  const expectedImplementationId = evidence.provider === "uniswap-v2"
    ? RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID
    : settlement.implementationId;
  if (
    settlement.implementationId !== expectedImplementationId
    || getAddress(evidence.router) !== getAddress(settlement.providerTarget)
  ) fail("The V2 provider implementation or router authority changed.", "AUTHORITY_CHANGED");
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
  const infrastructureVerifiedAtBlock = evidence.infrastructureVerifiedAtBlock ?? null;
  const infrastructureVerifiedAtBlockHash = evidence.infrastructureVerifiedAtBlockHash ?? null;
  if (evidence.provider === "uniswap-v2" && (!infrastructureVerifiedAtBlock || !infrastructureVerifiedAtBlockHash)) {
    fail("The Uniswap V2 infrastructure verification block is missing.");
  }
  if (evidence.provider === "uniswap-v3" && (infrastructureVerifiedAtBlock || infrastructureVerifiedAtBlockHash)) {
    fail("The verification contains foreign infrastructure authority.");
  }
  const routedInput = isRobinhoodNativeAsset(getAddress(evidence.inputAsset))
    ? ROBINHOOD_WETH_ADDRESS
    : getAddress(evidence.inputAsset);
  const routedOutput = isRobinhoodNativeAsset(getAddress(evidence.outputAsset))
    ? ROBINHOOD_WETH_ADDRESS
    : getAddress(evidence.outputAsset);
  const v2Route: RmtUniswapV2FeeRouteV2 | null = evidence.provider === "uniswap-v2" ? {
    kind: evidence.route === "direct" ? 0 : 1,
    tokenIn: routedInput,
    tokenOut: routedOutput,
    pair0: getAddress(evidence.pools[0]),
    pair1: evidence.route === "direct" ? zeroAddress : getAddress(evidence.pools[1])
  } : null;
  if (
    v2Route?.kind === 1
    && (v2Route.tokenIn === ROBINHOOD_WETH_ADDRESS || v2Route.tokenOut === ROBINHOOD_WETH_ADDRESS || v2Route.pair1 === zeroAddress)
  ) {
    fail("The verified Uniswap V2 WETH-hop route is invalid.", "ROUTE_CHANGED");
  }
  const routeIdentity = v2Route === null ? null : rmtUniswapV2RouteIdentityV2(v2Route);
  return {
    provider: evidence.provider,
    status: evidence.status === "verified" || evidence.status === "approval_required"
      ? evidence.status
      : fail("The V2 verification is not ready for authorization."),
    settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE,
    implementationId: settlement.implementationId,
    executor: getAddress(settlement.executionTarget),
    executorRuntimeHash: input.executorRuntimeHash.toLowerCase() as Hex,
    providerTarget: getAddress(settlement.providerTarget),
    providerId: evidence.provider === "uniswap-v2" ? RMT_UNISWAP_V2_V2_PROVIDER_ID : RMT_UNISWAP_V3_V2_PROVIDER_ID,
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
    feeAsset: economics.feeAsset,
    expectedOutputAtomic: evidence.expectedOutputAtomic,
    protectedOutputAtomic: evidence.protectedOutputAtomic,
    indicativeProtectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic,
    routeKind: evidence.route,
    pool0: getAddress(evidence.pools[0]),
    pool1: evidence.route === "direct" ? null : getAddress(evidence.pools[1]),
    fee0: evidence.fees[0],
    fee1: evidence.route === "direct" ? null : evidence.fees[1],
    routeIdentity,
    recipient: getAddress(evidence.recipient),
    approvalSpender: getAddress(evidence.approvalSpender),
    approvalRequired: evidence.approvalRequired,
    deadline: evidence.deadline,
    executionId: settlement.executionId.toLowerCase() as Hex,
    swapCalldataHash: evidence.calldataHash.toLowerCase() as Hex,
    transactionKind: evidence.nextAction,
    transactionTarget: getAddress(evidence.nextActionTarget),
    transactionCalldataHash: evidence.nextActionCalldataHash.toLowerCase() as Hex,
    transactionValueAtomic: evidence.transactionValueAtomic,
    gasLimitUnits: evidence.gasLimitUnits,
    infrastructureVerifiedAtBlock,
    infrastructureVerifiedAtBlockHash: infrastructureVerifiedAtBlockHash === null
      ? null
      : infrastructureVerifiedAtBlockHash.toLowerCase() as Hex
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
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    fail("The V2 verification commitment is malformed.", "COMMITMENT_INVALID_OR_EXPIRED");
  }
  const secret = input.secret ?? vNextV2VerificationCommitmentSecret();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], "base64url");
  } catch {
    fail("The V2 verification commitment signature is malformed.", "COMMITMENT_INVALID_OR_EXPIRED");
  }
  const expected = signature(secret, parts[1]);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail("The V2 verification commitment signature is invalid.", "COMMITMENT_INVALID_OR_EXPIRED");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    fail("The V2 verification commitment payload is malformed.", "COMMITMENT_INVALID_OR_EXPIRED");
  }
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) fail("The V2 verification commitment claims are invalid.", "COMMITMENT_INVALID_OR_EXPIRED");
  const claims = parsed.data;
  if (
    claims.identityHash !== identityHash(input.identityId)
    || getAddress(claims.wallet) !== getAddress(input.wallet)
    || claims.quoteRequestId !== input.quoteRequestId
    || claims.verificationId !== input.verificationId
  ) fail("The V2 verification commitment belongs to another identity, wallet, quote, or verification.", "COMMITMENT_INVALID_OR_EXPIRED");
  if (
    !Number.isSafeInteger(input.nowMs)
    || input.nowMs < claims.issuedAtMs - 5_000
    || input.nowMs >= claims.expiresAtMs
    || claims.expiresAtMs - claims.issuedAtMs > VNEXT_V2_VERIFICATION_COMMITMENT_TTL_MS
  ) fail("The V2 verification commitment expired.", "COMMITMENT_INVALID_OR_EXPIRED");
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
  swapCalldata?: Hex;
  transactionCalldata?: Hex;
}) {
  const actual = evidenceFields(input);
  const expected = {
    provider: input.claims.provider,
    status: input.claims.status,
    settlementMode: input.claims.settlementMode,
    implementationId: input.claims.implementationId,
    executor: getAddress(input.claims.executor),
    executorRuntimeHash: input.claims.executorRuntimeHash.toLowerCase(),
    providerTarget: getAddress(input.claims.providerTarget),
    providerId: input.claims.providerId.toLowerCase(),
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
    feeAsset: input.claims.feeAsset,
    expectedOutputAtomic: input.claims.expectedOutputAtomic,
    protectedOutputAtomic: input.claims.protectedOutputAtomic,
    indicativeProtectedOutputFloorAtomic: input.claims.indicativeProtectedOutputFloorAtomic,
    routeKind: input.claims.routeKind,
    pool0: getAddress(input.claims.pool0),
    pool1: input.claims.pool1 === null ? null : getAddress(input.claims.pool1),
    fee0: input.claims.fee0,
    fee1: input.claims.fee1,
    routeIdentity: input.claims.routeIdentity?.toLowerCase() ?? null,
    recipient: getAddress(input.claims.recipient),
    approvalSpender: getAddress(input.claims.approvalSpender),
    approvalRequired: input.claims.approvalRequired,
    deadline: input.claims.deadline,
    executionId: input.claims.executionId.toLowerCase(),
    swapCalldataHash: input.claims.swapCalldataHash.toLowerCase(),
    transactionKind: input.claims.transactionKind,
    transactionTarget: getAddress(input.claims.transactionTarget),
    transactionCalldataHash: input.claims.transactionCalldataHash.toLowerCase(),
    transactionValueAtomic: input.claims.transactionValueAtomic,
    gasLimitUnits: input.claims.gasLimitUnits,
    infrastructureVerifiedAtBlock: input.claims.infrastructureVerifiedAtBlock,
    infrastructureVerifiedAtBlockHash: input.claims.infrastructureVerifiedAtBlockHash?.toLowerCase() ?? null
  };
  if (input.claims.provider !== "uniswap-v2") {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("The exact verified V2 transaction changed. Verify again.");
    return true;
  }

  const routeFields = ["routeKind", "pool0", "pool1", "fee0", "fee1", "routeIdentity"] as const;
  if (routeFields.some((field) => actual[field] !== expected[field])) {
    fail("The verified Uniswap V2 route changed.", "ROUTE_CHANGED");
  }
  if (actual.deadline !== expected.deadline) {
    fail("The verified Uniswap V2 deadline changed or expired.", "DEADLINE_CHANGED_OR_EXPIRED");
  }
  const approvalFields = ["status", "approvalSpender", "approvalRequired", "transactionKind", "transactionTarget"] as const;
  if (approvalFields.some((field) => actual[field] !== expected[field])) {
    fail("The verified Uniswap V2 approval model changed.", "APPROVAL_CHANGED");
  }
  const immutableFields = [
    "provider", "settlementMode", "implementationId", "executor", "executorRuntimeHash", "providerTarget", "providerId",
    "policyId", "policyVersion", "policyHash", "treasury", "feeBps", "feeSide", "grossInputAtomic", "feeAmountAtomic",
    "providerInputAtomic", "inputAsset", "outputAsset", "feeAsset", "indicativeProtectedOutputFloorAtomic", "recipient",
    "executionId", "transactionValueAtomic", "infrastructureVerifiedAtBlock", "infrastructureVerifiedAtBlockHash"
  ] as const;
  if (immutableFields.some((field) => actual[field] !== expected[field])) {
    fail("Immutable Uniswap V2 authorization authority changed.", "IMMUTABLE_CONTINUITY_CHANGED");
  }

  const aProtected = BigInt(expected.protectedOutputAtomic);
  const bExpected = BigInt(actual.expectedOutputAtomic);
  const bProtected = BigInt(actual.protectedOutputAtomic);
  if (bExpected < aProtected || bProtected < aProtected || bProtected > bExpected) {
    fail("The fresh Uniswap V2 market is below the verified protected-output floor.", "MARKET_BELOW_VERIFIED_FLOOR");
  }

  if (!input.swapCalldata || !input.transactionCalldata) {
    fail("The fresh Uniswap V2 authorization calldata is unavailable.", "PREPARE_FAILED");
  }
  const economics = input.evidence.feeV2Economics;
  if (!economics) fail("The fresh Uniswap V2 fee economics are unavailable.", "PREPARE_FAILED");
  const route: RmtUniswapV2FeeRouteV2 = {
    kind: actual.routeKind === "direct" ? 0 : 1,
    tokenIn: isRobinhoodNativeAsset(getAddress(actual.inputAsset)) ? ROBINHOOD_WETH_ADDRESS : getAddress(actual.inputAsset),
    tokenOut: isRobinhoodNativeAsset(getAddress(actual.outputAsset)) ? ROBINHOOD_WETH_ADDRESS : getAddress(actual.outputAsset),
    pair0: getAddress(actual.pool0),
    pair1: actual.pool1 === null ? zeroAddress : getAddress(actual.pool1)
  };
  const execution = createRmtUniswapV2FeeExecutionV2({
    executor: actual.executor,
    executorRuntimeHash: input.executorRuntimeHash,
    executionId: actual.executionId as Hex,
    economics,
    trader: actual.recipient,
    inputAsset: actual.inputAsset,
    outputAsset: actual.outputAsset,
    deadline: actual.deadline,
    route
  });
  try {
    assertRmtUniswapV2FeeCalldataV2(input.swapCalldata, execution, economics);
  } catch {
    fail("The fresh Uniswap V2 executor calldata is not canonical.", "IMMUTABLE_CONTINUITY_CHANGED");
  }
  if (keccak256(input.swapCalldata).toLowerCase() !== actual.swapCalldataHash) {
    fail("The fresh Uniswap V2 executor calldata hash changed unexpectedly.", "IMMUTABLE_CONTINUITY_CHANGED");
  }
  const canonicalTransactionCalldata = actual.transactionKind === "swap"
    ? input.swapCalldata
    : encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [getAddress(actual.executor), BigInt(actual.grossInputAtomic)]
      });
  if (
    canonicalTransactionCalldata.toLowerCase() !== input.transactionCalldata.toLowerCase()
    || keccak256(input.transactionCalldata).toLowerCase() !== actual.transactionCalldataHash
  ) fail("The fresh Uniswap V2 wallet action calldata is not canonical.", "APPROVAL_CHANGED");
  return true;
}
