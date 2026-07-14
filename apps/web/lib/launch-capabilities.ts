import type { Address, Hex } from "viem";

/**
 * Stable website model for active-factory launch capabilities.
 *
 * The UI must render from factory-reported policy data instead of probing for
 * incidental ABI methods such as `launchCommunity`. This keeps V6 compatible
 * with future V7+ launch policies without another launch-form rewrite.
 */
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

export function formatBasisPoints(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, "0")}%`;
}
