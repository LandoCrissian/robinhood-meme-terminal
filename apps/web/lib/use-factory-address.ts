"use client";

import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useReadContract } from "wagmi";
import {
  getFactoryAddress,
  publicMainnetVersionRegistryAddress,
  versionRegistryAbi
} from "./contracts";
import { activeChain, isMainnetRelease } from "./network";

export const FACTORY_UPDATED_EVENT = "rmt:factory-updated";

export function useFactoryAddress(): Address | null {
  const [testnetAddress, setTestnetAddress] = useState<Address | null>(null);
  const registryRead = useReadContract({
    address: publicMainnetVersionRegistryAddress,
    abi: versionRegistryAbi,
    functionName: "activeFactory",
    chainId: activeChain.id,
    query: { enabled: isMainnetRelease, retry: false, refetchInterval: 30_000 }
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
    const registered = registryRead.data;
    return registered && isAddress(registered) ? getAddress(registered) : null;
  }

  return testnetAddress;
}
