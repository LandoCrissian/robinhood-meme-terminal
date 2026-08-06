"use client";

import { useEffect, useRef, useState } from "react";

function deadlineSeconds(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch {
    return null;
  }
}

export function useTradeQuoteFreshness({
  deadline,
  bufferSeconds,
  enabled = true,
  onRefreshNeeded
}: {
  deadline: string | undefined;
  bufferSeconds: number;
  enabled?: boolean;
  onRefreshNeeded?: () => void;
}) {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1_000));
  const refreshCallback = useRef(onRefreshNeeded);
  const refreshRequestedFor = useRef<string | undefined>(undefined);
  refreshCallback.current = onRefreshNeeded;

  useEffect(() => {
    const interval = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1_000)), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    refreshRequestedFor.current = undefined;
  }, [deadline]);

  const expiresAt = deadlineSeconds(deadline);
  const remainingSeconds = expiresAt === null ? 0 : Math.max(0, expiresAt - nowSeconds);
  const isFresh = Boolean(enabled && expiresAt !== null && remainingSeconds > Math.max(0, bufferSeconds));

  useEffect(() => {
    if (
      !enabled
      || !deadline
      || expiresAt === null
      || remainingSeconds > Math.max(0, bufferSeconds)
      || refreshRequestedFor.current === deadline
    ) return;
    refreshRequestedFor.current = deadline;
    refreshCallback.current?.();
  }, [bufferSeconds, deadline, enabled, expiresAt, remainingSeconds]);

  return {
    expiresAt,
    nowSeconds,
    remainingSeconds,
    isFresh
  };
}