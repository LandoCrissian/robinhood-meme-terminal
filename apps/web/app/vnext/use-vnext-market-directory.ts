"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import type { ExternalMarketResponse } from "../../lib/external-market";
import {
  normalizeDirectoryMarkets,
  resolutionFromLookup,
  verifiedDirectoryAsset,
  type VNextDirectoryMarket,
  type VNextDirectoryResponse
} from "../../lib/vnext/market-directory";
import { ROBINHOOD_RMT_ADDRESS } from "../../lib/vnext/robinhood-assets";

export type DirectoryStatus = "loading" | "ready" | "stale" | "error";
export type IdentityStatus = "idle" | "checking" | "verified" | "unverified";

export function useVNextMarketDirectory() {
  const [markets, setMarkets] = useState<VNextDirectoryMarket[]>([]);
  const [status, setStatus] = useState<DirectoryStatus>("loading");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetMetadata>();
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>("idle");
  const hasData = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/vnext/market-directory", { cache: "no-store" });
      const payload = await response.json() as VNextDirectoryResponse;
      const nextMarkets = normalizeDirectoryMarkets(payload);
      if (!response.ok || nextMarkets.length === 0) throw new Error(payload.error ?? "Market directory unavailable.");
      setMarkets(nextMarkets);
      setSelectedAddress((current) => current && nextMarkets.some((market) => market.address.toLowerCase() === current.toLowerCase())
        ? current
        : nextMarkets.find((market) => market.address === ROBINHOOD_RMT_ADDRESS)?.address ?? nextMarkets[0].address);
      hasData.current = true;
      setStatus(payload.stale ? "stale" : "ready");
    } catch {
      setStatus(hasData.current ? "stale" : "error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const selected = useMemo(
    () => markets.find((market) => market.address.toLowerCase() === selectedAddress?.toLowerCase()),
    [markets, selectedAddress]
  );

  useEffect(() => {
    if (!selected) {
      setSelectedAsset(undefined);
      setIdentityStatus("idle");
      return;
    }
    const known = verifiedDirectoryAsset(selected);
    if (known) {
      setSelectedAsset(known);
      setIdentityStatus("verified");
      return;
    }
    const controller = new AbortController();
    setSelectedAsset(undefined);
    setIdentityStatus("checking");
    const query = new URLSearchParams({ address: selected.address });
    void fetch(`/api/vnext/asset-identity?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ExternalMarketResponse;
        if (!response.ok) throw new Error(payload.error ?? "Identity lookup unavailable.");
        const asset = verifiedDirectoryAsset(selected, resolutionFromLookup(payload, selected.address));
        if (controller.signal.aborted) return;
        setSelectedAsset(asset ?? undefined);
        setIdentityStatus(asset ? "verified" : "unverified");
      })
      .catch(() => {
        if (!controller.signal.aborted) setIdentityStatus("unverified");
      });
    return () => controller.abort();
  }, [selected]);

  return { markets, status, selected, selectedAsset, identityStatus, selectedAddress, setSelectedAddress, refresh };
}
