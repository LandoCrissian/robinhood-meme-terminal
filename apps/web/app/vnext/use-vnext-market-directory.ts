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

const IDENTITY_LOOKUP_TIMEOUT_MS = 5_000;

export type DirectoryStatus = "loading" | "ready" | "stale" | "error";
export type IdentityStatus = "idle" | "checking" | "verified" | "unverified";

function directorySnapshot(markets: VNextDirectoryMarket[]) {
  return JSON.stringify(markets.map((market) => [
    market.address,
    market.name,
    market.symbol,
    market.priceUsd,
    market.liquidityUsd,
    market.marketCapUsd,
    market.volume24h,
    market.priceChange24h,
    market.ageMinutes,
    market.signal,
    market.pairAddress,
    market.dexId,
    market.url,
    market.resolution?.token.address,
    market.resolution?.token.name,
    market.resolution?.token.symbol,
    market.resolution?.token.decimals
  ]));
}

function sameAsset(left: AssetMetadata | null | undefined, right: AssetMetadata) {
  return Boolean(
    left
    && left.id.chain.namespace === right.id.chain.namespace
    && left.id.chain.reference === right.id.chain.reference
    && left.id.locator.kind === "contract"
    && right.id.locator.kind === "contract"
    && left.id.locator.address.toLowerCase() === right.id.locator.address.toLowerCase()
    && left.symbol === right.symbol
    && left.name === right.name
    && left.decimals === right.decimals
    && left.metadataState === right.metadataState
  );
}

export function useVNextMarketDirectory() {
  const [markets, setMarkets] = useState<VNextDirectoryMarket[]>([]);
  const [status, setStatus] = useState<DirectoryStatus>("loading");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetMetadata>();
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>("idle");
  const hasData = useRef(false);
  const marketSnapshot = useRef("");
  const identityCache = useRef(new Map<string, AssetMetadata | null>());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/vnext/market-directory", { cache: "no-store" });
      const payload = await response.json() as VNextDirectoryResponse;
      const nextMarkets = normalizeDirectoryMarkets(payload);
      if (!response.ok || nextMarkets.length === 0) throw new Error(payload.error ?? "Market directory unavailable.");
      const nextSnapshot = directorySnapshot(nextMarkets);
      if (nextSnapshot !== marketSnapshot.current) {
        marketSnapshot.current = nextSnapshot;
        setMarkets(nextMarkets);
      }
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
      const key = selected.address.toLowerCase();
      const cached = identityCache.current.get(key);
      const stable = sameAsset(cached, known) ? cached! : known;
      identityCache.current.set(key, stable);
      setSelectedAsset(stable);
      setIdentityStatus("verified");
      return;
    }
    const key = selected.address.toLowerCase();
    if (identityCache.current.has(key)) {
      const cached = identityCache.current.get(key) ?? undefined;
      setSelectedAsset(cached);
      setIdentityStatus(cached ? "verified" : "unverified");
      return;
    }
    const controller = new AbortController();
    let active = true;
    setSelectedAsset(undefined);
    setIdentityStatus("checking");
    const timeout = window.setTimeout(() => {
      if (!active) return;
      controller.abort();
      setIdentityStatus("unverified");
    }, IDENTITY_LOOKUP_TIMEOUT_MS);
    const query = new URLSearchParams({ address: selected.address });
    void fetch(`/api/vnext/asset-identity?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ExternalMarketResponse;
        if (!response.ok) throw new Error(payload.error ?? "Identity lookup unavailable.");
        const asset = verifiedDirectoryAsset(selected, resolutionFromLookup(payload, selected.address));
        if (!active || controller.signal.aborted) return;
        window.clearTimeout(timeout);
        identityCache.current.set(key, asset ?? null);
        setSelectedAsset(asset ?? undefined);
        setIdentityStatus(asset ? "verified" : "unverified");
      })
      .catch(() => {
        if (active) {
          window.clearTimeout(timeout);
          setIdentityStatus("unverified");
        }
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [selected]);

  return { markets, status, selected, selectedAsset, identityStatus, selectedAddress, setSelectedAddress, refresh };
}
