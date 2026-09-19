"use client";

import { useEffect, useState } from "react";
import type { ExternalMarket } from "./external-market";
import {
  acceptExternalPoolTradesPayload,
  externalMarketTelemetryIdentity,
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
  const [status, setStatus] = useState<ExternalMarketStreamStatus>("unsupported");
  const telemetry = market ? externalMarketTelemetryIdentity(market) : null;
  const telemetryToken = telemetry?.token;
  const telemetryPair = telemetry?.pair;

  useEffect(() => {
    if (!telemetryToken || !telemetryPair) {
      setPayload(undefined);
      setStatus("unsupported");
      return;
    }
    let active = true;
    let source: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let fallbackTimer: number | undefined;
    let fallbackController: AbortController | undefined;
    let watchdogTimer: number | undefined;
    let lastSignature = "";
    let lastEventAt = Date.now();
    let reconnectAttempt = 0;
    const canRead = () => active && document.visibilityState === "visible" && navigator.onLine;
    const query = new URLSearchParams({ token: telemetryToken, pair: telemetryPair });
    const accept = (value: unknown) => {
      const next = acceptExternalPoolTradesPayload(value, telemetryToken, telemetryPair);
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
      if (!canRead() || fallbackController) return;
      const controller = new AbortController();
      fallbackController = controller;
      try {
        const response = await fetch(`/api/markets/external-trades?${query}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const next = await response.json() as unknown;
        if (!canRead() || controller.signal.aborted) return;
        if (!response.ok || !accept(next)) throw new Error("Fallback feed unavailable.");
        if (active) setStatus("fallback");
      } catch {
        if (canRead() && !controller.signal.aborted) setStatus("reconnecting");
      } finally {
        if (fallbackController === controller) fallbackController = undefined;
      }
    };
    const startFallback = () => {
      if (!canRead() || fallbackTimer !== undefined) return;
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
      if (!canRead() || source) return;
      const nextSource = new EventSource(`/api/markets/external-stream?${query}`);
      source = nextSource;
      nextSource.onopen = () => {
        if (!canRead() || source !== nextSource) return;
        markStreamHealthy();
      };
      nextSource.addEventListener("snapshot", (message) => {
        if (!canRead() || source !== nextSource || !(message instanceof MessageEvent)) return;
        try {
          if (accept(JSON.parse(message.data))) markStreamHealthy();
        } catch {
          startFallback();
          setStatus("fallback");
        }
      });
      nextSource.addEventListener("heartbeat", () => {
        if (canRead() && source === nextSource) markStreamHealthy();
      });
      nextSource.addEventListener("upstream-delay", () => {
        if (!canRead() || source !== nextSource) return;
        lastEventAt = Date.now();
        startFallback();
        setStatus("fallback");
      });
      nextSource.addEventListener("rotate", () => {
        if (!canRead() || source !== nextSource) return;
        lastEventAt = Date.now();
        source = undefined;
        nextSource.close();
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          openStream();
        }, 50);
      });
      nextSource.onerror = () => {
        if (!canRead() || source !== nextSource) return;
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

    const stopReads = () => {
      const previousSource = source;
      source = undefined;
      previousSource?.close();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      if (watchdogTimer !== undefined) window.clearInterval(watchdogTimer);
      watchdogTimer = undefined;
      stopFallback();
    };
    const recoverStream = () => {
      if (!canRead()) return;
      stopReads();
      lastEventAt = Date.now();
      setStatus("connecting");
      openStream();
      watchdogTimer = window.setInterval(() => {
        if (canRead() && Date.now() - lastEventAt > 20_000) recoverStream();
      }, 5_000);
    };
    const pauseReads = () => {
      stopReads();
      // Retain the last snapshot, but never label a paused feed as live.
      if (active) setStatus("reconnecting");
    };
    const resumeReads = () => {
      if (canRead() && !source && reconnectTimer === undefined) recoverStream();
    };
    const handleVisibility = () => {
      if (!canRead()) pauseReads();
      else resumeReads();
    };

    setPayload(undefined);
    handleVisibility();
    window.addEventListener("online", resumeReads);
    window.addEventListener("offline", pauseReads);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      stopReads();
      window.removeEventListener("online", resumeReads);
      window.removeEventListener("offline", pauseReads);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [telemetryPair, telemetryToken]);

  return { payload, status };
}
