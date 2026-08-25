"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import type { ExternalMarketResponse } from "../../lib/external-market";
import {
  directoryMarketFromExactLookup,
  directoryMarketFromUniversalSearchResult,
  directoryMarketFromVerifiedIdentity,
  isVNextDirectoryMarketSelectable,
  mergeVNextCanonicalBrowseMarkets,
  mergeVNextDirectoryAndSearchMarkets,
  mergeVNextExplicitSelectionMarket,
  normalizeDirectoryMarkets,
  parseVNextCanonicalDirectoryResponse,
  resolutionFromLookup,
  verifiedDirectoryAsset,
  type VNextDirectoryMarket,
  type VNextDirectoryResponse
} from "../../lib/vnext/market-directory";
import { VNEXT_CLIENT_REFRESH_POLICY } from "../../lib/vnext/client-refresh-policy";
import { useVisibilityRefresh } from "./use-visibility-refresh";
import {
  parseVNextUniversalMarketSearchResult,
  type VNextUniversalMarketSearchStatus
} from "../../lib/vnext/universal-market-search-contract";

const IDENTITY_LOOKUP_TIMEOUT_MS = 5_000;
const UNIVERSAL_SEARCH_TIMEOUT_MS = 6_000;

export type DirectoryStatus = "loading" | "ready" | "stale" | "error";
export type IdentityStatus = "idle" | "checking" | "verified" | "unverified";
type DirectoryServingMode = "unknown" | "legacy" | "canonical";

function claimsCanonicalDirectory(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (value as { canonical?: unknown }).canonical === true;
}

function directorySnapshot(markets: VNextDirectoryMarket[]) {
  return JSON.stringify(markets.map((market) => [
    market.address,
    market.name,
    market.symbol,
    market.priceUsd,
    market.liquidityUsd,
    market.marketCapUsd,
    market.volume5m,
    market.volume1h,
    market.volume24h,
    market.priceChange5m,
    market.priceChange1h,
    market.priceChange24h,
    market.buys5m,
    market.sells5m,
    market.buys1h,
    market.sells1h,
    market.buys24h,
    market.sells24h,
    market.pairCreatedAt,
    market.ageMinutes,
    market.momentumScore,
    market.buyPressureBps,
    market.riskFlags?.join("|"),
    market.signal,
    market.imageUri,
    market.pairAddress,
    market.dexId,
    market.url,
    market.primaryMarket?.pool.kind,
    market.primaryMarket?.pool.value,
    market.verifiedMarkets?.map((evidence) => `${evidence.venue}:${evidence.pool.kind}:${evidence.pool.value}`).join("|"),
    market.resolution?.token.address,
    market.resolution?.token.name,
    market.resolution?.token.symbol,
    market.resolution?.token.decimals,
    market.verifiedIdentity?.address,
    market.verifiedIdentity?.name,
    market.verifiedIdentity?.symbol,
    market.verifiedIdentity?.decimals,
    market.canonicalMarkets?.map((evidence) => `${evidence.sourceId}:${evidence.version}:${evidence.poolKey}`).join("|"),
    market.launchpadEvidence?.map((evidence) => `${evidence.sourceId}:${evidence.version}:${evidence.state}:${evidence.activity.lastActivityAt ?? "none"}`).join("|")
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
  const [searchMarkets, setSearchMarkets] = useState<VNextDirectoryMarket[]>([]);
  const [searchStatus, setSearchStatus] = useState<VNextUniversalMarketSearchStatus>("idle");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [hasMoreCanonicalMarkets, setHasMoreCanonicalMarkets] = useState(false);
  const hasData = useRef(false);
  const marketSnapshot = useRef("");
  const identityCache = useRef(new Map<string, AssetMetadata | null>());
  const exactLookupMarket = useRef<VNextDirectoryMarket | undefined>(undefined);
  const directoryServingMode = useRef<DirectoryServingMode>("unknown");
  const legacyDirectoryMarkets = useRef<VNextDirectoryMarket[]>([]);
  const canonicalDirectoryMarkets = useRef<VNextDirectoryMarket[]>([]);
  const providerEnrichmentMarkets = useRef<VNextDirectoryMarket[]>([]);
  const canonicalNextCursor = useRef<string | null>(null);
  const canonicalRequestSequence = useRef(0);
  const canonicalPageLoading = useRef(false);
  const searchController = useRef<AbortController | undefined>(undefined);
  const searchSequence = useRef(0);
  const selectionSequence = useRef(0);
  const completedExplicitSelections = useRef(new Set<string>());
  const completedCanonicalExactQueries = useRef(new Set<string>());
  const explicitSelectionRequests = useRef(new Map<string, Promise<VNextDirectoryMarket | undefined>>());
  const searchMarketsRef = useRef<VNextDirectoryMarket[]>([]);

  const publishMarkets = useCallback(() => {
    const byAddress = new Map<string, VNextDirectoryMarket>();
    if (directoryServingMode.current === "canonical") {
      for (const market of mergeVNextCanonicalBrowseMarkets(
        canonicalDirectoryMarkets.current,
        providerEnrichmentMarkets.current
      )) byAddress.set(market.address.toLowerCase(), market);
    } else if (directoryServingMode.current === "legacy") {
      for (const market of providerEnrichmentMarkets.current) byAddress.set(market.address.toLowerCase(), market);
      for (const market of legacyDirectoryMarkets.current) byAddress.set(market.address.toLowerCase(), market);
    }
    if (exactLookupMarket.current) {
      const key = exactLookupMarket.current.address.toLowerCase();
      const existing = byAddress.get(key);
      byAddress.set(key, existing
        ? mergeVNextDirectoryAndSearchMarkets([existing], [exactLookupMarket.current])[0]
        : exactLookupMarket.current);
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
    const exactDirectory = markets.find((market) => market.address.toLowerCase() === rawAddress.toLowerCase());
    const exactSearch = searchMarketsRef.current.find((market) => market.address.toLowerCase() === rawAddress.toLowerCase());
    const exact = exactDirectory && exactSearch
      ? mergeVNextDirectoryAndSearchMarkets([exactDirectory], [exactSearch])[0]
      : exactDirectory ?? exactSearch;
    if (exact?.canonicalMarkets?.length && isVNextDirectoryMarketSelectable(exact)) {
      selectionSequence.current += 1;
      exactLookupMarket.current = mergeVNextExplicitSelectionMarket({
        existing: exactLookupMarket.current,
        canonical: exact
      }) ?? exact;
      publishMarkets();
      setSelectedAddress(exact.address);
      return exactLookupMarket.current;
    }
    if (!isAddress(rawAddress, { strict: false })) return undefined;
    const address = getAddress(rawAddress);
    const selectionKey = address.toLowerCase();
    if (completedExplicitSelections.current.has(selectionKey) && exact && isVNextDirectoryMarketSelectable(exact)) {
      setSelectedAddress(exact.address);
      return exact;
    }
    const inFlight = explicitSelectionRequests.current.get(selectionKey);
    if (inFlight) return inFlight;
    const requestSequence = selectionSequence.current + 1;
    selectionSequence.current = requestSequence;
    const selectionRequest = (async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), IDENTITY_LOOKUP_TIMEOUT_MS);
      try {
        const marketQuery = new URLSearchParams({ contract: address });
        const identityQuery = new URLSearchParams({ address });
        const searchQuery = new URLSearchParams({ q: address });
        const readExternalJson = async (url: string) => {
          const response = await fetch(url, { signal: controller.signal });
          const payload = await response.json() as ExternalMarketResponse;
          return response.ok ? payload : null;
        };
        const readCanonicalJson = async () => {
          const response = await fetch(`/api/vnext/market-search?${searchQuery}`, {
            headers: { Accept: "application/json" },
            signal: controller.signal
          });
          const payload = parseVNextUniversalMarketSearchResult(await response.json());
          return response.ok ? payload : null;
        };
        const [canonicalResult, marketResult, identityResult] = await Promise.allSettled([
          readCanonicalJson(),
          readExternalJson(`/api/markets/external?${marketQuery}`),
          readExternalJson(`/api/vnext/asset-identity?${identityQuery}`)
        ]);
        if (requestSequence === selectionSequence.current) completedExplicitSelections.current.add(selectionKey);
        const canonicalPayload = canonicalResult.status === "fulfilled" ? canonicalResult.value : null;
        const marketPayload = marketResult.status === "fulfilled" ? marketResult.value : null;
        const identityPayload = identityResult.status === "fulfilled" ? identityResult.value : null;
        if (
          canonicalPayload?.status === "not_admitted"
          || marketPayload?.directoryAdmission === "not_admitted"
        ) {
          if (requestSequence === selectionSequence.current) {
            exactLookupMarket.current = undefined;
            searchMarketsRef.current = [];
            setSearchMarkets([]);
            setSelectedAddress(null);
            setSearchStatus("not_admitted");
          }
          return undefined;
        }
        const canonical = canonicalPayload?.results
          .find((result) => result.address.toLowerCase() === address.toLowerCase());
        const canonicalMarket = canonical ? directoryMarketFromUniversalSearchResult(canonical) : null;
        const providerMarket = marketPayload
          ? directoryMarketFromExactLookup(marketPayload, address)
          : null;
        const identityMarket = identityPayload
          ? directoryMarketFromVerifiedIdentity(identityPayload, address)
          : null;
        const fallback = mergeVNextExplicitSelectionMarket({
          existing: exact,
          canonical: canonicalMarket,
          identity: identityMarket,
          provider: providerMarket
        });
        if (!fallback || requestSequence !== selectionSequence.current) return undefined;
        exactLookupMarket.current = mergeVNextExplicitSelectionMarket({
          existing: exactLookupMarket.current,
          canonical: fallback
        }) ?? fallback;
        publishMarkets();
        setSelectedAddress(fallback.address);
        return exactLookupMarket.current;
      } catch {
        return undefined;
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    explicitSelectionRequests.current.set(selectionKey, selectionRequest);
    try {
      return await selectionRequest;
    } finally {
      if (explicitSelectionRequests.current.get(selectionKey) === selectionRequest) {
        explicitSelectionRequests.current.delete(selectionKey);
      }
    }
  }, [markets, publishMarkets]);

  const clearUniversalSearch = useCallback(() => {
    searchSequence.current += 1;
    searchController.current?.abort();
    searchController.current = undefined;
    searchMarketsRef.current = [];
    setSearchMarkets([]);
    setSubmittedSearchQuery("");
    setSearchStatus("idle");
  }, []);

  useEffect(() => () => {
    searchSequence.current += 1;
    searchController.current?.abort();
  }, []);

  const submitUniversalSearch = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    searchController.current?.abort();
    const requestSequence = searchSequence.current + 1;
    searchSequence.current = requestSequence;
    if (!query) {
      searchMarketsRef.current = [];
      setSearchMarkets([]);
      setSubmittedSearchQuery("");
      setSearchStatus("idle");
      return { status: "idle" as const, markets: [] as VNextDirectoryMarket[] };
    }

    const controller = new AbortController();
    searchController.current = controller;
    setSubmittedSearchQuery(query);
    searchMarketsRef.current = [];
    setSearchMarkets([]);
    setSearchStatus("searching");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UNIVERSAL_SEARCH_TIMEOUT_MS);
    try {
      const parameters = new URLSearchParams({ q: query });
      const response = await fetch(`/api/vnext/market-search?${parameters}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const payload = parseVNextUniversalMarketSearchResult(await response.json());
      if (requestSequence !== searchSequence.current) {
        return { status: "aborted" as const, markets: [] as VNextDirectoryMarket[] };
      }
      if (!payload) {
        setSearchStatus("unavailable");
        searchMarketsRef.current = [];
        setSearchMarkets([]);
        return { status: "unavailable" as const, markets: [] as VNextDirectoryMarket[] };
      }
      if (isAddress(query, { strict: false })) {
        completedCanonicalExactQueries.current.add(getAddress(query).toLowerCase());
      }
      const nextMarkets = payload.status === "found"
        ? payload.results.map(directoryMarketFromUniversalSearchResult)
        : [];
      setSearchStatus(payload.status);
      searchMarketsRef.current = nextMarkets;
      setSearchMarkets(nextMarkets);
      return { status: payload.status, markets: nextMarkets };
    } catch (cause) {
      if (requestSequence !== searchSequence.current || (!timedOut && cause instanceof DOMException && cause.name === "AbortError")) {
        return { status: "aborted" as const, markets: [] as VNextDirectoryMarket[] };
      }
      setSearchStatus("unavailable");
      searchMarketsRef.current = [];
      setSearchMarkets([]);
      return { status: "unavailable" as const, markets: [] as VNextDirectoryMarket[] };
    } finally {
      window.clearTimeout(timeout);
      if (requestSequence === searchSequence.current) searchController.current = undefined;
    }
  }, []);

  const refresh = useCallback(async () => {
    const requestSequence = canonicalRequestSequence.current + 1;
    canonicalRequestSequence.current = requestSequence;
    try {
      const response = await fetch("/api/vnext/market-directory", {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const rawPayload: unknown = await response.json();
      if (claimsCanonicalDirectory(rawPayload)) {
        directoryServingMode.current = "canonical";
        legacyDirectoryMarkets.current = [];
        const payload = parseVNextCanonicalDirectoryResponse(rawPayload);
        if (!response.ok || !payload || requestSequence !== canonicalRequestSequence.current) {
          throw new Error("Canonical market directory unavailable.");
        }
        const canonicalMarkets = payload.markets ?? [];
        if (canonicalMarkets.length === 0) throw new Error("Canonical market directory returned no markets.");
        canonicalDirectoryMarkets.current = canonicalMarkets;
        canonicalNextCursor.current = payload.nextCursor;
        setHasMoreCanonicalMarkets(payload.nextCursor !== null);
      } else {
        directoryServingMode.current = "legacy";
        canonicalDirectoryMarkets.current = [];
        canonicalNextCursor.current = null;
        setHasMoreCanonicalMarkets(false);
        const payload = rawPayload as VNextDirectoryResponse;
        const legacyMarkets = normalizeDirectoryMarkets(payload);
        if (!response.ok || legacyMarkets.length === 0 || requestSequence !== canonicalRequestSequence.current) {
          throw new Error(payload.error ?? "Market directory unavailable.");
        }
        legacyDirectoryMarkets.current = legacyMarkets;
      }
      const nextMarkets = publishMarkets();
      setSelectedAddress((current) => current && nextMarkets.some((market) => market.address.toLowerCase() === current.toLowerCase())
        ? current
        : nextMarkets[0].address);
      hasData.current = true;
      setStatus(!claimsCanonicalDirectory(rawPayload) && (rawPayload as VNextDirectoryResponse).stale ? "stale" : "ready");
    } catch {
      setStatus(hasData.current ? "stale" : "error");
    }
  }, [publishMarkets]);

  const loadNextCanonicalPage = useCallback(async () => {
    const cursor = canonicalNextCursor.current;
    if (directoryServingMode.current !== "canonical" || !cursor || canonicalPageLoading.current) return false;
    canonicalPageLoading.current = true;
    const requestSequence = canonicalRequestSequence.current;
    try {
      const parameters = new URLSearchParams({ cursor });
      const response = await fetch(`/api/vnext/market-directory?${parameters}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const payload = parseVNextCanonicalDirectoryResponse(await response.json());
      if (
        !response.ok ||
        !payload ||
        payload.nextCursor === cursor ||
        requestSequence !== canonicalRequestSequence.current ||
        cursor !== canonicalNextCursor.current
      ) return false;
      canonicalDirectoryMarkets.current = mergeVNextDirectoryAndSearchMarkets(
        canonicalDirectoryMarkets.current,
        payload.markets ?? []
      );
      canonicalNextCursor.current = payload.nextCursor;
      setHasMoreCanonicalMarkets(payload.nextCursor !== null);
      publishMarkets();
      hasData.current = true;
      setStatus("ready");
      return true;
    } catch {
      setStatus(hasData.current ? "stale" : "error");
      return false;
    } finally {
      canonicalPageLoading.current = false;
    }
  }, [publishMarkets]);

  const refreshEcosystemDirectory = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/external");
      const payload = await response.json() as ExternalMarketResponse;
      if (!response.ok) return;
      providerEnrichmentMarkets.current = normalizeDirectoryMarkets(payload);
      publishMarkets();
    } catch {
      // The selected serving mode retains its last-good browse inventory.
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

  return {
    markets,
    status,
    selected,
    selectedAsset,
    identityStatus,
    selectedAddress,
    setSelectedAddress,
    selectAddress,
    refresh,
    loadNextCanonicalPage,
    hasMoreCanonicalMarkets,
    searchMarkets,
    searchStatus,
    submittedSearchQuery,
    submitUniversalSearch,
    clearUniversalSearch
  };
}
