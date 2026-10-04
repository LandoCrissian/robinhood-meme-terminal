"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "../../lib/vnext/robinhood-assets";
import { selectedVNextWalletReadAddress } from "../../lib/vnext/selected-wallet-read-authority";
import type { VNextWalletReadSnapshot } from "../../lib/vnext/terminal-presentation-state";
import { parseVNextTerminalLocation } from "../../lib/vnext/terminal-location";
import type { VNextTerminalLocation } from "../../lib/vnext/terminal-location";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";
import {
  VNEXT_MARKET_DIRECTORY_PAGE_SIZE,
  exactVNextLocalDirectoryMatches,
  filterVNextLocalDirectoryMarkets,
  mergeVNextDirectoryAndSearchMarkets,
  selectVNextMarketDirectoryView,
  shouldUseExactAddressDegradedFallback,
  visibleVNextMarketDirectoryMarkets,
  vNextExecutionUiState,
  vNextSelectedMarketExecutionState,
  vNextMarketDirectoryViewCounts,
  type VNextMarketDirectoryView
} from "../../lib/vnext/market-directory";
import { ResponsiveTerminal, type TerminalContext, type TerminalPresentationProps, type TradeSideRequest } from "./terminal-presentations";
import { useDesktopTerminalPresentation } from "./use-terminal-presentation";
import { useVNextExecutionRecovery } from "./use-vnext-execution-recovery";
import { useVNextMarketDirectory } from "./use-vnext-market-directory";
import { useRmtIdentity } from "../rmt-identity";
import { useAnchoredMarketRows } from "./use-anchored-market-rows";
import { MARKET_UNIVERSES, selectMarketUniverse, type MarketUniverse } from "../../lib/vnext/market-universe";

export function VNextTerminalShell({ initialLocation = { context: "markets" }, initialMarket }: {
  initialLocation?: VNextTerminalLocation;
  initialMarket?: VNextDirectoryMarket;
}) {
  const desktop = useDesktopTerminalPresentation();
  const identity = useRmtIdentity();
  const account = useAccount();
  const [context, setContext] = useState<TerminalContext>(initialLocation.context);
  const [tradeOpen, setTradeOpen] = useState(initialLocation.context === "asset" && Boolean(initialLocation.side));
  const [dismissedExecutionHash, setDismissedExecutionHash] = useState<string>();
  const [query, setQuery] = useState("");
  const [walletReadSnapshot, setWalletReadSnapshot] = useState<VNextWalletReadSnapshot>({
    assets: [],
    assetBalanceEvidence: {},
    nativeBalanceEvidence: { state: "unavailable" },
    status: "idle",
    walletAddress: null,
    walletKey: null
  });
  const [portfolioRevealRequest, setPortfolioRevealRequest] = useState(0);
  const [tradeSideRequest, setTradeSideRequest] = useState<TradeSideRequest | undefined>(
    initialLocation.context === "asset" && initialLocation.side ? { side: initialLocation.side, nonce: 0 } : undefined
  );
  const [directoryView, setDirectoryView] = useState<VNextMarketDirectoryView>("active");
  const [marketUniverse, setMarketUniverse] = useState<MarketUniverse>("all");
  const [visibleMarketLimit, setVisibleMarketLimit] = useState(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
  const marketSearch = useRef<HTMLInputElement>(null);
  const locationSyncEpoch = useRef(0);
  const executionRecovery = useVNextExecutionRecovery();
  const {
    markets,
    status,
    enrichmentStatus,
    activitySnapshotPublished,
    selected,
    selectedAsset,
    identityStatus,
    selectAddress,
    refresh,
    loadNextCanonicalPage,
    hasMoreCanonicalMarkets,
    searchMarkets,
    searchStatus,
    submittedSearchQuery,
    submitUniversalSearch,
    clearUniversalSearch
  } = useVNextMarketDirectory(initialMarket);
  const walletReadAuthorityAddress = selectedVNextWalletReadAddress({
    selectedWalletKey: identity.activeWalletKey,
    selectedWalletKind: identity.activeWalletKind,
    selectedSignerAuthority: identity.activeSignerAuthority,
    connectedAddress: account.address,
    connectedChainId: account.chainId,
    connectorId: account.connector?.id,
    connectorType: account.connector?.type,
    connectorUid: account.connector?.uid,
    requiredChainId: ROBINHOOD_MAINNET_CHAIN_ID
  });
  const walletReadSnapshotCurrent = Boolean(
    walletReadAuthorityAddress
    && identity.activeWalletKey
    && walletReadSnapshot.walletKey === identity.activeWalletKey
    && walletReadSnapshot.walletAddress?.toLowerCase() === walletReadAuthorityAddress.toLowerCase()
  );
  const walletAssets: VNextDetectedWalletAsset[] = walletReadSnapshotCurrent ? walletReadSnapshot.assets : [];
  const assetBalanceEvidence = walletReadSnapshotCurrent ? walletReadSnapshot.assetBalanceEvidence : {};
  const nativeBalance = walletReadSnapshotCurrent ? walletReadSnapshot.nativeBalance : undefined;
  const nativeBalanceEvidence = walletReadSnapshotCurrent
    ? walletReadSnapshot.nativeBalanceEvidence
    : { state: "unavailable" as const };
  const walletReadStatus = walletReadSnapshotCurrent
    ? walletReadSnapshot.status
    : walletReadAuthorityAddress ? "loading" as const : "idle" as const;
  const selectedExecutionState = vNextSelectedMarketExecutionState(selected);
  const executionUiState = vNextExecutionUiState(
    selectedExecutionState,
    process.env.NEXT_PUBLIC_RMT_VNEXT_AUTHORIZATION_ENABLED === "true"
  );
  const effectiveTradeOpen = tradeOpen && selectedExecutionState === "normal";
  const selectAddressRef = useRef(selectAddress);
  const heldAddresses = useMemo(() => new Set(walletAssets.map((asset) => asset.address.toLowerCase())), [walletAssets]);
  const universeMarkets = useMemo(() => selectMarketUniverse(markets, marketUniverse, heldAddresses), [markets, marketUniverse, heldAddresses]);
  const universeCounts = Object.fromEntries(MARKET_UNIVERSES.map(scope => [scope, (!markets.length && (status === "loading" || status === "error")) || (scope === "held" && walletReadStatus === "idle") ? null : selectMarketUniverse(markets, scope, heldAddresses).length])) as Record<MarketUniverse, number | null>;
  const directoryViewCounts = useMemo(() => vNextMarketDirectoryViewCounts(universeMarkets, heldAddresses), [heldAddresses, universeMarkets]);
  const localFilteredMarkets = useMemo(() => {
    if (query.trim()) return filterVNextLocalDirectoryMarkets(markets, query);
    return selectVNextMarketDirectoryView(universeMarkets, directoryView === "all" && marketUniverse === "rwa" ? "rwa" : directoryView, heldAddresses);
  }, [directoryView, marketUniverse, heldAddresses, markets, universeMarkets, query]);
  const filteredMarkets = useMemo(() => {
    if (!query.trim()) return localFilteredMarkets;
    const submittedQueryIsCurrent = submittedSearchQuery.trim().toLowerCase() === query.trim().toLowerCase();
    return mergeVNextDirectoryAndSearchMarkets(
      localFilteredMarkets,
      submittedQueryIsCurrent ? searchMarkets : []
    );
  }, [localFilteredMarkets, query, searchMarkets, submittedSearchQuery]);
  const rankedVisibleMarkets = useMemo(
    () => visibleVNextMarketDirectoryMarkets(filteredMarkets, visibleMarketLimit),
    [filteredMarkets, visibleMarketLimit]
  );
  const scanner = useAnchoredMarketRows(rankedVisibleMarkets, `${marketUniverse}:${directoryView}:${query}:${visibleMarketLimit}`, filteredMarkets);
  const visibleMarkets = scanner.rows;
  useEffect(() => {
    const restore = () => {
      const p = new URLSearchParams(window.location.search), scope = p.get("universe"), view = p.get("view");
      setMarketUniverse(MARKET_UNIVERSES.includes(scope as MarketUniverse) ? scope as MarketUniverse : view === "rwa" ? "rwa" : "all");
      setDirectoryView(view === "rwa" ? "all" : ["active", "movers", "new", "trending", "all"].includes(view ?? "") ? view as VNextMarketDirectoryView : "active");
    };
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const changeUniverse = (scope: MarketUniverse) => {
    setMarketUniverse(scope);
    clearUniversalSearch(); setQuery("");
    setVisibleMarketLimit(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
    const url = new URL(window.location.href); url.searchParams.set("universe", scope);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    selectAddressRef.current = selectAddress;
  }, [selectAddress]);

  const writeLocation = useCallback((nextContext: TerminalContext, market?: string, side?: "buy" | "sell", replace = false) => {
    // Explicit navigation supersedes a pending lookup for the previous URL.
    locationSyncEpoch.current += 1;
    const url = new URL(window.location.href);
    url.searchParams.delete("market");
    url.searchParams.delete("side");
    url.searchParams.delete("panel");
    if (nextContext === "portfolio") url.searchParams.set("panel", "portfolio");
    if (nextContext === "distribution") url.searchParams.set("panel", "distribution");
    if (nextContext === "asset" && market) {
      url.searchParams.set("market", market);
      if (side) url.searchParams.set("side", side);
    }
    window.history[replace ? "replaceState" : "pushState"]({ rmtTerminalContext: nextContext }, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const showMarkets = useCallback(() => {
    setContext("markets");
    setTradeOpen(false);
    writeLocation("markets");
  }, [writeLocation]);
  const continueTrading = useCallback(() => {
    // Dismiss only this settled receipt's presentation, never its recovery evidence.
    if (executionRecovery.record?.kind === "swap" && executionRecovery.record.state === "confirmed") {
      setDismissedExecutionHash(executionRecovery.record.txHash);
    }
    clearUniversalSearch();
    setQuery("");
    setVisibleMarketLimit(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
    setContext("markets");
    setTradeOpen(false);
    writeLocation("markets");
    window.requestAnimationFrame(() => {
      marketSearch.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      marketSearch.current?.focus({ preventScroll: true });
    });
  }, [clearUniversalSearch, writeLocation, executionRecovery.record]);
  const updateQuery = useCallback((nextQuery: string) => {
    clearUniversalSearch();
    setQuery(nextQuery);
    setVisibleMarketLimit(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
  }, [clearUniversalSearch]);
  const selectMarket = useCallback((address: string, renderedMarket?: VNextDirectoryMarket) => {
    void selectAddress(address, renderedMarket).then((selectedMarket) => {
      if (!selectedMarket) return;
      setContext("asset");
      setTradeOpen(false);
      writeLocation("asset", address);
    });
  }, [selectAddress, writeLocation]);
  const submitSearch = useCallback(() => {
    const submitted = query.trim();
    if (!submitted) return;
    const exactLocalMatches = exactVNextLocalDirectoryMatches(markets, submitted);
    if (exactLocalMatches.length === 1) {
      selectMarket(exactLocalMatches[0].address);
      return;
    }
    void submitUniversalSearch(submitted).then((result) => {
      if (result.status === "aborted") return;
      if (result.status === "found" && result.markets.length === 1) {
        selectMarket(result.markets[0].address);
        return;
      }
      if (shouldUseExactAddressDegradedFallback(submitted, result.status)) {
        selectMarket(submitted);
        return;
      }
      setContext("markets");
      setTradeOpen(false);
      writeLocation("markets");
    });
  }, [markets, query, selectMarket, submitUniversalSearch, writeLocation]);
  const showPortfolio = useCallback(() => {
    setPortfolioRevealRequest((request) => request + 1);
    setContext("portfolio");
    setTradeOpen(false);
    writeLocation("portfolio");
  }, [writeLocation]);
  const showDistribution = useCallback(() => {
    setContext("distribution");
    setTradeOpen(false);
    writeLocation("distribution");
  }, [writeLocation]);
  const changeDirectoryView = useCallback((view: VNextMarketDirectoryView) => {
    setDirectoryView(view);
    const url = new URL(window.location.href); url.searchParams.set("view", view);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    clearUniversalSearch();
    setQuery("");
    setVisibleMarketLimit(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
  }, [clearUniversalSearch]);
  const showRwa = useCallback(() => {
    setMarketUniverse("rwa");
    changeDirectoryView("all");
    const url = new URL(window.location.href); url.searchParams.set("universe", "rwa");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setContext("markets");
    setTradeOpen(false);
    writeLocation("markets");
  }, [changeDirectoryView, writeLocation]);
  const loadMoreMarkets = useCallback(() => {
    if (visibleMarketLimit < filteredMarkets.length) {
      setVisibleMarketLimit((current) => Math.min(
        filteredMarkets.length,
        current + VNEXT_MARKET_DIRECTORY_PAGE_SIZE
      ));
      return;
    }
    if (!query.trim() && hasMoreCanonicalMarkets) {
      void loadNextCanonicalPage().then((loaded) => {
        if (loaded) setVisibleMarketLimit((current) => current + VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
      });
    }
  }, [filteredMarkets.length, hasMoreCanonicalMarkets, loadNextCanonicalPage, query, visibleMarketLimit]);
  const requestTradeSide = useCallback((side: "buy" | "sell") => {
    if (selectedExecutionState !== "normal") return;
    setTradeSideRequest({ side, nonce: Date.now() });
    setContext("asset");
    setTradeOpen(true);
    if (selected) writeLocation("asset", selected.address, side);
  }, [selected, selectedExecutionState, writeLocation]);
  const closeTrade = useCallback(() => {
    setTradeOpen(false);
    if (selected) writeLocation("asset", selected.address, undefined, true);
  }, [selected, writeLocation]);

  useEffect(() => {
    if (selectedExecutionState === "normal" || !tradeOpen) return;
    setTradeOpen(false);
    if (selected) writeLocation("asset", selected.address, undefined, true);
  }, [selected, selectedExecutionState, tradeOpen, writeLocation]);

  useEffect(() => {
    let firstSynchronization = true;
    const synchronizeFromLocation = () => {
      const initialSynchronization = firstSynchronization;
      firstSynchronization = false;
      const epoch = ++locationSyncEpoch.current;
      const location = parseVNextTerminalLocation(window.location.search);
      if (location.context === "portfolio") {
        setPortfolioRevealRequest((request) => request + 1);
        setContext("portfolio");
        setTradeOpen(false);
        return;
      }
      if (location.context === "distribution") {
        setContext("distribution");
        setTradeOpen(false);
        return;
      }
      if (location.context === "asset") {
        void selectAddressRef.current(location.market).then((selectedMarket) => {
          if (locationSyncEpoch.current !== epoch) return;
          if (!selectedMarket) {
            setContext("markets");
            setTradeOpen(false);
            return;
          }
          setContext("asset");
          if (location.side && vNextSelectedMarketExecutionState(selectedMarket) === "normal") {
            // The initial server destination already owns this side request.
            // A delayed directory response cannot replay it over a typed draft
            // or the recovery snapshot. Later back/forward requests remain explicit.
            const initialSideAlreadyApplied = initialSynchronization && initialLocation.context === "asset"
              && initialLocation.market.toLowerCase() === location.market.toLowerCase()
              && initialLocation.side === location.side;
            if (!initialSideAlreadyApplied) setTradeSideRequest({ side: location.side, nonce: Date.now() });
            setTradeOpen(true);
          } else {
            setTradeOpen(false);
          }
        });
        return;
      }
      setContext("markets");
      setTradeOpen(false);
    };
    synchronizeFromLocation();
    window.addEventListener("popstate", synchronizeFromLocation);
    return () => window.removeEventListener("popstate", synchronizeFromLocation);
  }, []);

  const props: TerminalPresentationProps = {
    context,
    tradeOpen: effectiveTradeOpen,
    query,
    setQuery: updateQuery,
    marketSearch,
    markets,
    filteredMarkets,
    visibleMarkets,
    scannerUpdates: scanner,
    directoryView,
    directoryViewCounts,
    marketUniverse,
    universeCounts,
    onUniverseChange: changeUniverse,
    searchActive: Boolean(query.trim()),
    searchStatus,
    expandedSearchResultCount: submittedSearchQuery.trim().toLowerCase() === query.trim().toLowerCase()
      ? searchMarkets.length
      : 0,
    directoryStatus: status,
    activityCoveragePending: enrichmentStatus === "pending",
    activitySnapshotPublished,
    activityCoverageDelayed: enrichmentStatus === "delayed",
    hasMoreDirectoryMarkets: !query.trim() && hasMoreCanonicalMarkets,
    selected,
    selectedExecutionState,
    executionUiState,
    selectedAsset,
    identityStatus,
    walletAssets,
    assetBalanceEvidence,
    nativeBalance,
    nativeBalanceEvidence,
    walletReadStatus,
    executionRecord: executionRecovery.record,
    dismissedExecutionHash,
    walletRequest: executionRecovery.walletRequest,
    executionStatus: executionRecovery.status,
    onRecheckWalletRequest: executionRecovery.recheckWalletRequest,
    walletRequestRecheckPending: executionRecovery.walletRequestRecheckPending,
    portfolioRevealRequest,
    tradeSideRequest,
    onWalletSnapshotChange: setWalletReadSnapshot,
    onSelectMarket: selectMarket,
    onSearchSubmit: submitSearch,
    onRefresh: () => void refresh(),
    onDirectoryViewChange: changeDirectoryView,
    onLoadMoreMarkets: loadMoreMarkets,
    onShowMarkets: showMarkets,
    onShowPortfolio: showPortfolio,
    onShowDistribution: showDistribution,
    onShowRwa: showRwa,
    onRequestTradeSide: requestTradeSide,
    onCloseTrade: closeTrade,
    onContinueTrading: continueTrading
  };

  return <ResponsiveTerminal {...props} desktop={desktop} />;
}
