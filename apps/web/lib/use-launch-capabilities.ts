"use client";

import { keccak256, toHex, type Address, type Hex } from "viem";
import { useReadContract } from "wagmi";
import { rmtLaunchFactoryV6Abi } from "./contracts";
import { activeChain } from "./network";
import type { ActiveLaunchCapabilities, LaunchPolicyCapability } from "./launch-capabilities";

export const SIMPLE_FAIR_V1_POLICY_ID = keccak256(toHex("RMT_SIMPLE_FAIR_V1"));
export const SIMPLE_OPEN_V1_POLICY_ID = keccak256(toHex("RMT_SIMPLE_OPEN_V1"));

type PolicyResult = {
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

function policyCapability(value: PolicyResult): LaunchPolicyCapability {
  return {
    policyId: value.policyId,
    policyVersion: Number(value.policyVersion),
    enabled: value.enabled,
    publiclySelectable: value.publiclySelectable,
    curveFeeBps: Number(value.curveFeeBps),
    creatorFeeShareBps: Number(value.creatorFeeShareBps),
    protocolFeeShareBps: Number(value.protocolFeeShareBps),
    postGraduationFeeBps: Number(value.postGraduationFeeBps),
    graduationTarget: value.graduationTarget,
    fairStartMode: Number(value.fairStartMode),
    fairStartDelayBlocks: value.fairStartDelayBlocks,
    fairStartDurationBlocks: value.fairStartDurationBlocks,
    fairStartMaxTxBps: Number(value.fairStartMaxTxBps),
    fairStartMaxWalletBps: Number(value.fairStartMaxWalletBps)
  };
}

export function useLaunchCapabilities(factory: Address | null) {
  const base = { address: factory ?? undefined, abi: rmtLaunchFactoryV6Abi, chainId: activeChain.id } as const;
  const enabled = Boolean(factory);
  const protocol = useReadContract({ ...base, functionName: "protocolVersion", query: { enabled, retry: false, refetchInterval: 30_000 } });
  const isV6 = protocol.data === 6;
  const paused = useReadContract({ ...base, functionName: "launchesPaused", query: { enabled: isV6, retry: false, refetchInterval: 15_000 } });
  const defaultPolicy = useReadContract({ ...base, functionName: "defaultPolicyId", query: { enabled: isV6, retry: false, refetchInterval: 30_000 } });
  const fairPolicy = useReadContract({ ...base, functionName: "getPolicy", args: [SIMPLE_FAIR_V1_POLICY_ID], query: { enabled: isV6, retry: false, refetchInterval: 30_000 } });
  const openPolicy = useReadContract({ ...base, functionName: "getPolicy", args: [SIMPLE_OPEN_V1_POLICY_ID], query: { enabled: isV6, retry: false, refetchInterval: 30_000 } });

  const loading = Boolean(factory) && (protocol.isLoading || (isV6 && (
    paused.isLoading || defaultPolicy.isLoading || fairPolicy.isLoading || openPolicy.isLoading
  )));
  const failed = Boolean(factory) && (
    protocol.isError || (!protocol.isLoading && !isV6) || paused.isError || defaultPolicy.isError
      || fairPolicy.isError || openPolicy.isError
  );
  let capabilities: ActiveLaunchCapabilities | null = null;
  if (
    factory && !failed && paused.data !== undefined && defaultPolicy.data
      && fairPolicy.data && openPolicy.data
  ) {
    capabilities = {
      factory,
      protocolVersion: 6,
      launchesPaused: paused.data,
      defaultPolicyId: defaultPolicy.data,
      policies: [
        policyCapability(fairPolicy.data as unknown as PolicyResult),
        policyCapability(openPolicy.data as unknown as PolicyResult)
      ]
    };
  }

  return {
    capabilities,
    loading,
    error: !factory
      ? "The active launch factory is unavailable."
      : failed
        ? "The active V6 launch configuration could not be verified onchain."
        : null
  };
}
