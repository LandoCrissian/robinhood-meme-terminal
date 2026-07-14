import type { Address, Hex } from "viem";

/** Stable website model for active-factory launch capabilities. */
export type LaunchPolicyCapability = {
  policyId: Hex;
  policyVersion: number;
  enabled: boolean;
  publiclySelectable: boolean;
  curveFeeBps: number;
  creatorFeeShareBps: number;
  protocolFeeShareBps: number;
  postGraduationFeeBps: number;
  graduationTarget: bigint;
  fairStartMode: number;
  fairStartDelayBlocks: bigint;
  fairStartDurationBlocks: bigint;
  fairStartMaxTxBps: number;
  fairStartMaxWalletBps: number;
};

export type ActiveLaunchCapabilities = {
  factory: Address;
  protocolVersion: number;
  launchesPaused: boolean;
  defaultPolicyId: Hex;
  policies: readonly LaunchPolicyCapability[];
};

export function publicLaunchPolicies(capabilities: ActiveLaunchCapabilities) {
  return capabilities.policies.filter((policy) => policy.enabled && policy.publiclySelectable);
}

export function canSubmitLaunch(capabilities: ActiveLaunchCapabilities | null) {
  if (!capabilities || capabilities.launchesPaused) return false;
  return publicLaunchPolicies(capabilities).some(
    (policy) => policy.policyId.toLowerCase() === capabilities.defaultPolicyId.toLowerCase()
  );
}

export function hasFairStart(policy: LaunchPolicyCapability) {
  return policy.fairStartMode === 1;
}

export function fairStartDisclosure(policy: LaunchPolicyCapability) {
  if (!hasFairStart(policy)) return "Open trading begins without temporary wallet limits.";
  return `Fair Start lasts ${policy.fairStartDurationBlocks.toString()} blocks with a ${formatBasisPoints(policy.fairStartMaxTxBps)} max buy and ${formatBasisPoints(policy.fairStartMaxWalletBps)} max wallet.`;
}

export function formatBasisPoints(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, "0")}%`;
}
