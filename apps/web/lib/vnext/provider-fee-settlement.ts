import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { VNextQuoteProvider } from "./quote-observation";
export { hasVNextWalletAuthorizationCodec } from "./provider-execution-capability";
import {
  assertRmtExecutionFeeV2EconomicsMatchesPolicy,
  type RmtExecutionFeeV2Economics,
  type RmtExecutionFeeV2Policy,
  type RmtExecutionFeeV2SettlementMode
} from "./execution-fee-policy-v2";
import { RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID } from "./uniswap-v3-fee-executor-v2";

export type VNextQuoteOnlyFeeSettlement = {
  state: "QUOTE_ONLY";
  requiredMode: RmtExecutionFeeV2SettlementMode;
  implementationId: null;
  walletCodecImplemented: boolean;
  currentSettlement: string;
  requiredImplementation: string;
};

export type VNextAdmittedFeeSettlement = {
  state: "V2_ATOMIC_INPUT_FEE";
  requiredMode: "v2-atomic-input-fee";
  implementationId: string;
  walletCodecImplemented: true;
  currentSettlement: string;
  requiredImplementation: string;
};

export type VNextProviderFeeSettlement = VNextQuoteOnlyFeeSettlement | VNextAdmittedFeeSettlement;

export const VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY: Readonly<Record<VNextQuoteProvider, VNextProviderFeeSettlement>> = Object.freeze({
  "uniswap-v2": Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: true,
    currentSettlement: "DIRECT_NO_RMT_FEE uses the official Uniswap V2 Router02; RMT fee settlement remains disabled.",
    requiredImplementation: "A separately audited Uniswap V2 atomic input-fee settlement path."
  }),
  "uniswap-v3": Object.freeze({
    state: "V2_ATOMIC_INPUT_FEE", requiredMode: "v2-atomic-input-fee", implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
    walletCodecImplemented: true,
    currentSettlement: "The deployed RMTUniswapV3FeeExecutorV2 is source-admitted behind exact server-only policy and executor gates.",
    requiredImplementation: "Exact deployed V2 runtime, immutable policy verification, and explicit Production activation."
  }),
  "uniswap-v4": Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: true,
    currentSettlement: "DIRECT_NO_RMT_FEE uses the official Universal Router; RMT fee settlement remains disabled.",
    requiredImplementation: "A separately audited Uniswap V4 atomic input-fee settlement path."
  }),
  "up-v2": Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: true,
    currentSettlement: "Direct UP V2 router authorization uses disabled RMT fee economics.",
    requiredImplementation: "UP V2 atomic input-fee settlement with exact router and calldata verification."
  }),
  "up-cl": Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: true,
    currentSettlement: "Direct UP CL router authorization uses disabled RMT fee economics.",
    requiredImplementation: "UP CL atomic input-fee settlement with exact Slipstream route verification."
  }),
  sushi: Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: false,
    currentSettlement: "Main is quote-only; draft PR #427 prepares direct RedSnwapper execution with disabled RMT fee economics.",
    requiredImplementation: "Sushi atomic input-fee executor wrapping the audited RedSnwapper route."
  }),
  uniswapx: Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: false,
    currentSettlement: "Verified quote/intent observation only; no wallet authorization or V2 atomic fee settlement.",
    requiredImplementation: "Provider-native or bounded order settlement proving the exact universal V2 fee."
  }),
  "zero-x-swap": Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: false,
    currentSettlement: "Indicative allowance-holder quote only; provider fees are not an RMT V2 commitment.",
    requiredImplementation: "Verified 0x settlement mode atomically binding the exact RMT V2 fee."
  }),
  "zero-x-gasless": Object.freeze({
    state: "QUOTE_ONLY", requiredMode: "v2-atomic-input-fee", implementationId: null,
    walletCodecImplemented: false,
    currentSettlement: "Indicative gasless quote only; gas sponsorship fees are not an RMT V2 commitment.",
    requiredImplementation: "Verified gasless settlement mode atomically binding the exact RMT V2 fee."
  })
});

export type VNextAtomicFeeSettlementProof = {
  verificationState: "verified_atomic";
  provider: VNextQuoteProvider;
  settlementMode: RmtExecutionFeeV2SettlementMode;
  implementationId: string;
  executionTarget: Address;
  providerTarget: Address;
  calldataHash: Hex;
  executionId: Hex;
  recipient: Address;
  deadline: string;
  atomicFeeSettlement: true;
  revertsAtomically: true;
};

export type VNextAtomicFeeAuthorizationBinding = VNextAtomicFeeSettlementProof & {
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
  executionOrigin: "authenticated_rmt";
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT V2 wallet fee admission rejected: ${message}.`);
}

function atomic(value: string) {
  return /^(0|[1-9][0-9]*)$/.test(value);
}

export function isVNextWalletFeeSettlementAdmitted(provider: VNextQuoteProvider) {
  return VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY[provider].state === "V2_ATOMIC_INPUT_FEE";
}

export function assertVNextAtomicFeeSettlementProof(
  proof: VNextAtomicFeeSettlementProof,
  provider: VNextQuoteProvider,
  capability: VNextAdmittedFeeSettlement
) {
  invariant(proof.verificationState === "verified_atomic" && proof.provider === provider, "provider proof identity changed");
  invariant(proof.settlementMode === capability.requiredMode, "settlement mode changed");
  invariant(proof.implementationId === capability.implementationId, "settlement implementation changed");
  invariant(isAddress(proof.executionTarget) && isAddress(proof.providerTarget), "execution or provider target is invalid");
  invariant(/^0x[0-9a-fA-F]{64}$/.test(proof.calldataHash), "calldata hash is invalid");
  invariant(/^0x[0-9a-fA-F]{64}$/.test(proof.executionId), "execution ID is invalid");
  invariant(isAddress(proof.recipient), "recipient is invalid");
  invariant(/^[1-9][0-9]*$/.test(proof.deadline), "deadline is invalid");
  invariant(proof.atomicFeeSettlement === true && proof.revertsAtomically === true, "fee and swap are not proven atomic");
  return true;
}

export function bindVNextAtomicFeeAuthorization(input: {
  economics: RmtExecutionFeeV2Economics;
  proof: VNextAtomicFeeSettlementProof;
}): VNextAtomicFeeAuthorizationBinding {
  return { ...input.proof, ...input.economics };
}

export function assertVNextAtomicFeeAuthorizationBinding(
  binding: VNextAtomicFeeAuthorizationBinding,
  economics: RmtExecutionFeeV2Economics,
  proof: VNextAtomicFeeSettlementProof
) {
  invariant(binding.provider === proof.provider && binding.executionId === proof.executionId, "authorization provider or execution ID changed");
  invariant(getAddress(binding.executionTarget) === getAddress(proof.executionTarget), "authorization execution target changed");
  invariant(getAddress(binding.providerTarget) === getAddress(proof.providerTarget), "authorization provider target changed");
  invariant(binding.calldataHash.toLowerCase() === proof.calldataHash.toLowerCase(), "authorization calldata hash changed");
  invariant(getAddress(binding.recipient) === getAddress(proof.recipient) && binding.deadline === proof.deadline, "authorization recipient or deadline changed");
  const economicsFields: (keyof RmtExecutionFeeV2Economics)[] = [
    "state", "inputAsset", "outputAsset", "userGrossInputAtomic", "feeBasisAtomic", "feeBps", "expectedFeeAtomic", "maximumFeeAtomic",
    "feeAsset", "feeSide", "providerInputAtomic", "providerGrossExpectedOutputAtomic", "providerProtectedOutputAtomic",
    "expectedUserNetOutputAtomic", "protectedUserNetOutputAtomic", "treasury", "policyId", "policyVersion",
    "policyHash", "roundingMode", "settlementMode", "executionOrigin"
  ];
  for (const field of economicsFields) {
    invariant(binding[field as keyof VNextAtomicFeeAuthorizationBinding] === economics[field], `authorization fee field ${field} changed`);
  }
  return true;
}

export function assertVNextWalletFeeAdmission(input: {
  provider: VNextQuoteProvider;
  policy: RmtExecutionFeeV2Policy | null;
  economics: RmtExecutionFeeV2Economics | null | undefined;
  verification: VNextAtomicFeeSettlementProof | null | undefined;
  authorization: VNextAtomicFeeAuthorizationBinding | null | undefined;
  capability?: VNextProviderFeeSettlement;
}) {
  const capability = input.capability ?? VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY[input.provider];
  invariant(capability.state === "V2_ATOMIC_INPUT_FEE", "provider has no admitted V2 atomic settlement mode");
  invariant(input.policy, "active V2 policy is missing");
  invariant(input.economics, "planned V2 fee commitment is missing");
  invariant(input.verification, "verified atomic fee settlement proof is missing");
  invariant(input.authorization, "wallet authorization fee binding is missing");
  assertRmtExecutionFeeV2EconomicsMatchesPolicy(input.economics, input.policy);
  assertVNextAtomicFeeSettlementProof(input.verification, input.provider, capability);
  assertVNextAtomicFeeAuthorizationBinding(input.authorization, input.economics, input.verification);
  invariant(input.economics.settlementMode === capability.requiredMode, "economics settlement mode changed");
  invariant(input.authorization.policyHash.toLowerCase() === input.policy.policyHash.toLowerCase(), "authorization policy hash changed");
  invariant(atomic(input.authorization.expectedFeeAtomic) && atomic(input.authorization.maximumFeeAtomic), "authorization fee amounts are malformed");
  return true;
}
