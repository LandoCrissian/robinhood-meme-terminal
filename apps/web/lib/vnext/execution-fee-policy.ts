import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex
} from "viem";

export const RMT_FEE_BPS_DENOMINATOR = 10_000;
export const RMT_EXECUTION_FEE_POLICY_MAX_BPS = 100;
export const RMT_EXECUTION_V1_DESCRIPTOR = Object.freeze({
  policyId: "RMT_EXECUTION_V1",
  version: 1,
  feeBps: 25,
  allocation: Object.freeze({ purpose: "rmt_operations" as const, bps: 10_000 })
});

const POLICY_HASH_DOMAIN = "RMT_EXECUTION_FEE_POLICY_V1";
const POLICY_ID = /^[A-Z][A-Z0-9_]{2,63}$/;
const ASSET_ID = /^eip155:([1-9][0-9]*)\/(?:native|contract:0x[0-9a-f]{40})$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const SENTINEL_ADDRESSES = new Set([
  zeroAddress,
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002"
].map((address) => address.toLowerCase()));

export type RmtFeeSettlementMode =
  | "rmt-direct-executor-v1"
  | "uniswapx-order-output-v1"
  | "zerox-integrator-fee-v1";

export type RmtFeeSide = "input" | "output";

export type RmtExecutionFeePolicy = {
  policyId: string;
  version: number;
  feeBps: number;
  treasury: Address;
  effectiveBoundary: {
    chainId: number;
    fromBlock: string;
    beforeBlock: string | null;
  };
  eligibleExecutionOrigins: readonly ["rmt"];
  eligibleSettlementAssetIds: readonly string[];
  allocation: {
    purpose: "rmt_operations";
    bps: 10_000;
  };
  policyHash: Hex;
};

export type DisabledRmtFeeCommitment = {
  state: "disabled";
  reason: "policy_not_configured" | "provider_not_admitted" | "execution_not_eligible";
  feePolicyId: null;
  feePolicyVersion: null;
  feePolicyHash: null;
  feeBps: 0;
  feeSide: "none";
  feeAssetId: null;
  expectedFeeAtomic: "0";
  maximumFeeAtomic: "0";
  roundingMode: "floor";
  settlementMode: "none";
  treasury: null;
};

export type PlannedRmtFeeCommitment = {
  state: "planned";
  reason: null;
  feePolicyId: string;
  feePolicyVersion: number;
  feePolicyHash: Hex;
  feeBps: number;
  feeSide: RmtFeeSide;
  feeAssetId: string;
  expectedFeeAtomic: string;
  maximumFeeAtomic: string;
  roundingMode: "floor";
  settlementMode: RmtFeeSettlementMode;
  treasury: Address;
};

export type RmtFeeCommitment = DisabledRmtFeeCommitment | PlannedRmtFeeCommitment;

export type RmtNetExecutionEconomics = {
  userGrossInputAtomic: string;
  providerInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  providerProtectedOutputAtomic: string;
  expectedUserNetOutputAtomic: string;
  protectedUserNetOutputAtomic: string;
  rmtFee: RmtFeeCommitment;
};

type PolicyInput = Omit<RmtExecutionFeePolicy, "policyHash" | "treasury" | "eligibleSettlementAssetIds" | "eligibleExecutionOrigins" | "allocation"> & {
  treasury: string;
  eligibleSettlementAssetIds: readonly string[];
  eligibleExecutionOrigins?: readonly ["rmt"];
  allocation?: { purpose: "rmt_operations"; bps: 10_000 };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid RMT execution fee policy: ${message}.`);
}

function atomic(value: string, label: string, allowZero = false) {
  invariant(ATOMIC.test(value), `${label} must be a canonical atomic-unit string`);
  const amount = BigInt(value);
  invariant(allowZero || amount > 0n, `${label} must be positive`);
  return amount;
}

function normalizedAssetIds(assetIds: readonly string[], chainId: number) {
  invariant(assetIds.length > 0, "at least one settlement asset is required");
  const normalized = assetIds.map((assetId) => assetId.toLowerCase());
  for (const assetId of normalized) {
    const match = ASSET_ID.exec(assetId);
    invariant(match && Number(match[1]) === chainId, "settlement asset identity must match the policy chain");
  }
  const unique = [...new Set(normalized)].sort();
  invariant(unique.length === normalized.length, "settlement asset identities must be unique");
  return unique;
}

function checkedPolicyFields(input: PolicyInput) {
  invariant(POLICY_ID.test(input.policyId), "policy ID is invalid");
  invariant(Number.isSafeInteger(input.version) && input.version > 0, "policy version is invalid");
  invariant(
    Number.isSafeInteger(input.feeBps)
      && input.feeBps > 0
      && input.feeBps <= RMT_EXECUTION_FEE_POLICY_MAX_BPS,
    `fee must be between 1 and ${RMT_EXECUTION_FEE_POLICY_MAX_BPS} basis points`
  );
  invariant(isAddress(input.treasury, { strict: false }), "treasury must be an exact EVM address");
  const treasury = getAddress(input.treasury);
  invariant(!SENTINEL_ADDRESSES.has(treasury.toLowerCase()), "treasury cannot be zero or a router sentinel");
  const boundary = input.effectiveBoundary;
  invariant(Number.isSafeInteger(boundary.chainId) && boundary.chainId > 0, "effective chain is invalid");
  const fromBlock = atomic(boundary.fromBlock, "effective start block");
  const beforeBlock = boundary.beforeBlock === null ? null : atomic(boundary.beforeBlock, "effective end block");
  invariant(beforeBlock === null || beforeBlock > fromBlock, "effective end must follow the start block");
  const origins = input.eligibleExecutionOrigins ?? ["rmt"];
  invariant(origins.length === 1 && origins[0] === "rmt", "only authenticated RMT execution origin is eligible in V1");
  const allocation = input.allocation ?? { purpose: "rmt_operations", bps: 10_000 };
  invariant(allocation.purpose === "rmt_operations" && allocation.bps === 10_000, "V1 allocation must be 100% RMT operations");
  return {
    policyId: input.policyId,
    version: input.version,
    feeBps: input.feeBps,
    treasury,
    effectiveBoundary: {
      chainId: boundary.chainId,
      fromBlock: fromBlock.toString(),
      beforeBlock: beforeBlock?.toString() ?? null
    },
    eligibleExecutionOrigins: ["rmt"] as const,
    eligibleSettlementAssetIds: normalizedAssetIds(input.eligibleSettlementAssetIds, boundary.chainId),
    allocation: { purpose: "rmt_operations" as const, bps: 10_000 as const }
  };
}

function policyHashFor(fields: ReturnType<typeof checkedPolicyFields>) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("string domain, string policyId, uint256 version, uint256 feeBps, address treasury, uint256 chainId, uint256 fromBlock, uint256 beforeBlock, string[] executionOrigins, string[] settlementAssets, string allocationPurpose, uint256 allocationBps"),
    [
      POLICY_HASH_DOMAIN,
      fields.policyId,
      BigInt(fields.version),
      BigInt(fields.feeBps),
      fields.treasury,
      BigInt(fields.effectiveBoundary.chainId),
      BigInt(fields.effectiveBoundary.fromBlock),
      fields.effectiveBoundary.beforeBlock === null ? 0n : BigInt(fields.effectiveBoundary.beforeBlock),
      [...fields.eligibleExecutionOrigins],
      [...fields.eligibleSettlementAssetIds],
      fields.allocation.purpose,
      BigInt(fields.allocation.bps)
    ]
  ));
}

export function createRmtExecutionFeePolicy(input: PolicyInput): RmtExecutionFeePolicy {
  const fields = checkedPolicyFields(input);
  return Object.freeze({ ...fields, policyHash: policyHashFor(fields) });
}

export function createRmtExecutionV1Policy(input: {
  treasury: string;
  chainId: number;
  fromBlock: string;
  beforeBlock?: string | null;
  eligibleSettlementAssetIds: readonly string[];
}) {
  return createRmtExecutionFeePolicy({
    ...RMT_EXECUTION_V1_DESCRIPTOR,
    treasury: input.treasury,
    effectiveBoundary: {
      chainId: input.chainId,
      fromBlock: input.fromBlock,
      beforeBlock: input.beforeBlock ?? null
    },
    eligibleSettlementAssetIds: input.eligibleSettlementAssetIds
  });
}

export function assertRmtExecutionFeePolicy(policy: RmtExecutionFeePolicy) {
  invariant(HASH.test(policy.policyHash), "policy hash is invalid");
  const checked = checkedPolicyFields(policy);
  invariant(policy.policyHash.toLowerCase() === policyHashFor(checked).toLowerCase(), "policy hash does not bind the policy fields");
  return true;
}

export function disabledRmtFeeCommitment(
  reason: DisabledRmtFeeCommitment["reason"] = "policy_not_configured"
): DisabledRmtFeeCommitment {
  return {
    state: "disabled",
    reason,
    feePolicyId: null,
    feePolicyVersion: null,
    feePolicyHash: null,
    feeBps: 0,
    feeSide: "none",
    feeAssetId: null,
    expectedFeeAtomic: "0",
    maximumFeeAtomic: "0",
    roundingMode: "floor",
    settlementMode: "none",
    treasury: null
  };
}

export function assertRmtFeeCommitment(commitment: RmtFeeCommitment) {
  if (commitment.state === "disabled") {
    invariant(
      ["policy_not_configured", "provider_not_admitted", "execution_not_eligible"].includes(commitment.reason)
        && commitment.feePolicyId === null
        && commitment.feePolicyVersion === null
        && commitment.feePolicyHash === null
        && commitment.feeBps === 0
        && commitment.feeSide === "none"
        && commitment.feeAssetId === null
        && commitment.expectedFeeAtomic === "0"
        && commitment.maximumFeeAtomic === "0"
        && commitment.roundingMode === "floor"
        && commitment.settlementMode === "none"
        && commitment.treasury === null,
      "disabled commitment exposed fee authority"
    );
    return true;
  }
  invariant(POLICY_ID.test(commitment.feePolicyId), "commitment policy ID is invalid");
  invariant(Number.isSafeInteger(commitment.feePolicyVersion) && commitment.feePolicyVersion > 0, "commitment policy version is invalid");
  invariant(HASH.test(commitment.feePolicyHash), "commitment policy hash is invalid");
  invariant(Number.isSafeInteger(commitment.feeBps) && commitment.feeBps > 0 && commitment.feeBps <= RMT_EXECUTION_FEE_POLICY_MAX_BPS, "commitment fee is invalid");
  invariant(ASSET_ID.test(commitment.feeAssetId), "commitment fee asset is invalid");
  const expectedFee = atomic(commitment.expectedFeeAtomic, "expected fee", true);
  const maximumFee = atomic(commitment.maximumFeeAtomic, "maximum fee", true);
  invariant(expectedFee <= maximumFee, "expected fee exceeds wallet-authorized maximum");
  invariant(commitment.roundingMode === "floor", "unsupported rounding mode");
  invariant(isAddress(commitment.treasury, { strict: false }) && !SENTINEL_ADDRESSES.has(getAddress(commitment.treasury).toLowerCase()), "commitment treasury is invalid");
  return true;
}

export function assertRmtFeeCommitmentMatchesPolicy(
  commitment: RmtFeeCommitment,
  policy: RmtExecutionFeePolicy
) {
  assertRmtExecutionFeePolicy(policy);
  assertRmtFeeCommitment(commitment);
  invariant(commitment.state === "planned", "disabled commitment cannot bind an active policy");
  invariant(
    commitment.feePolicyId === policy.policyId
      && commitment.feePolicyVersion === policy.version
      && commitment.feePolicyHash.toLowerCase() === policy.policyHash.toLowerCase()
      && commitment.feeBps === policy.feeBps
      && getAddress(commitment.treasury) === policy.treasury
      && policy.eligibleSettlementAssetIds.includes(commitment.feeAssetId),
    "commitment does not match the exact policy"
  );
  return true;
}

function plannedCommitment(input: {
  policy: RmtExecutionFeePolicy;
  feeSide: RmtFeeSide;
  feeAssetId: string;
  expectedFee: bigint;
  maximumFee: bigint;
  settlementMode: RmtFeeSettlementMode;
}) {
  assertRmtExecutionFeePolicy(input.policy);
  const feeAssetId = input.feeAssetId.toLowerCase();
  invariant(input.policy.eligibleSettlementAssetIds.includes(feeAssetId), "fee asset is not eligible under the policy");
  const commitment: PlannedRmtFeeCommitment = {
    state: "planned",
    reason: null,
    feePolicyId: input.policy.policyId,
    feePolicyVersion: input.policy.version,
    feePolicyHash: input.policy.policyHash,
    feeBps: input.policy.feeBps,
    feeSide: input.feeSide,
    feeAssetId,
    expectedFeeAtomic: input.expectedFee.toString(),
    maximumFeeAtomic: input.maximumFee.toString(),
    roundingMode: "floor",
    settlementMode: input.settlementMode,
    treasury: input.policy.treasury
  };
  assertRmtFeeCommitmentMatchesPolicy(commitment, input.policy);
  return commitment;
}

export function calculateRmtFeeFloor(amountAtomic: string, feeBps: number) {
  const amount = atomic(amountAtomic, "fee basis", true);
  invariant(Number.isSafeInteger(feeBps) && feeBps > 0 && feeBps <= RMT_EXECUTION_FEE_POLICY_MAX_BPS, "fee basis points are invalid");
  return (amount * BigInt(feeBps) / BigInt(RMT_FEE_BPS_DENOMINATOR)).toString();
}

function quoteAmounts(input: {
  userGrossInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  providerProtectedOutputAtomic: string;
}) {
  const userGrossInput = atomic(input.userGrossInputAtomic, "gross user input");
  const grossExpectedOutput = atomic(input.providerGrossExpectedOutputAtomic, "gross expected provider output");
  const protectedOutput = atomic(input.providerProtectedOutputAtomic, "protected provider output");
  invariant(protectedOutput <= grossExpectedOutput, "protected provider output exceeds expected output");
  return { userGrossInput, grossExpectedOutput, protectedOutput };
}

export function normalizeInputSideRmtFee(input: {
  policy: RmtExecutionFeePolicy;
  inputAssetId: string;
  outputAssetId: string;
  feeAssetId: string;
  settlementMode: RmtFeeSettlementMode;
  userGrossInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  providerProtectedOutputAtomic: string;
}): RmtNetExecutionEconomics {
  const amounts = quoteAmounts(input);
  invariant(input.feeAssetId.toLowerCase() === input.inputAssetId.toLowerCase(), "input-side fee asset must equal the trade input asset");
  invariant(input.inputAssetId.toLowerCase() !== input.outputAssetId.toLowerCase(), "trade assets must differ");
  const fee = BigInt(calculateRmtFeeFloor(input.userGrossInputAtomic, input.policy.feeBps));
  const providerInput = amounts.userGrossInput - fee;
  invariant(providerInput > 0n, "input-side fee leaves no provider input");
  return {
    userGrossInputAtomic: amounts.userGrossInput.toString(),
    providerInputAtomic: providerInput.toString(),
    providerGrossExpectedOutputAtomic: amounts.grossExpectedOutput.toString(),
    providerProtectedOutputAtomic: amounts.protectedOutput.toString(),
    expectedUserNetOutputAtomic: amounts.grossExpectedOutput.toString(),
    protectedUserNetOutputAtomic: amounts.protectedOutput.toString(),
    rmtFee: plannedCommitment({
      policy: input.policy,
      feeSide: "input",
      feeAssetId: input.feeAssetId,
      expectedFee: fee,
      maximumFee: fee,
      settlementMode: input.settlementMode
    })
  };
}

export function normalizeOutputSideRmtFee(input: {
  policy: RmtExecutionFeePolicy;
  inputAssetId: string;
  outputAssetId: string;
  feeAssetId: string;
  settlementMode: RmtFeeSettlementMode;
  userGrossInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  providerProtectedOutputAtomic: string;
}): RmtNetExecutionEconomics {
  const amounts = quoteAmounts(input);
  invariant(input.feeAssetId.toLowerCase() === input.outputAssetId.toLowerCase(), "output-side fee asset must equal the trade output asset");
  invariant(input.inputAssetId.toLowerCase() !== input.outputAssetId.toLowerCase(), "trade assets must differ");
  const expectedFee = BigInt(calculateRmtFeeFloor(input.providerGrossExpectedOutputAtomic, input.policy.feeBps));
  const protectedFee = BigInt(calculateRmtFeeFloor(input.providerProtectedOutputAtomic, input.policy.feeBps));
  return {
    userGrossInputAtomic: amounts.userGrossInput.toString(),
    providerInputAtomic: amounts.userGrossInput.toString(),
    providerGrossExpectedOutputAtomic: amounts.grossExpectedOutput.toString(),
    providerProtectedOutputAtomic: amounts.protectedOutput.toString(),
    expectedUserNetOutputAtomic: (amounts.grossExpectedOutput - expectedFee).toString(),
    protectedUserNetOutputAtomic: (amounts.protectedOutput - protectedFee).toString(),
    rmtFee: plannedCommitment({
      policy: input.policy,
      feeSide: "output",
      feeAssetId: input.feeAssetId,
      expectedFee,
      maximumFee: expectedFee,
      settlementMode: input.settlementMode
    })
  };
}

export function normalizeDisabledRmtFee(input: {
  userGrossInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  providerProtectedOutputAtomic: string;
  reason?: DisabledRmtFeeCommitment["reason"];
}): RmtNetExecutionEconomics {
  const amounts = quoteAmounts(input);
  return {
    userGrossInputAtomic: amounts.userGrossInput.toString(),
    providerInputAtomic: amounts.userGrossInput.toString(),
    providerGrossExpectedOutputAtomic: amounts.grossExpectedOutput.toString(),
    providerProtectedOutputAtomic: amounts.protectedOutput.toString(),
    expectedUserNetOutputAtomic: amounts.grossExpectedOutput.toString(),
    protectedUserNetOutputAtomic: amounts.protectedOutput.toString(),
    rmtFee: disabledRmtFeeCommitment(input.reason)
  };
}

export function assertRmtNetExecutionEconomics(economics: RmtNetExecutionEconomics) {
  const grossInput = atomic(economics.userGrossInputAtomic, "gross user input");
  const providerInput = atomic(economics.providerInputAtomic, "provider input");
  const grossExpected = atomic(economics.providerGrossExpectedOutputAtomic, "gross expected provider output");
  const protectedGross = atomic(economics.providerProtectedOutputAtomic, "protected provider output");
  const expectedNet = atomic(economics.expectedUserNetOutputAtomic, "expected user net output");
  const protectedNet = atomic(economics.protectedUserNetOutputAtomic, "protected user net output");
  invariant(protectedGross <= grossExpected && protectedNet <= expectedNet, "protected output exceeds expected output");
  assertRmtFeeCommitment(economics.rmtFee);
  if (economics.rmtFee.state === "disabled") {
    invariant(providerInput === grossInput && expectedNet === grossExpected && protectedNet === protectedGross, "disabled fee changed execution economics");
  } else if (economics.rmtFee.feeSide === "input") {
    const fee = BigInt(economics.rmtFee.expectedFeeAtomic);
    const requiredFee = BigInt(calculateRmtFeeFloor(grossInput.toString(), economics.rmtFee.feeBps));
    invariant(fee === requiredFee && BigInt(economics.rmtFee.maximumFeeAtomic) === requiredFee, "input-side fee does not match policy math");
    invariant(grossInput === providerInput + fee, "input-side gross input does not equal provider input plus fee");
    invariant(expectedNet === grossExpected && protectedNet === protectedGross, "input-side fee changed output economics");
  } else {
    const requiredFee = BigInt(calculateRmtFeeFloor(grossExpected.toString(), economics.rmtFee.feeBps));
    invariant(
      BigInt(economics.rmtFee.expectedFeeAtomic) === requiredFee
        && BigInt(economics.rmtFee.maximumFeeAtomic) === requiredFee,
      "output-side fee does not match policy math"
    );
    invariant(providerInput === grossInput, "output-side fee changed provider input");
    invariant(expectedNet + BigInt(economics.rmtFee.expectedFeeAtomic) === grossExpected, "output-side expected settlement does not balance");
    const protectedFee = BigInt(calculateRmtFeeFloor(protectedGross.toString(), economics.rmtFee.feeBps));
    invariant(protectedNet + protectedFee === protectedGross, "output-side protected settlement does not balance");
  }
  return true;
}
