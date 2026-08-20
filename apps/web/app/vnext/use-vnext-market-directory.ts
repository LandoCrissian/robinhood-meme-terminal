"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import type { ExternalMarketResponse } from "../../lib/external-market";
import {
  directoryMarketFromExactLookup,
  directoryMarketFromVerifiedIdentity,
  normalizeDirectoryMarkets,
  resolutionFromLookup,
  verifiedDirectoryAsset,
  type VNextDirectoryMarket,
  type VNextDirectoryResponse
} from "../../lib/vnext/market-directory";
import { ROBINHOOD_RMT_ADDRESS } from "../../lib/vnext/robinhood-assets";
import { VNEXT_CLIENT_REFRESH_POLICY } from "../../lib/vnext/client-refresh-policy";
import { useVisibilityRefresh } from "./use-visibility-refresh";

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
    market.imageUri,
    market.pairAddress,
    market.dexId,
    market.url,
    market.marketDataState,
    market.primaryMarket?.pool.kind,
    market.primaryMarket?.pool.value,
    market.verifiedMarkets?.map((evidence) => `${evidence.venue}:${evidence.pool.kind}:${evidence.pool.value}`).join("|"),
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
  const exactLookupMarket = useRef<VNextDirectoryMarket | undefined>(undefined);
  const fastDirectoryMarkets = useRef<VNextDirectoryMarket[]>([]);
  const ecosystemMarkets = useRef<VNextDirectoryMarket[]>([]);

  const publishMarkets = useCallback(() => {
    const byAddress = new Map<string, VNextDirectoryMarket>();
    for (const market of ecosystemMarkets.current) byAddress.set(market.address.toLowerCase(), market);
    for (const market of fastDirectoryMarkets.current) byAddress.set(market.address.toLowerCase(), market);
    if (exactLookupMarket.current) {
      const key = exactLookupMarket.current.address.toLowerCase();
      const existing = byAddress.get(key);
      const preferExact = exactLookupMarket.current.marketDataState !== "identity-only" || !existing?.primaryMarket;
      byAddress.set(key, existing && preferExact ? {
        ...existing,
        ...exactLookupMarket.current,
        resolution: exactLookupMarket.current.resolution ?? existing.resolution
      } : existing ?? exactLookupMarket.current);
    }
    const nextMarkets = [...byAddress.values()].sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) || (right.volume24h ?? -1) - (left.volume24h ?? -1));
    const nextSnapshot = directorySnapshot(nextMarkets);
    if (nextSnapshot !== marketSnapshot.current) {
      marketSnapshot.current = nextSnapshot;
      setMarkets(nextMarkets);
    }
    return nextMarkets;
  }, []);

  const selectAddress = useCallback(async (rawAddress: string) => {
    const exact = markets.find((market) => market.address.toLowerCase() === rawAddress.toLowerCase());
    if (exact?.marketDataState !== "identity-only" && exact?.primaryMarket) {
      setSelectedAddress(exact.address);
      return true;
    }
    if (!isAddress(rawAddress, { strict: false })) return false;
    const address = getAddress(rawAddress);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), IDENTITY_LOOKUP_TIMEOUT_MS);
    try {
      const marketQuery = new URLSearchParams({ contract: address });
      const identityQuery = new URLSearchParams({ address });
      const readJson = async (url: string) => {
        const response = await fetch(url, { signal: controller.signal });
        const payload = await response.json() as ExternalMarketResponse;
        return response.ok ? payload : null;
      };
      const [marketResult, identityResult] = await Promise.allSettled([
        readJson(`/api/markets/external?${marketQuery}`),
        readJson(`/api/vnext/asset-identity?${identityQuery}`)
      ]);
      const marketPayload = marketResult.status === "fulfilled" ? marketResult.value : null;
      const identityPayload = identityResult.status === "fulfilled" ? identityResult.value : null;
      const discovered = marketPayload
        ? directoryMarketFromExactLookup(marketPayload, address)
        : null;
      const fallback = discovered ?? (identityPayload
        ? directoryMarketFromVerifiedIdentity(identityPayload, address)
        : null);
      if (!fallback) return false;
      setMarkets((current) => current.some((market) => market.address.toLowerCase() === address.toLowerCase())
        ? current.map((market) => {
            if (market.address.toLowerCase() !== address.toLowerCase()) return market;
            if (fallback.marketDataState === "identity-only" && market.primaryMarket) return market;
            return { ...market, ...fallback, resolution: fallback.resolution ?? market.resolution };
          })
        : [fallback, ...current]);
      exactLookupMarket.current = fallback;
      setSelectedAddress(fallback.address);
      return true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [markets]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/vnext/market-directory");
      const payload = await response.json() as VNextDirectoryResponse;
      const directoryMarkets = normalizeDirectoryMarkets(payload);
      fastDirectoryMarkets.current = directoryMarkets;
      const nextMarkets = publishMarkets();
      if (!response.ok || nextMarkets.length === 0) throw new Error(payload.error ?? "Market directory unavailable.");
      setSelectedAddress((current) => current && nextMarkets.some((market) => market.address.toLowerCase() === current.toLowerCase())
        ? current
        : nextMarkets.find((market) => market.address === ROBINHOOD_RMT_ADDRESS)?.address ?? nextMarkets[0].address);
      hasData.current = true;
      setStatus(payload.stale ? "stale" : "ready");
    } catch {
      setStatus(hasData.current ? "stale" : "error");
    }
  }, [publishMarkets]);

  const refreshEcosystemDirectory = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/external");
      const payload = await response.json() as ExternalMarketResponse;
      if (!response.ok) return;
      ecosystemMarkets.current = normalizeDirectoryMarkets(payload);
      publishMarkets();
    } catch {
      // The fast directory remains authoritative for availability when broader discovery is delayed.
    }
  }, [publishMarkets]);

  useVisibilityRefresh(refresh, VNEXT_CLIENT_REFRESH_POLICY.marketDirectoryMs);
  useVisibilityRefresh(refreshEcosystemDirectory, VNEXT_CLIENT_REFRESH_POLICY.ecosystemDirectoryMs);

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
    void fetch(`/api/vnext/asset-identity?${query}`, { signal: controller.signal })
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

  return { markets, status, selected, selectedAsset, identityStatus, selectedAddress, setSelectedAddress, selectAddress, refresh };
}
