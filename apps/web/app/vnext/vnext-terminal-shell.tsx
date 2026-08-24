"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { parseVNextTerminalLocation } from "../../lib/vnext/terminal-location";
import {
  VNEXT_MARKET_DIRECTORY_PAGE_SIZE,
  exactVNextLocalDirectoryMatches,
  filterVNextLocalDirectoryMarkets,
  mergeVNextDirectoryAndSearchMarkets,
  selectVNextMarketDirectoryView,
  shouldUseExactAddressDegradedFallback,
  visibleVNextMarketDirectoryMarkets,
  vNextSelectedMarketExecutionState,
  vNextMarketDirectoryViewCounts,
  type VNextMarketDirectoryView
} from "../../lib/vnext/market-directory";
import { DesktopTerminal, MobileTerminal, type TerminalContext, type TerminalPresentationProps, type TradeSideRequest } from "./terminal-presentations";
import { useDesktopTerminalPresentation } from "./use-terminal-presentation";
import { useVNextExecutionRecovery } from "./use-vnext-execution-recovery";
import { useVNextMarketDirectory } from "./use-vnext-market-directory";

export function VNextTerminalShell() {
  const desktop = useDesktopTerminalPresentation();
  const [context, setContext] = useState<TerminalContext>("markets");
  const [tradeOpen, setTradeOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [walletAssets, setWalletAssets] = useState<VNextDetectedWalletAsset[]>([]);
  const [nativeBalance, setNativeBalance] = useState<bigint>();
  const [portfolioRevealRequest, setPortfolioRevealRequest] = useState(0);
  const [tradeSideRequest, setTradeSideRequest] = useState<TradeSideRequest>();
  const [directoryView, setDirectoryView] = useState<VNextMarketDirectoryView>("active");
  const [visibleMarketLimit, setVisibleMarketLimit] = useState(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
  const marketSearch = useRef<HTMLInputElement>(null);
  const locationSyncEpoch = useRef(0);
  const executionRecovery = useVNextExecutionRecovery();
  const {
    markets,
    status,
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
  } = useVNextMarketDirectory();
  const selectedExecutionState = vNextSelectedMarketExecutionState(selected);
  const effectiveTradeOpen = tradeOpen && selectedExecutionState === "normal";
  const selectAddressRef = useRef(selectAddress);
  const heldAddresses = useMemo(() => new Set(walletAssets.map((asset) => asset.address.toLowerCase())), [walletAssets]);
  const directoryViewCounts = useMemo(() => vNextMarketDirectoryViewCounts(markets, heldAddresses), [heldAddresses, markets]);
  const localFilteredMarkets = useMemo(() => query.trim()
    ? filterVNextLocalDirectoryMarkets(markets, query)
    : selectVNextMarketDirectoryView(markets, directoryView, heldAddresses),
  [directoryView, heldAddresses, markets, query]);
  const filteredMarkets = useMemo(() => {
    if (!query.trim()) return localFilteredMarkets;
    const submittedQueryIsCurrent = submittedSearchQuery.trim().toLowerCase() === query.trim().toLowerCase();
    return mergeVNextDirectoryAndSearchMarkets(
      localFilteredMarkets,
      submittedQueryIsCurrent ? searchMarkets : []
    );
  }, [localFilteredMarkets, query, searchMarkets, submittedSearchQuery]);
  const visibleMarkets = useMemo(
    () => visibleVNextMarketDirectoryMarkets(filteredMarkets, visibleMarketLimit),
    [filteredMarkets, visibleMarketLimit]
  );

  useEffect(() => {
    selectAddressRef.current = selectAddress;
  }, [selectAddress]);

  const writeLocation = useCallback((nextContext: TerminalContext, market?: string, side?: "buy" | "sell", replace = false) => {
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
  }, [clearUniversalSearch, writeLocation]);
  const updateQuery = useCallback((nextQuery: string) => {
    clearUniversalSearch();
    setQuery(nextQuery);
    setVisibleMarketLimit(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
  }, [clearUniversalSearch]);
  const selectMarket = useCallback((address: string) => {
    void selectAddress(address).then((selectedMarket) => {
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
    clearUniversalSearch();
    setQuery("");
    setVisibleMarketLimit(VNEXT_MARKET_DIRECTORY_PAGE_SIZE);
  }, [clearUniversalSearch]);
  const showRwa = useCallback(() => {
    changeDirectoryView("rwa");
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
    if (selectedExecutionState === "stock-token-view-only") return;
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
    if (selectedExecutionState !== "stock-token-view-only" || !tradeOpen) return;
    setTradeOpen(false);
    if (selected) writeLocation("asset", selected.address, undefined, true);
  }, [selected, selectedExecutionState, tradeOpen, writeLocation]);

  useEffect(() => {
    const synchronizeFromLocation = () => {
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
            setTradeSideRequest({ side: location.side, nonce: Date.now() });
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
    directoryView,
    directoryViewCounts,
    searchActive: Boolean(query.trim()),
    searchStatus,
    expandedSearchResultCount: submittedSearchQuery.trim().toLowerCase() === query.trim().toLowerCase()
      ? searchMarkets.length
      : 0,
    directoryStatus: status,
    hasMoreDirectoryMarkets: !query.trim() && hasMoreCanonicalMarkets,
    selected,
    selectedExecutionState,
    selectedAsset,
    identityStatus,
    walletAssets,
    nativeBalance,
    executionRecord: executionRecovery.record,
    executionStatus: executionRecovery.status,
    portfolioRevealRequest,
    tradeSideRequest,
    onAssetsChange: setWalletAssets,
    onNativeBalanceChange: setNativeBalance,
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

  return desktop ? <DesktopTerminal {...props} /> : <MobileTerminal {...props} />;
}
