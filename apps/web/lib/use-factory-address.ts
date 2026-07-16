"use client";

import { useEffect, useState } from "react";
import { getAddress, isAddress, keccak256, toHex, type Address } from "viem";
import { useReadContract } from "wagmi";
import {
  getFactoryAddress,
  isFreshMainnetVersionRegistryConfigured,
  isMainnetVersionRegistryConfigurationValid,
  publicMainnetV6FactoryAddress,
  publicMainnetVersionRegistryAddress,
  versionRegistryAbi
} from "./contracts";
import {
  activeChain,
  isFactoryStartBlockConfigurationValid,
  isFactoryStartBlockExplicitlyConfigured,
  isMainnetRelease
} from "./network";

export const FACTORY_UPDATED_EVENT = "rmt:factory-updated";
const V6_VERSION = keccak256(toHex("RMT_FACTORY_V6"));

export function useFactoryAddress(): Address | null {
  const [testnetAddress, setTestnetAddress] = useState<Address | null>(null);
  const registryFactoryRead = useReadContract({
    address: publicMainnetVersionRegistryAddress,
    abi: versionRegistryAbi,
    functionName: "activeFactory",
    chainId: activeChain.id,
    query: {
      enabled: isMainnetRelease
        && isFreshMainnetVersionRegistryConfigured
        && isMainnetVersionRegistryConfigurationValid,
      retry: false,
      refetchInterval: 30_000
    }
  });
  const registryVersionRead = useReadContract({
    address: publicMainnetVersionRegistryAddress,
    abi: versionRegistryAbi,
    functionName: "activeVersion",
    chainId: activeChain.id,
    query: {
      enabled: isMainnetRelease
        && isFreshMainnetVersionRegistryConfigured
        && isMainnetVersionRegistryConfigurationValid,
      retry: false,
      refetchInterval: 30_000
    }
  });

  useEffect(() => {
    if (isMainnetRelease) return;
    const refresh = () => setTestnetAddress(getFactoryAddress());
    refresh();
    window.addEventListener(FACTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(FACTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (isMainnetRelease) {
    if (!isFreshMainnetVersionRegistryConfigured || !isMainnetVersionRegistryConfigurationValid) return null;
    const registered = registryFactoryRead.data;
    const registeredVersion = registryVersionRead.data;
    if (!registered || !isAddress(registered) || !registeredVersion) return null;
    const address = getAddress(registered);
    if (
      registeredVersion === V6_VERSION
        && address === publicMainnetV6FactoryAddress
        && isFreshMainnetVersionRegistryConfigured
        && isFactoryStartBlockExplicitlyConfigured
        && isFactoryStartBlockConfigurationValid
    ) return address;
    return null;
  }

  return testnetAddress;
}
