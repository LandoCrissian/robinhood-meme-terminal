"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { DesktopTerminal, MobileTerminal, type TerminalPresentationProps, type TradeSideRequest } from "./terminal-presentations";
import { useDesktopTerminalPresentation } from "./use-terminal-presentation";
import { useVNextExecutionRecovery } from "./use-vnext-execution-recovery";
import { useVNextMarketDirectory } from "./use-vnext-market-directory";

export function VNextTerminalShell() {
  const desktop = useDesktopTerminalPresentation();
  const [query, setQuery] = useState("");
  const [walletAssets, setWalletAssets] = useState<VNextDetectedWalletAsset[]>([]);
  const [nativeBalance, setNativeBalance] = useState<bigint>();
  const [portfolioRevealRequest, setPortfolioRevealRequest] = useState(0);
  const [tradeSideRequest, setTradeSideRequest] = useState<TradeSideRequest>();
  const marketSearch = useRef<HTMLInputElement>(null);
  const executionRecovery = useVNextExecutionRecovery();
  const { markets, status, selected, selectedAsset, identityStatus, selectAddress, refresh } = useVNextMarketDirectory();
  const filteredMarkets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return !normalized ? markets : markets.filter((market) =>
      `${market.symbol} ${market.name} ${market.address}`.toLowerCase().includes(normalized)
    );
  }, [markets, query]);

  const continueTrading = useCallback(() => {
    setQuery("");
    window.requestAnimationFrame(() => {
      marketSearch.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      marketSearch.current?.focus({ preventScroll: true });
    });
  }, []);
  const selectMarket = useCallback((address: string) => {
    void selectAddress(address);
  }, [selectAddress]);
  const submitSearch = useCallback(() => {
    const exactMatch = filteredMarkets.length === 1 ? filteredMarkets[0] : undefined;
    if (exactMatch) {
      void selectAddress(exactMatch.address);
      return;
    }
    void selectAddress(query.trim());
  }, [filteredMarkets, query, selectAddress]);
  const revealPortfolio = useCallback(() => setPortfolioRevealRequest((request) => request + 1), []);
  const requestTradeSide = useCallback((side: "buy" | "sell") => {
    setTradeSideRequest({ side, nonce: Date.now() });
  }, []);

  const props: TerminalPresentationProps = {
    query,
    setQuery,
    marketSearch,
    markets,
    filteredMarkets,
    directoryStatus: status,
    selected,
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
    onRevealPortfolio: revealPortfolio,
    onRequestTradeSide: requestTradeSide,
    onContinueTrading: continueTrading
  };

  return desktop ? <DesktopTerminal {...props} /> : <MobileTerminal {...props} />;
}
