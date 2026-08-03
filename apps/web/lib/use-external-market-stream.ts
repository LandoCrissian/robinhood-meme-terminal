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
    let source: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let fallbackTimer: number | undefined;
    let fallbackController: AbortController | undefined;
    let watchdogTimer: number | undefined;
    let lastSignature = "";
    let lastEventAt = Date.now();
    let reconnectAttempt = 0;
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
      fallbackTimer = window.setInterval(() => void fallbackLoad(), 6_000);
    };

    const markStreamHealthy = () => {
      lastEventAt = Date.now();
      reconnectAttempt = 0;
      stopFallback();
      if (active) setStatus("live");
    };

    const openStream = () => {
      if (!active || source || !navigator.onLine) return;
      const nextSource = new EventSource(`/api/markets/external-stream?${query}`);
      source = nextSource;
      nextSource.onopen = () => {
        if (!active || source !== nextSource) return;
        markStreamHealthy();
      };
      nextSource.addEventListener("snapshot", (message) => {
        if (!active || source !== nextSource || !(message instanceof MessageEvent)) return;
        try {
          if (accept(JSON.parse(message.data))) markStreamHealthy();
        } catch {
          startFallback();
          setStatus("fallback");
        }
      });
      nextSource.addEventListener("heartbeat", () => {
        if (active && source === nextSource) markStreamHealthy();
      });
      nextSource.addEventListener("upstream-delay", () => {
        if (!active || source !== nextSource) return;
        lastEventAt = Date.now();
        startFallback();
        setStatus("fallback");
      });
      nextSource.addEventListener("rotate", () => {
        if (!active || source !== nextSource) return;
        lastEventAt = Date.now();
        source = undefined;
        nextSource.close();
        window.setTimeout(openStream, 50);
      });
      nextSource.onerror = () => {
        if (!active || source !== nextSource) return;
        source = undefined;
        nextSource.close();
        startFallback();
        setStatus("reconnecting");
        if (reconnectTimer !== undefined) return;
        const delay = Math.min(8_000, 1_000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          openStream();
        }, delay);
      };
    };

    const recoverStream = () => {
      if (!active || !navigator.onLine) return;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      source?.close();
      source = undefined;
      setStatus("connecting");
      openStream();
    };

    const handleOffline = () => {
      source?.close();
      source = undefined;
      startFallback();
      setStatus("reconnecting");
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastEventAt > 12_000) {
        recoverStream();
      }
    };

    setPayload(undefined);
    setStatus("connecting");
    openStream();
    watchdogTimer = window.setInterval(() => {
      if (active && navigator.onLine && Date.now() - lastEventAt > 20_000) recoverStream();
    }, 5_000);
    window.addEventListener("online", recoverStream);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      source?.close();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (watchdogTimer !== undefined) window.clearInterval(watchdogTimer);
      stopFallback();
      window.removeEventListener("online", recoverStream);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [market?.address, market?.pairAddress]);

  return { payload, status };
}
