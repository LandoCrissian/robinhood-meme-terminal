"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";
import {
  VNEXT_MARKET_DIRECTORY_VIEWS,
  vNextRwaClassificationLabel,
  type VNextDirectoryMarket,
  type VNextMarketDirectoryView
} from "../../lib/vnext/market-directory";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { SpendBalance } from "./spend-balance";
import { TokenArtwork } from "./token-artwork";
import { TradeIntentComposer } from "./trade-intent-composer";
import type { DirectoryStatus, IdentityStatus } from "./use-vnext-market-directory";
import { VNextAssetWorkspace } from "./vnext-asset-workspace";
import { VNextExecutionRecoveryBanner } from "./vnext-execution-recovery-banner";
import { VNextWalletConnection } from "./vnext-wallet-connection";

export type TradeSideRequest = { side: "buy" | "sell"; nonce: number };

export type TerminalPresentationProps = {
  query: string;
  setQuery: (query: string) => void;
  marketSearch: RefObject<HTMLInputElement | null>;
  markets: VNextDirectoryMarket[];
  filteredMarkets: VNextDirectoryMarket[];
  directoryView: VNextMarketDirectoryView;
  directoryViewCounts: Record<VNextMarketDirectoryView, number>;
  searchActive: boolean;
  directoryStatus: DirectoryStatus;
  selected?: VNextDirectoryMarket;
  selectedAsset?: AssetMetadata;
  identityStatus: IdentityStatus;
  walletAssets: VNextDetectedWalletAsset[];
  nativeBalance?: bigint;
  executionRecord: VNextExecutionRecord | null;
  executionStatus: "idle" | "confirming" | "confirmation_unavailable" | "reconciliation_failed" | "confirmed" | "reverted";
  portfolioRevealRequest: number;
  tradeSideRequest?: TradeSideRequest;
  onAssetsChange: (assets: VNextDetectedWalletAsset[]) => void;
  onNativeBalanceChange: (balance: bigint | undefined) => void;
  onSelectMarket: (address: string) => void;
  onSearchSubmit: () => void;
  onRefresh: () => void;
  onDirectoryViewChange: (view: VNextMarketDirectoryView) => void;
  onRevealPortfolio: () => void;
  onRequestTradeSide: (side: "buy" | "sell") => void;
  onContinueTrading: () => void;
};

function formatUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function formatChange(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

function compactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function RmtBrand({ compact = false }: { compact?: boolean }) {
  return <Link className={`rmtTerminalBrand${compact ? " isCompact" : ""}`} href="/" aria-label="RMT Terminal home">
    <Image src="/brand/rmt-master-logo.png" alt="" width={compact ? 34 : 38} height={compact ? 34 : 38} priority />
    <span><strong>RMT</strong>{!compact && <small>Robinhood Terminal</small>}</span>
  </Link>;
}

function MarketSearch({ query, setQuery, inputRef, onSubmit }: {
  query: string;
  setQuery: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
}) {
  return <form className="rmtMarketSearch" role="search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <span aria-hidden="true">⌕</span>
    <label className="vnSrOnly" htmlFor="rmt-market-search">Search Robinhood Chain markets</label>
    <input id="rmt-market-search" ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search token or paste contract" autoComplete="off" spellCheck={false} />
    <button type="submit">Find</button>
  </form>;
}

function MarketDirectory({ mode, markets, selected, status, view, viewCounts, searchActive, onSelect, onRefresh, onViewChange }: {
  mode: "desktop" | "mobile";
  markets: VNextDirectoryMarket[];
  selected?: VNextDirectoryMarket;
  status: DirectoryStatus;
  view: VNextMarketDirectoryView;
  viewCounts: Record<VNextMarketDirectoryView, number>;
  searchActive: boolean;
  onSelect: (address: string) => void;
  onRefresh: () => void;
  onViewChange: (view: VNextMarketDirectoryView) => void;
}) {
  return <div className={`rmtMarketDirectory is${mode}`} aria-live="polite">
    <nav className="rmtMarketViews" aria-label="Market categories">
      {VNEXT_MARKET_DIRECTORY_VIEWS.map((candidate) => <button
        className={!searchActive && candidate.id === view ? "isActive" : ""}
        type="button"
        key={candidate.id}
        aria-pressed={!searchActive && candidate.id === view}
        onClick={() => onViewChange(candidate.id)}
      ><span>{candidate.label}</span><small>{viewCounts[candidate.id]}</small></button>)}
    </nav>
    <div className="rmtMarketViewStatus"><strong>{searchActive ? "Search results" : VNEXT_MARKET_DIRECTORY_VIEWS.find((candidate) => candidate.id === view)?.label}</strong><span>{!searchActive && view === "rwa" ? "Stock Tokens first · RWA Pairs labeled" : `${markets.length} markets · routes checked on demand`}</span></div>
    {status === "loading" && markets.length === 0 && <div className="rmtDirectoryMessage"><strong>Syncing markets</strong><span>Loading directory data without prechecking routes.</span></div>}
    {status === "error" && markets.length === 0 && <div className="rmtDirectoryMessage"><strong>Directory unavailable</strong><span>No asset has been marked untradeable.</span><button type="button" onClick={onRefresh}>Try again</button></div>}
    {markets.map((market) => <button
      className={`rmtMarketItem${selected?.address === market.address ? " isSelected" : ""}`}
      key={market.address}
      type="button"
      aria-pressed={selected?.address === market.address}
      onClick={() => onSelect(market.address)}
    >
      <TokenArtwork className="rmtMarketArtwork" symbol={market.symbol} imageUrl={market.imageUri} />
      <span className="rmtMarketName">
        <span className="rmtMarketIdentity"><strong>{market.symbol}</strong>{vNextRwaClassificationLabel(market.rwaRelationship) ? <em className={`rmtRwaClassification is${market.rwaRelationship === "canonical-stock-token" ? "Stock" : "Pair"}`}>{vNextRwaClassificationLabel(market.rwaRelationship)}</em> : null}</span>
        <small>{mode === "desktop" ? market.name : compactUsd(market.volume24h) + " vol"}</small>
      </span>
      <span className="rmtMarketQuote"><strong>{formatUsd(market.priceUsd)}</strong><small className={market.priceChange24h > 0 ? "vnPositive" : market.priceChange24h < 0 ? "vnNegative" : ""}>{formatChange(market.priceChange24h)}</small></span>
    </button>)}
    {status !== "loading" && markets.length === 0 && <div className="rmtDirectoryMessage"><strong>{searchActive ? "No matching markets" : `No ${view === "held" ? "wallet-held" : view} markets yet`}</strong><span>{searchActive ? "Search by name, symbol, or a complete contract address." : "Choose another category or use exact contract search. No asset was marked unavailable."}</span></div>}
  </div>;
}

function TradeComposer(props: TerminalPresentationProps) {
  return <TradeIntentComposer
    marketName={props.selected?.name ?? "No market selected"}
    marketSymbol={props.selected?.symbol ?? "—"}
    marketAsset={props.selectedAsset}
    walletAssets={props.walletAssets}
    nativeBalance={props.nativeBalance}
    executionRecord={props.executionRecord}
    onContinueTrading={props.onContinueTrading}
    sideRequest={props.tradeSideRequest}
  />;
}

function TerminalBalance(props: TerminalPresentationProps) {
  return <>
    <SpendBalance
      markets={props.markets}
      onAssetsChange={props.onAssetsChange}
      onNativeBalanceChange={props.onNativeBalanceChange}
      onSelectAsset={props.onSelectMarket}
      executionRecord={props.executionRecord}
      portfolioRevealRequest={props.portfolioRevealRequest}
    />
    <VNextExecutionRecoveryBanner record={props.executionRecord} status={props.executionStatus} />
  </>;
}

export function DesktopTerminal(props: TerminalPresentationProps) {
  const selectMarket = useCallback((address: string) => props.onSelectMarket(address), [props]);
  const requestTrade = useCallback((side: "buy" | "sell") => {
    props.onRequestTradeSide(side);
    window.requestAnimationFrame(() => document.getElementById("vnext-trade-ticket")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [props]);

  return <main className="rmtVnext rmtTerminal rmtDesktopTerminal">
    <a className="vnSkipLink" href="#rmt-asset-workspace">Skip to asset workspace</a>
    <header className="rmtDesktopHeader">
      <RmtBrand />
      <nav aria-label="Terminal navigation"><a className="isActive" href="#rmt-markets">Markets</a><a href="#vnext-portfolio" onClick={props.onRevealPortfolio}>Portfolio</a><a href="/rwa">RWA</a></nav>
      <MarketSearch query={props.query} setQuery={props.setQuery} inputRef={props.marketSearch} onSubmit={props.onSearchSubmit} />
      <span className="rmtChainState"><i aria-hidden="true" /> Robinhood · 4663</span>
      <VNextWalletConnection />
    </header>
    <section className="rmtDesktopBalance"><TerminalBalance {...props} /></section>
    <div className="rmtDesktopWorkstation">
      <aside className="rmtDesktopMarkets" id="rmt-markets" aria-labelledby="rmt-market-directory-heading">
        <header><div><span className="vnEyebrow">Discover</span><h1 id="rmt-market-directory-heading">Markets</h1></div><span>{props.filteredMarkets.length}/{props.markets.length}</span></header>
        <MarketDirectory mode="desktop" markets={props.filteredMarkets} selected={props.selected} status={props.directoryStatus} view={props.directoryView} viewCounts={props.directoryViewCounts} searchActive={props.searchActive} onSelect={selectMarket} onRefresh={props.onRefresh} onViewChange={props.onDirectoryViewChange} />
      </aside>
      <section className="rmtDesktopAsset" id="rmt-asset-workspace">
        {props.selected ? <VNextAssetWorkspace presentation="desktop" directoryMarket={props.selected} identityStatus={props.identityStatus} walletAssets={props.walletAssets} onTradeSide={requestTrade} /> : <div className="rmtEmptyWorkspace"><strong>Select a market</strong><span>RMT does not invent asset or route data.</span></div>}
      </section>
      <aside className="rmtDesktopExecution" aria-label="Persistent trade execution"><TradeComposer {...props} /></aside>
    </div>
  </main>;
}

function focusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), details summary, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute("hidden"));
}

export function MobileTerminal(props: TerminalPresentationProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const selectedHolding = props.selected && props.walletAssets.find((asset) => asset.address.toLowerCase() === props.selected?.address.toLowerCase());
  const canSell = Boolean(selectedHolding && BigInt(selectedHolding.balanceAtomic) > 0n);

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const openTrade = useCallback((side: "buy" | "sell") => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    props.onRequestTradeSide(side);
    setSheetOpen(true);
  }, [props]);

  useEffect(() => {
    if (!sheetOpen) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => focusableElements(sheet.current ?? document.body)[0]?.focus());
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab" || !sheet.current) return;
      const elements = focusableElements(sheet.current);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      window.requestAnimationFrame(() => returnFocus.current?.focus());
    };
  }, [closeSheet, sheetOpen]);

  const preventEscapePropagation = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") event.stopPropagation();
  };

  return <main className="rmtVnext rmtTerminal rmtMobileTerminal">
    <a className="vnSkipLink" href="#rmt-mobile-asset">Skip to selected asset</a>
    <header className="rmtMobileHeader"><RmtBrand compact /><VNextWalletConnection /></header>
    <div className="rmtMobileSearch"><MarketSearch query={props.query} setQuery={props.setQuery} inputRef={props.marketSearch} onSubmit={props.onSearchSubmit} /></div>
    <section className="rmtMobileBalance"><TerminalBalance {...props} /></section>
    <details className="rmtMobileDiscovery" open={discoveryOpen} onToggle={(event) => setDiscoveryOpen(event.currentTarget.open)}>
      <summary><span><b>Markets</b><small>{props.filteredMarkets.length} shown · routes checked on demand</small></span><i aria-hidden="true">⌄</i></summary>
      <MarketDirectory mode="mobile" markets={props.filteredMarkets} selected={props.selected} status={props.directoryStatus} view={props.directoryView} viewCounts={props.directoryViewCounts} searchActive={props.searchActive} onSelect={(address) => { props.onSelectMarket(address); setDiscoveryOpen(false); }} onRefresh={props.onRefresh} onViewChange={props.onDirectoryViewChange} />
    </details>
    <section id="rmt-mobile-asset" className="rmtMobileAsset">
      {props.selected ? <VNextAssetWorkspace presentation="mobile" directoryMarket={props.selected} identityStatus={props.identityStatus} walletAssets={props.walletAssets} onTradeSide={openTrade} /> : <div className="rmtEmptyWorkspace"><strong>Select a market</strong><span>Live market intelligence will appear here.</span></div>}
    </section>
    {props.selected && <nav className="rmtMobileTradeDock" aria-label={`Trade ${props.selected.symbol}`}>
      <button type="button" className="isBuy" onClick={() => openTrade("buy")}>Buy {props.selected.symbol}</button>
      <button type="button" className="isSell" disabled={!canSell} onClick={() => openTrade("sell")}>Sell</button>
    </nav>}
    <div className={`rmtMobileSheetLayer${sheetOpen ? " isOpen" : ""}`} aria-hidden={!sheetOpen}>
      <button className="rmtMobileSheetBackdrop" type="button" aria-label="Close trade sheet" tabIndex={sheetOpen ? 0 : -1} onClick={closeSheet} />
      <div className="rmtMobileTradeSheet" ref={sheet} role="dialog" aria-modal="true" aria-label={props.selected ? `Trade ${props.selected.symbol}` : "Trade selected asset"} onKeyDown={preventEscapePropagation}>
        <header><span>Verified trade</span><button type="button" aria-label="Close trade sheet" onClick={closeSheet}>×</button></header>
        <div className="rmtMobileTradeSheetScroll"><TradeComposer {...props} /></div>
      </div>
    </div>
  </main>;
}
