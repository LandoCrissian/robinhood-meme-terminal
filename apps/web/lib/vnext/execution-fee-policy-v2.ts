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

export const RMT_EXECUTION_V2_DESCRIPTOR = Object.freeze({
  policyId: "RMT_EXECUTION_V2" as const,
  version: 2 as const,
  chainId: 4_663 as const,
  feeBps: 25 as const,
  feeBasis: "user_gross_input" as const,
  feeSide: "input" as const,
  roundingMode: "floor" as const,
  eligibleExecutionOrigin: "authenticated_rmt" as const,
  allowedSettlementModes: Object.freeze(["v2-atomic-input-fee"] as const)
});

export const RMT_EXECUTION_V2_BPS_DENOMINATOR = 10_000n;
const POLICY_HASH_DOMAIN = "RMT_EXECUTION_FEE_POLICY_V2";
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const ASSET_ID = /^eip155:4663\/(?:native|contract:0x[0-9a-f]{40})$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UNIVERSAL_ROUTER_SENTINELS = new Set([
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002"
]);

export type RmtExecutionFeeV2SettlementMode = "v2-atomic-input-fee";

export type RmtExecutionFeeV2Policy = {
  policyId: "RMT_EXECUTION_V2";
  version: 2;
  chainId: 4_663;
  feeBps: 25;
  treasury: Address;
  effectiveBoundary: {
    fromBlock: string;
    beforeBlock: string | null;
  };
  feeBasis: "user_gross_input";
  feeSide: "input";
  roundingMode: "floor";
  eligibleExecutionOrigin: "authenticated_rmt";
  allowedSettlementModes: readonly ["v2-atomic-input-fee"];
  policyHash: Hex;
};

export type RmtExecutionFeeV2Economics = {
  state: "planned";
  inputAsset: string;
  outputAsset: string;
  userGrossInputAtomic: string;
  feeBasisAtomic: string;
  feeBps: 25;
  expectedFeeAtomic: string;
  maximumFeeAtomic: string;
  feeAsset: string;
  feeSide: "input";
  providerInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  providerProtectedOutputAtomic: string;
  expectedUserNetOutputAtomic: string;
  protectedUserNetOutputAtomic: string;
  treasury: Address;
  policyId: "RMT_EXECUTION_V2";
  policyVersion: 2;
  policyHash: Hex;
  roundingMode: "floor";
  settlementMode: RmtExecutionFeeV2SettlementMode;
  executionOrigin: "authenticated_rmt";
};

type CreatePolicyInput = {
  treasury: string;
  fromBlock: string;
  beforeBlock?: string | null;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid RMT execution fee V2 policy: ${message}.`);
}

function atomic(value: string, label: string, allowZero = false) {
  invariant(ATOMIC.test(value), `${label} must be a canonical atomic-unit string`);
  const amount = BigInt(value);
  invariant(allowZero || amount > 0n, `${label} must be positive`);
  return amount;
}

function assetId(value: string, label: string) {
  const normalized = value.toLowerCase();
  invariant(ASSET_ID.test(normalized), `${label} must be a Robinhood Chain asset identity`);
  return normalized;
}

function treasuryAddress(value: string) {
  invariant(isAddress(value, { strict: false }), "treasury must be a valid EVM address");
  const treasury = getAddress(value);
  invariant(treasury !== zeroAddress, "treasury cannot be the zero address");
  invariant(!UNIVERSAL_ROUTER_SENTINELS.has(treasury.toLowerCase()), "treasury cannot use a Universal Router sentinel address");
  return treasury;
}

function checkedPolicyFields(input: CreatePolicyInput) {
  const treasury = treasuryAddress(input.treasury);
  const fromBlock = atomic(input.fromBlock, "effective start block");
  const beforeBlock = input.beforeBlock == null ? null : atomic(input.beforeBlock, "effective end block");
  invariant(beforeBlock === null || beforeBlock > fromBlock, "effective end must follow the start block");
  return {
    ...RMT_EXECUTION_V2_DESCRIPTOR,
    treasury,
    effectiveBoundary: {
      fromBlock: fromBlock.toString(),
      beforeBlock: beforeBlock?.toString() ?? null
    }
  };
}

function policyHashFor(fields: ReturnType<typeof checkedPolicyFields>) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("string domain, string policyId, uint256 version, uint256 chainId, uint256 feeBps, address treasury, uint256 fromBlock, uint256 beforeBlock, string feeBasis, string feeSide, string roundingMode, string executionOrigin, string[] settlementModes"),
    [
      POLICY_HASH_DOMAIN,
      fields.policyId,
      BigInt(fields.version),
      BigInt(fields.chainId),
      BigInt(fields.feeBps),
      fields.treasury,
      BigInt(fields.effectiveBoundary.fromBlock),
      fields.effectiveBoundary.beforeBlock === null ? 0n : BigInt(fields.effectiveBoundary.beforeBlock),
      fields.feeBasis,
      fields.feeSide,
      fields.roundingMode,
      fields.eligibleExecutionOrigin,
      [...fields.allowedSettlementModes]
    ]
  ));
}

export function createRmtExecutionFeeV2Policy(input: CreatePolicyInput): RmtExecutionFeeV2Policy {
  const fields = checkedPolicyFields(input);
  return Object.freeze({ ...fields, policyHash: policyHashFor(fields) });
}

export function assertRmtExecutionFeeV2Policy(policy: RmtExecutionFeeV2Policy) {
  invariant(policy.policyId === "RMT_EXECUTION_V2", "policy ID changed");
  invariant(policy.version === 2, "policy version changed");
  invariant(policy.chainId === 4_663, "policy chain changed");
  invariant(policy.feeBps === 25, "fee rate changed from exactly 25 basis points");
  invariant(policy.feeBasis === "user_gross_input" && policy.feeSide === "input", "fee basis changed");
  invariant(policy.roundingMode === "floor", "rounding mode changed");
  invariant(policy.eligibleExecutionOrigin === "authenticated_rmt", "execution origin changed");
  invariant(policy.allowedSettlementModes.length === 1 && policy.allowedSettlementModes[0] === "v2-atomic-input-fee", "settlement modes changed");
  invariant(HASH.test(policy.policyHash), "policy hash is invalid");
  const checked = checkedPolicyFields({
    treasury: policy.treasury,
    fromBlock: policy.effectiveBoundary.fromBlock,
    beforeBlock: policy.effectiveBoundary.beforeBlock
  });
  invariant(policy.policyHash.toLowerCase() === policyHashFor(checked).toLowerCase(), "policy hash does not bind the exact V2 fields");
  return true;
}

export function configuredRmtExecutionFeeV2Policy(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  invariant(enabled === "true", "policy gate must be exact lowercase true or false");
  invariant(Boolean(env.RMT_VNEXT_EXECUTION_V2_TREASURY), "treasury is not configured");
  invariant(Boolean(env.RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK), "effective block is not configured");
  invariant(Boolean(env.RMT_VNEXT_EXECUTION_V2_POLICY_HASH), "policy hash is not configured");
  const policy = createRmtExecutionFeeV2Policy({
    treasury: env.RMT_VNEXT_EXECUTION_V2_TREASURY!,
    fromBlock: env.RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK!
  });
  invariant(env.RMT_VNEXT_EXECUTION_V2_POLICY_HASH!.toLowerCase() === policy.policyHash.toLowerCase(), "configured policy hash changed");
  return policy;
}

export function calculateRmtExecutionFeeV2Floor(userGrossInputAtomic: string) {
  const gross = atomic(userGrossInputAtomic, "gross user input");
  return (gross * 25n / RMT_EXECUTION_V2_BPS_DENOMINATOR).toString();
}

export function normalizeRmtExecutionFeeV2Input(input: {
  policy: RmtExecutionFeeV2Policy;
  inputAssetId: string;
  outputAssetId: string;
  userGrossInputAtomic: string;
  providerGrossExpectedOutputAtomic: string;
  providerProtectedOutputAtomic: string;
  settlementMode: RmtExecutionFeeV2SettlementMode;
}): RmtExecutionFeeV2Economics {
  assertRmtExecutionFeeV2Policy(input.policy);
  const inputAsset = assetId(input.inputAssetId, "input asset");
  const outputAsset = assetId(input.outputAssetId, "output asset");
  invariant(inputAsset !== outputAsset, "trade assets must differ");
  invariant(input.policy.allowedSettlementModes.includes(input.settlementMode), "settlement mode is not admitted by the policy");
  const grossInput = atomic(input.userGrossInputAtomic, "gross user input");
  const expectedOutput = atomic(input.providerGrossExpectedOutputAtomic, "provider gross expected output");
  const protectedOutput = atomic(input.providerProtectedOutputAtomic, "provider protected output");
  invariant(protectedOutput <= expectedOutput, "provider protected output exceeds expected output");
  const fee = BigInt(calculateRmtExecutionFeeV2Floor(grossInput.toString()));
  const providerInput = grossInput - fee;
  invariant(providerInput > 0n, "fee leaves no provider input");
  const economics: RmtExecutionFeeV2Economics = {
    state: "planned",
    inputAsset,
    outputAsset,
    userGrossInputAtomic: grossInput.toString(),
    feeBasisAtomic: grossInput.toString(),
    feeBps: 25,
    expectedFeeAtomic: fee.toString(),
    maximumFeeAtomic: fee.toString(),
    feeAsset: inputAsset,
    feeSide: "input",
    providerInputAtomic: providerInput.toString(),
    providerGrossExpectedOutputAtomic: expectedOutput.toString(),
    providerProtectedOutputAtomic: protectedOutput.toString(),
    expectedUserNetOutputAtomic: expectedOutput.toString(),
    protectedUserNetOutputAtomic: protectedOutput.toString(),
    treasury: input.policy.treasury,
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
    policyHash: input.policy.policyHash,
    roundingMode: "floor",
    settlementMode: input.settlementMode,
    executionOrigin: "authenticated_rmt"
  };
  assertRmtExecutionFeeV2Economics(economics);
  return economics;
}

export function assertRmtExecutionFeeV2Economics(economics: RmtExecutionFeeV2Economics) {
  const grossInput = atomic(economics.userGrossInputAtomic, "gross user input");
  const inputAsset = assetId(economics.inputAsset, "input asset");
  const outputAsset = assetId(economics.outputAsset, "output asset");
  const feeBasis = atomic(economics.feeBasisAtomic, "fee basis");
  const expectedFee = atomic(economics.expectedFeeAtomic, "expected fee", true);
  const maximumFee = atomic(economics.maximumFeeAtomic, "maximum fee", true);
  const providerInput = atomic(economics.providerInputAtomic, "provider input");
  const providerExpected = atomic(economics.providerGrossExpectedOutputAtomic, "provider gross expected output");
  const providerProtected = atomic(economics.providerProtectedOutputAtomic, "provider protected output");
  const userExpected = atomic(economics.expectedUserNetOutputAtomic, "expected user net output");
  const userProtected = atomic(economics.protectedUserNetOutputAtomic, "protected user net output");
  invariant(economics.state === "planned", "economics are not planned");
  invariant(economics.policyId === "RMT_EXECUTION_V2" && economics.policyVersion === 2, "policy identity changed");
  invariant(HASH.test(economics.policyHash), "policy hash is invalid");
  invariant(economics.feeBps === 25, "fee rate changed from exactly 25 basis points");
  invariant(economics.feeSide === "input" && economics.roundingMode === "floor", "fee side or rounding changed");
  invariant(economics.executionOrigin === "authenticated_rmt", "execution origin changed");
  invariant(economics.settlementMode === "v2-atomic-input-fee", "settlement mode changed");
  invariant(inputAsset !== outputAsset, "trade assets must differ");
  invariant(assetId(economics.feeAsset, "fee asset") === inputAsset, "fee asset must equal the exact input asset");
  treasuryAddress(economics.treasury);
  invariant(feeBasis === grossInput, "fee basis must equal gross user input");
  invariant(expectedFee === BigInt(calculateRmtExecutionFeeV2Floor(grossInput.toString())), "expected fee changed from floor math");
  invariant(maximumFee === expectedFee, "maximum fee changed from the exact input-side fee");
  invariant(providerInput + expectedFee === grossInput && providerInput > 0n, "provider input does not equal gross input minus fee");
  invariant(providerProtected <= providerExpected, "provider protected output exceeds expected output");
  invariant(userExpected === providerExpected && userProtected === providerProtected, "user post-fee output changed from provider output for an input-side fee");
  return true;
}

export function assertRmtExecutionFeeV2EconomicsMatchesPolicy(
  economics: RmtExecutionFeeV2Economics,
  policy: RmtExecutionFeeV2Policy
) {
  assertRmtExecutionFeeV2Policy(policy);
  assertRmtExecutionFeeV2Economics(economics);
  invariant(
    economics.policyId === policy.policyId
      && economics.policyVersion === policy.version
      && economics.policyHash.toLowerCase() === policy.policyHash.toLowerCase()
      && economics.feeBps === policy.feeBps
      && getAddress(economics.treasury) === policy.treasury
      && policy.allowedSettlementModes.includes(economics.settlementMode),
    "economics do not match the exact active V2 policy"
  );
  return true;
}

export function settledRmtExecutionFeeV2(input: {
  receiptStatus: "success" | "reverted" | "failed" | "not_submitted";
  atomicSettlementVerified: boolean;
  expectedFeeAtomic: string;
}) {
  const expectedFee = atomic(input.expectedFeeAtomic, "expected fee", true);
  if (input.receiptStatus !== "success") return "0";
  invariant(input.atomicSettlementVerified, "successful receipt lacks verified atomic fee settlement");
  return expectedFee.toString();
}

export function plannedRmtExecutionFeeV2ForWalletAction(
  kind: "erc20_approval" | "swap",
  economics: RmtExecutionFeeV2Economics
) {
  assertRmtExecutionFeeV2Economics(economics);
  return kind === "swap" ? economics.expectedFeeAtomic : "0";
}
