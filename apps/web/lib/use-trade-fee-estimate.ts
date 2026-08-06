"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { usePublicClient } from "wagmi";
import { recordExperienceStage } from "./experience-funnel";
import {
  classifyTradeExecutionError,
  type TradeExecutionFailure
} from "./trade-execution-reliability";
import { estimatedNetworkFeeWei } from "./trade-ticket";

export type TradeFeeEstimateState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  gas?: bigint;
  gasPrice?: bigint;
  feeWei?: bigint;
  ethUsd?: number;
  attempts?: number;
  failure?: TradeExecutionFailure;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

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
    setState({ status: "loading", attempts: 0 });

    const loadEthUsd = fetch("/api/prices/eth", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return undefined;
        const payload = await response.json() as { usd?: unknown };
        return typeof payload.usd === "number" && Number.isFinite(payload.usd) && payload.usd > 0
          ? payload.usd
          : undefined;
      })
      .catch(() => undefined);

    const estimate = async () => {
      let finalFailure: TradeExecutionFailure | undefined;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const [gas, gasPrice, ethUsd] = await Promise.all([
            client.estimateGas({ account, to, data, value }),
            client.getGasPrice(),
            loadEthUsd
          ]);
          const feeWei = estimatedNetworkFeeWei(gas, gasPrice);
          if (!active) return;
          if (feeWei > 0n) {
            setState({ status: "ready", gas, gasPrice, feeWei, ethUsd, attempts: attempt });
            recordExperienceStage("preflight_ready");
            return;
          }
          finalFailure = classifyTradeExecutionError("Exact transaction simulation returned no usable network fee.");
          break;
        } catch (cause) {
          finalFailure = classifyTradeExecutionError(cause);
          if (finalFailure.code !== "network" || attempt === 2) break;
          await wait(180 * attempt);
        }
      }
      if (!active) return;
      setState({
        status: "unavailable",
        attempts: finalFailure?.code === "network" ? 2 : 1,
        failure: finalFailure ?? classifyTradeExecutionError("Trade preflight unavailable.")
      });
      recordExperienceStage("preflight_failed");
    };

    void estimate();
    return () => {
      active = false;
      controller.abort();
    };
  }, [account, client, data, enabled, to, value]);

  return state;
}
