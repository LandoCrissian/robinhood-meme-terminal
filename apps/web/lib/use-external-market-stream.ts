"use client";

import { useEffect, useState } from "react";
import type { ExternalMarket } from "./external-market";
import {
  acceptExternalPoolTradesPayload,
  externalTradeSnapshotSignature,
  type ExternalMarketStreamStatus,
  type ExternalPoolTradesPayload
} from "./external-trades";

export type ExternalMarketStream = {
  payload?: ExternalPoolTradesPayload;
  status: ExternalMarketStreamStatus;
};

export function useExternalMarketStream(market?: ExternalMarket): ExternalMarketStream {
  const [payload, setPayload] = useState<ExternalPoolTradesPayload>();
  const [status, setStatus] = useState<ExternalMarketStreamStatus>("connecting");

  useEffect(() => {
    if (!market) return;
    let active = true;
    let fallbackTimer: number | undefined;
    let fallbackController: AbortController | undefined;
    let lastSignature = "";
    const query = new URLSearchParams({ token: market.address, pair: market.pairAddress });
    const accept = (value: unknown) => {
      const next = acceptExternalPoolTradesPayload(value, market.address, market.pairAddress);
      if (!next) return false;
      const signature = externalTradeSnapshotSignature(next);
      if (signature !== lastSignature) {
        lastSignature = signature;
        setPayload(next);
      }
      return true;
    };
    const stopFallback = () => {
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      fallbackTimer = undefined;
      fallbackController?.abort();
      fallbackController = undefined;
    };
    const fallbackLoad = async () => {
      fallbackController?.abort();
      const controller = new AbortController();
      fallbackController = controller;
      try {
        const response = await fetch(`/api/markets/external-trades?${query}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const next = await response.json() as unknown;
        if (!response.ok || !accept(next)) throw new Error("Fallback feed unavailable.");
        if (active) setStatus("fallback");
      } catch {
        if (active && !controller.signal.aborted) setStatus("reconnecting");
      }
    };
    const startFallback = () => {
      if (fallbackTimer !== undefined) return;
      void fallbackLoad();
      fallbackTimer = window.setInterval(() => void fallbackLoad(), 4_000);
    };

    setPayload(undefined);
    setStatus("connecting");
    const source = new EventSource(`/api/markets/external-stream?${query}`);
    source.onopen = () => {
      if (!active) return;
      stopFallback();
      setStatus("live");
    };
    source.addEventListener("snapshot", (message) => {
      if (!active || !(message instanceof MessageEvent)) return;
      try {
        if (accept(JSON.parse(message.data))) setStatus("live");
      } catch {
        setStatus("reconnecting");
      }
    });
    source.addEventListener("upstream-delay", () => {
      if (active) setStatus("reconnecting");
    });
    source.onerror = () => {
      if (!active) return;
      setStatus("reconnecting");
      startFallback();
    };

    return () => {
      active = false;
      source.close();
      stopFallback();
    };
  }, [market?.address, market?.pairAddress]);

  return { payload, status };
}
