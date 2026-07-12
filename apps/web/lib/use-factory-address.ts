"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { getFactoryAddress } from "./contracts";

export const FACTORY_UPDATED_EVENT = "rmt:factory-updated";

export function useFactoryAddress(): Address | null {
  const [address, setAddress] = useState<Address | null>(null);

  useEffect(() => {
    const refresh = () => setAddress(getFactoryAddress());
    refresh();
    window.addEventListener(FACTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(FACTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return address;
}
