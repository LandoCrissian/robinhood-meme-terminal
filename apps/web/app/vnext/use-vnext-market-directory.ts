"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import type { ExternalMarketResponse } from "../../lib/external-market";
import { mergeBoundedDiscoveryRefresh, parseBoundedDiscoveryCoverage, type BoundedDiscoveryCoverage } from "../../lib/vnext/bounded-discovery";
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

export type DirectoryStatus = "loading" | "ready" | "stale" | "fallback" | "error";
export type DirectoryEnrichmentStatus = "pending" | "ready" | "delayed";
export type IdentityStatus = "idle" | "checking" | "verified" | "unverified";
type DirectoryServingMode = "unknown" | "legacy" | "canonical";

function directoryResponseStale(response: Response, payload: { stale?: boolean }) {
  return payload.stale === true
    || response.headers.get("X-RMT-Directory-Cache")?.toUpperCase() === "STALE"
    || ["last-known", "stale", "limited"].includes(response.headers.get("X-RMT-Directory-Freshness")?.toLowerCase() ?? "");
}

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
    market.fdvUsd,
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

function replacePerformanceMark(name: string) {
  if (typeof performance === "undefined") return;
  performance.clearMarks(name);
  performance.mark(name);
}

function replacePerformanceMeasure(name: string, start: string, end: string) {
  if (typeof performance === "undefined") return;
  performance.clearMeasures(name);
  try {
    performance.measure(name, start, end);
  } catch {
    // Timing evidence is diagnostic and must never alter directory behavior.
  }
}

export function useVNextMarketDirectory() {
  const [markets, setMarkets] = useState<VNextDirectoryMarket[]>([]);
  const [status, setStatus] = useState<DirectoryStatus>("loading");
  const [enrichmentStatus, setEnrichmentStatus] = useState<DirectoryEnrichmentStatus>("pending");
  const [activitySnapshotPublished, setActivitySnapshotPublished] = useState(false);
  const discoveryCoverage = useRef<BoundedDiscoveryCoverage | null>(null);
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
  const canonicalPageLoading = useRef<object | null>(null);
  const canonicalLoadedPages = useRef(1);
  const canonicalLoadedCursors = useRef(new Set<string>());
  const canonicalRefreshLoading = useRef<number | null>(null);
  const canonicalInventorySource = useRef<"indexed" | "curated-fallback" | undefined>(undefined);
  const canonicalWindowStale = useRef(false);
  const positiveQuarantines = useRef(new Set<string>());
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
    const nextMarkets = [...byAddress.values()].filter((market) => !positiveQuarantines.current.has(market.address.toLowerCase())).sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) || (right.volume24h ?? -1) - (left.volume24h ?? -1));
    const nextSnapshot = directorySnapshot(nextMarkets);
    if (nextSnapshot !== marketSnapshot.current) {
      marketSnapshot.current = nextSnapshot;
      setMarkets(nextMarkets);
    }
    return nextMarkets;
  }, []);

  const retainPositiveQuarantines = useCallback((addresses: readonly string[] = []) => {
    if (!addresses.length) return;
    for (const address of addresses) positiveQuarantines.current.add(address.toLowerCase());
    if (exactLookupMarket.current && positiveQuarantines.current.has(exactLookupMarket.current.address.toLowerCase())) exactLookupMarket.current = undefined;
    searchMarketsRef.current = searchMarketsRef.current.filter((market) => !positiveQuarantines.current.has(market.address.toLowerCase()));
    setSearchMarkets(searchMarketsRef.current);
    setSelectedAddress((current) => current && positiveQuarantines.current.has(current.toLowerCase()) ? null : current);
    publishMarkets();
  }, [publishMarkets]);

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
        const canonicalAlreadyRead = completedCanonicalExactQueries.current.has(selectionKey);
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
          canonicalAlreadyRead ? Promise.resolve(null) : readCanonicalJson(),
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
    canonicalRefreshLoading.current = requestSequence;
    canonicalPageLoading.current = null;
    const loadedPageCount = canonicalLoadedPages.current;
    let nextStatus: DirectoryStatus = "ready";
    replacePerformanceMark("rmt:market-directory:request-start");
    try {
      const response = await fetch("/api/vnext/market-directory", {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000)
      });
      const rawPayload: unknown = await response.json();
      replacePerformanceMark("rmt:market-directory:parsed");
      if (requestSequence !== canonicalRequestSequence.current) return;
      if (claimsCanonicalDirectory(rawPayload)) {
        const payload = parseVNextCanonicalDirectoryResponse(rawPayload);
        if (!response.ok || !payload || requestSequence !== canonicalRequestSequence.current) {
          throw new Error("Canonical market directory unavailable.");
        }
        retainPositiveQuarantines(payload.quarantinedAddresses);
        if (canonicalDirectoryMarkets.current.length > 0 && canonicalInventorySource.current !== "curated-fallback" && (
          payload.inventorySource === "curated-fallback"
          || payload.revalidationComplete === false
          || (canonicalInventorySource.current === "indexed" && payload.inventorySource !== "indexed")
        )) throw new Error("Retaining indexed browse window while canonical inventory is degraded.");
        let windowStale = directoryResponseStale(response, payload) || payload.revalidationComplete === false;
        const windowQuarantines = new Set(payload.quarantinedAddresses ?? []);
        let canonicalMarkets = payload.markets ?? [];
        let nextCursor = payload.nextCursor;
        let pagesRead = 1;
        const cursors = new Set<string>();
        // Revalidate the loaded browse window through a fresh cursor chain. Do not
        // publish page one over last-good later pages while this work is pending.
        while (pagesRead < loadedPageCount && nextCursor !== null) {
          if (cursors.has(nextCursor)) throw new Error("Canonical directory cursor cycle.");
          cursors.add(nextCursor);
          const pageResponse = await fetch(`/api/vnext/market-directory?${new URLSearchParams({ cursor: nextCursor })}`, {
            method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000)
          });
          const page = parseVNextCanonicalDirectoryResponse(await pageResponse.json());
          if (requestSequence !== canonicalRequestSequence.current) return;
          if (pageResponse.ok && page) retainPositiveQuarantines(page.quarantinedAddresses);
          if (!pageResponse.ok || !page || page.inventorySource !== payload.inventorySource
            || page.inventorySource === "curated-fallback" || page.revalidationComplete === false
            || (page.nextCursor !== null && cursors.has(page.nextCursor))) {
            throw new Error("Loaded canonical directory window could not be revalidated.");
          }
          for (const address of page.quarantinedAddresses ?? []) windowQuarantines.add(address);
          windowStale ||= directoryResponseStale(pageResponse, page);
          canonicalMarkets = mergeVNextDirectoryAndSearchMarkets(canonicalMarkets, page.markets ?? []);
          nextCursor = page.nextCursor;
          pagesRead += 1;
        }
        if (canonicalMarkets.length === 0 && payload.coverage !== "complete") throw new Error("Canonical market directory returned no markets.");
        canonicalMarkets = canonicalMarkets.filter((market) => !windowQuarantines.has(market.address.toLowerCase()));
        // Only a fresh, fully revalidated indexed admission may supersede an
        // earlier positive conflict; fallback/telemetry cannot resurrect it.
        if (payload.inventorySource === "indexed" && payload.revalidationComplete === true && !windowStale) {
          for (const market of canonicalMarkets) positiveQuarantines.current.delete(market.address.toLowerCase());
        }
        canonicalInventorySource.current = payload.inventorySource;
        canonicalWindowStale.current = windowStale;
        nextStatus = payload.inventorySource === "curated-fallback" ? "fallback" : windowStale ? "stale" : "ready";
        directoryServingMode.current = "canonical";
        legacyDirectoryMarkets.current = [];
        canonicalDirectoryMarkets.current = canonicalMarkets;
        canonicalNextCursor.current = nextCursor;
        canonicalLoadedPages.current = pagesRead;
        canonicalLoadedCursors.current = cursors;
        setHasMoreCanonicalMarkets(nextCursor !== null);
      } else {
        if (directoryServingMode.current === "canonical") throw new Error("Canonical directory authority unavailable.");
        const payload = rawPayload as VNextDirectoryResponse;
        nextStatus = directoryResponseStale(response, payload) ? "stale" : "ready";
        const legacyMarkets = normalizeDirectoryMarkets(payload);
        if (!response.ok || legacyMarkets.length === 0 || requestSequence !== canonicalRequestSequence.current) {
          throw new Error(payload.error ?? "Market directory unavailable.");
        }
        directoryServingMode.current = "legacy";
        canonicalDirectoryMarkets.current = [];
        canonicalNextCursor.current = null;
        canonicalLoadedPages.current = 1;
        canonicalLoadedCursors.current = new Set();
        setHasMoreCanonicalMarkets(false);
        legacyDirectoryMarkets.current = legacyMarkets;
      }
      const nextMarkets = publishMarkets();
      replacePerformanceMark("rmt:market-directory:published");
      replacePerformanceMeasure(
        "rmt:market-directory:parse-publish",
        "rmt:market-directory:parsed",
        "rmt:market-directory:published"
      );
      replacePerformanceMeasure(
        "rmt:market-directory:request-publish",
        "rmt:market-directory:request-start",
        "rmt:market-directory:published"
      );
      setSelectedAddress((current) => current && nextMarkets.some((market) => market.address.toLowerCase() === current.toLowerCase())
        ? current
        : nextMarkets[0]?.address ?? null);
      hasData.current = true;
      setStatus(nextStatus);
    } catch {
      if (requestSequence === canonicalRequestSequence.current) {
        canonicalWindowStale.current = true;
        setStatus(hasData.current ? "stale" : "error");
      }
    } finally {
      if (canonicalRefreshLoading.current === requestSequence) canonicalRefreshLoading.current = null;
    }
  }, [publishMarkets, retainPositiveQuarantines]);

  const loadNextCanonicalPage = useCallback(async () => {
    const cursor = canonicalNextCursor.current;
    if (directoryServingMode.current !== "canonical" || !cursor || canonicalPageLoading.current || canonicalRefreshLoading.current !== null) return false;
    const pageRequest = {};
    canonicalPageLoading.current = pageRequest;
    const requestSequence = canonicalRequestSequence.current;
    try {
      const parameters = new URLSearchParams({ cursor });
      const response = await fetch(`/api/vnext/market-directory?${parameters}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000)
      });
      const payload = parseVNextCanonicalDirectoryResponse(await response.json());
      if (requestSequence !== canonicalRequestSequence.current || cursor !== canonicalNextCursor.current) return false;
      if (response.ok && payload) retainPositiveQuarantines(payload.quarantinedAddresses);
      if (
        !response.ok ||
        !payload ||
        payload.nextCursor === cursor ||
        (payload.nextCursor !== null && canonicalLoadedCursors.current.has(payload.nextCursor)) ||
        requestSequence !== canonicalRequestSequence.current ||
        cursor !== canonicalNextCursor.current ||
        payload.inventorySource !== canonicalInventorySource.current ||
        payload.inventorySource === "curated-fallback" || payload.revalidationComplete === false
      ) throw new Error("Canonical pagination is degraded.");
      canonicalWindowStale.current ||= directoryResponseStale(response, payload);
      canonicalDirectoryMarkets.current = mergeVNextDirectoryAndSearchMarkets(
        canonicalDirectoryMarkets.current,
        payload.markets ?? []
      );
      canonicalNextCursor.current = payload.nextCursor;
      canonicalLoadedPages.current += 1;
      canonicalLoadedCursors.current.add(cursor);
      setHasMoreCanonicalMarkets(payload.nextCursor !== null);
      publishMarkets();
      hasData.current = true;
      setStatus(canonicalWindowStale.current ? "stale" : "ready");
      return true;
    } catch {
      if (requestSequence === canonicalRequestSequence.current) {
        canonicalWindowStale.current = true;
        setStatus(hasData.current ? "stale" : "error");
      }
      return false;
    } finally {
      if (canonicalPageLoading.current === pageRequest) canonicalPageLoading.current = null;
    }
  }, [publishMarkets, retainPositiveQuarantines]);

  const refreshEcosystemDirectory = useCallback(async () => {
    replacePerformanceMark("rmt:market-enrichment:request-start");
    try {
      const response = await fetch("/api/markets/external");
      const payload = await response.json() as ExternalMarketResponse;
      if (!response.ok) {
        setEnrichmentStatus("delayed");
        return;
      }
      const freshMarkets = normalizeDirectoryMarkets(payload);
      discoveryCoverage.current = parseBoundedDiscoveryCoverage(payload.discoveryCoverage, freshMarkets.length);
      const delayed = payload.stale === true || Boolean(payload.delayedSources?.length);
      providerEnrichmentMarkets.current = mergeBoundedDiscoveryRefresh(
        providerEnrichmentMarkets.current, freshMarkets, discoveryCoverage.current, delayed,
        Array.isArray(payload.quarantinedAddresses)
          ? payload.quarantinedAddresses.filter((address) => typeof address === "string" && isAddress(address))
          : []
      );
      if (hasData.current) publishMarkets();
      setActivitySnapshotPublished(true);
      setEnrichmentStatus(!delayed && discoveryCoverage.current?.completeWithinObservedCandidates ? "ready" : "delayed");
      replacePerformanceMark("rmt:market-enrichment:published");
      replacePerformanceMeasure(
        "rmt:market-enrichment:request-publish",
        "rmt:market-enrichment:request-start",
        "rmt:market-enrichment:published"
      );
    } catch {
      // The selected serving mode retains its last-good browse inventory.
      setEnrichmentStatus("delayed");
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
    enrichmentStatus,
    activitySnapshotPublished,
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
