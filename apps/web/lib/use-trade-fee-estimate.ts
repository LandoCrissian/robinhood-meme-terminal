"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";
import { estimatedNetworkFeeWei } from "./trade-ticket";

export type TradeFeeEstimateState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  gas?: bigint;
  gasPrice?: bigint;
  feeWei?: bigint;
  ethUsd?: number;
};

export function useTradeFeeEstimate({
  account,
  to,
  data,
  value = 0n,
  enabled
}: {
  account: Address | undefined;
  to: Address | undefined;
  data: Hex | undefined;
  value?: bigint;
  enabled: boolean;
}) {
  const client = usePublicClient({ chainId: 4663 });
  const [state, setState] = useState<TradeFeeEstimateState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !client || !account || !to || !data) {
      setState({ status: "idle" });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    void Promise.all([
      client.estimateGas({ account, to, data, value }),
      client.getGasPrice(),
      fetch("/api/prices/eth", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) return undefined;
          const payload = await response.json() as { usd?: unknown };
          return typeof payload.usd === "number" && Number.isFinite(payload.usd) && payload.usd > 0
            ? payload.usd
            : undefined;
        })
        .catch(() => undefined)
    ]).then(([gas, gasPrice, ethUsd]) => {
      if (!active) return;
      const feeWei = estimatedNetworkFeeWei(gas, gasPrice);
      setState(feeWei > 0n
        ? { status: "ready", gas, gasPrice, feeWei, ethUsd }
        : { status: "unavailable" });
    }).catch(() => {
      if (active) setState({ status: "unavailable" });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [account, client, data, enabled, to, value]);

  return state;
}
