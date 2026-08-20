"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";
import {
  VNEXT_MARKET_DIRECTORY_PAGE_SIZE,
  VNEXT_MARKET_DIRECTORY_VIEWS,
  vNextRwaClassificationLabel,
  type VNextDirectoryMarket,
  type VNextMarketDirectoryView
} from "../../lib/vnext/market-directory";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { SpendBalance } from "./spend-balance";
import { formatTerminalAge, formatTerminalCompactUsd, formatTerminalPercent, formatTerminalPrice } from "./terminal-format";
import { TokenArtwork } from "./token-artwork";
import { TradeIntentComposer } from "./trade-intent-composer";
import type { DirectoryStatus, IdentityStatus } from "./use-vnext-market-directory";
import { VNextAssetWorkspace } from "./vnext-asset-workspace";
import { VNextDistributionPlanner } from "./vnext-distribution-planner";
import { VNextExecutionRecoveryBanner } from "./vnext-execution-recovery-banner";
import { VNextWalletConnection } from "./vnext-wallet-connection";

export type TerminalContext = "markets" | "asset" | "portfolio" | "distribution";
export type TradeSideRequest = { side: "buy" | "sell"; nonce: number };

export type TerminalPresentationProps = {
  context: TerminalContext;
  tradeOpen: boolean;
  query: string;
  setQuery: (query: string) => void;
  marketSearch: RefObject<HTMLInputElement | null>;
  markets: VNextDirectoryMarket[];
  filteredMarkets: VNextDirectoryMarket[];
  visibleMarkets: VNextDirectoryMarket[];
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
  onLoadMoreMarkets: () => void;
  onShowMarkets: () => void;
  onShowPortfolio: () => void;
  onShowDistribution: () => void;
  onShowRwa: () => void;
  onRequestTradeSide: (side: "buy" | "sell") => void;
  onCloseTrade: () => void;
  onContinueTrading: () => void;
};

function formatUsd(value: number) {
  return formatTerminalPrice(value);
}

function compactUsd(value: number) {
  return formatTerminalCompactUsd(value);
}

function formatChange(value: number) {
  return formatTerminalPercent(value);
}

function formatAge(ageMinutes: number | null) {
  return formatTerminalAge(ageMinutes);
}

function changeClass(value: number) {
  return value > 0 ? "vnPositive" : value < 0 ? "vnNegative" : "";
}

function RmtBrand({ compact = false, onActivate }: { compact?: boolean; onActivate: () => void }) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onActivate();
  };
  return <a className={`rmtTerminalBrand${compact ? " isCompact" : ""}`} href="/" aria-label="RMT Markets" onClick={handleClick}>
    <Image src="/brand/rmt-master-logo.png" alt="" width={compact ? 32 : 34} height={compact ? 32 : 34} priority />
    <span><strong>RMT</strong></span>
  </a>;
}

function MarketSearch({ query, setQuery, inputRef, onSubmit, id }: {
  query: string;
  setQuery: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  id: string;
}) {
  return <form className="rmtMarketSearch" role="search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <span aria-hidden="true">⌕</span>
    <label className="vnSrOnly" htmlFor={id}>Search Robinhood Chain markets</label>
    <input id={id} ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search token or contract" autoComplete="off" spellCheck={false} />
    {query ? <button className="rmtSearchClear" type="button" aria-label="Clear market search" onClick={() => setQuery("")}>×</button> : null}
    <button className="rmtSearchSubmit" type="submit">Find</button>
  </form>;
}

function MarketCategoryNav({ view, counts, searchActive, onChange }: {
  view: VNextMarketDirectoryView;
  counts: Record<VNextMarketDirectoryView, number>;
  searchActive: boolean;
  onChange: (view: VNextMarketDirectoryView) => void;
}) {
  return <nav className="rmtMarketViews" aria-label="Market categories">
    {VNEXT_MARKET_DIRECTORY_VIEWS.map((candidate) => <button
      className={!searchActive && candidate.id === view ? "isActive" : ""}
      type="button"
      key={candidate.id}
      aria-pressed={!searchActive && candidate.id === view}
      onClick={() => onChange(candidate.id)}
    ><span>{candidate.label}</span><small>{counts[candidate.id]}</small></button>)}
  </nav>;
}

function DirectoryMessage({ status, count, searchActive, view, onRefresh }: {
  status: DirectoryStatus;
  count: number;
  searchActive: boolean;
  view: VNextMarketDirectoryView;
  onRefresh: () => void;
}) {
  if (status === "loading" && count === 0) return <div className="rmtDirectoryMessage"><strong>Syncing markets…</strong><span>Loading verified directory data without prechecking routes.</span></div>;
  if (status === "error" && count === 0) return <div className="rmtDirectoryMessage"><strong>Market data delayed</strong><span>No asset has been marked untradeable.</span><button type="button" onClick={onRefresh}>Try again</button></div>;
  if (count === 0) return <div className="rmtDirectoryMessage"><strong>{searchActive ? "No matching markets" : `No ${view === "held" ? "wallet-held" : view} markets yet`}</strong><span>{searchActive ? "Search by name, symbol, or a complete contract address." : "Choose another category or use exact contract search."}</span></div>;
  return null;
}

function LoadMore({ visibleCount, totalCount, onLoadMore }: { visibleCount: number; totalCount: number; onLoadMore: () => void }) {
  const remaining = Math.max(0, totalCount - visibleCount);
  if (!remaining) return null;
  return <button className="rmtMarketLoadMore" type="button" onClick={onLoadMore}>Load {Math.min(VNEXT_MARKET_DIRECTORY_PAGE_SIZE, remaining)} more <span>{remaining} remaining</span></button>;
}

function RwaLabel({ market }: { market: VNextDirectoryMarket }) {
  const label = vNextRwaClassificationLabel(market.rwaRelationship);
  return label ? <em className={`rmtRwaClassification is${market.rwaRelationship === "canonical-stock-token" ? "Stock" : "Pair"}`}>{label}</em> : null;
}

function DesktopMarketTable(props: TerminalPresentationProps) {
  return <div className="rmtMarketTable" role="table" aria-label="Robinhood Chain markets">
    <div className="rmtMarketTableHead" role="row">
      <span role="columnheader">Token</span><span role="columnheader">Price</span><span role="columnheader">24h</span><span role="columnheader">MCap</span><span role="columnheader">Volume</span><span role="columnheader">Liquidity</span><span role="columnheader">Age</span><span role="columnheader">Type</span>
    </div>
    <div className="rmtMarketTableBody" role="rowgroup">
      {props.visibleMarkets.map((market) => <button className="rmtMarketTableRow" type="button" role="row" key={market.address} onClick={() => props.onSelectMarket(market.address)}>
        <span className="rmtMarketTokenCell" role="cell"><TokenArtwork className="rmtMarketArtwork" symbol={market.symbol} imageUrl={market.imageUri} /><span><strong>{market.symbol}</strong><small>{market.name}</small></span></span>
        <strong role="cell">{formatUsd(market.priceUsd)}</strong>
        <strong className={changeClass(market.priceChange24h)} role="cell">{formatChange(market.priceChange24h)}</strong>
        <span role="cell">{compactUsd(market.marketCapUsd)}</span>
        <span role="cell">{compactUsd(market.volume24h)}</span>
        <span role="cell">{compactUsd(market.liquidityUsd)}</span>
        <span role="cell">{formatAge(market.ageMinutes)}</span>
        <span role="cell"><RwaLabel market={market} /></span>
      </button>)}
    </div>
    <DirectoryMessage status={props.directoryStatus} count={props.visibleMarkets.length} searchActive={props.searchActive} view={props.directoryView} onRefresh={props.onRefresh} />
    <LoadMore visibleCount={props.visibleMarkets.length} totalCount={props.filteredMarkets.length} onLoadMore={props.onLoadMoreMarkets} />
  </div>;
}

function CompactMarketNavigator(props: TerminalPresentationProps) {
  return <aside className="rmtAssetNavigator" aria-label="Market navigator">
    <header><strong>Markets</strong><button type="button" onClick={props.onShowMarkets}>Full scanner</button></header>
    <MarketCategoryNav view={props.directoryView} counts={props.directoryViewCounts} searchActive={props.searchActive} onChange={props.onDirectoryViewChange} />
    <div className="rmtCompactMarketList">
      {props.visibleMarkets.map((market) => <button className={props.selected?.address === market.address ? "isSelected" : ""} type="button" key={market.address} aria-pressed={props.selected?.address === market.address} onClick={() => props.onSelectMarket(market.address)}>
        <TokenArtwork className="rmtMarketArtwork" symbol={market.symbol} imageUrl={market.imageUri} />
        <span><strong>{market.symbol}</strong><small>{formatUsd(market.priceUsd)}</small></span>
        <b className={changeClass(market.priceChange24h)}>{formatChange(market.priceChange24h)}</b>
      </button>)}
    </div>
    <DirectoryMessage status={props.directoryStatus} count={props.visibleMarkets.length} searchActive={props.searchActive} view={props.directoryView} onRefresh={props.onRefresh} />
  </aside>;
}

function MobileMarketList(props: TerminalPresentationProps) {
  return <div className="rmtMobileMarketList">
    {props.visibleMarkets.map((market) => <button className="rmtMobileMarketRow" type="button" key={market.address} onClick={() => props.onSelectMarket(market.address)}>
      <TokenArtwork className="rmtMarketArtwork" symbol={market.symbol} imageUrl={market.imageUri} />
      <span className="rmtMobileMarketIdentity"><span><strong>{market.symbol}</strong><RwaLabel market={market} /></span><small>{market.name}</small></span>
      <span className="rmtMobileMarketPrice"><strong>{formatUsd(market.priceUsd)}</strong><small className={changeClass(market.priceChange24h)}>{formatChange(market.priceChange24h)}</small></span>
      <span className="rmtMobileMarketMeta">M {compactUsd(market.marketCapUsd)} · V {compactUsd(market.volume24h)} · {formatAge(market.ageMinutes)}</span>
    </button>)}
    <DirectoryMessage status={props.directoryStatus} count={props.visibleMarkets.length} searchActive={props.searchActive} view={props.directoryView} onRefresh={props.onRefresh} />
    <LoadMore visibleCount={props.visibleMarkets.length} totalCount={props.filteredMarkets.length} onLoadMore={props.onLoadMoreMarkets} />
  </div>;
}

function MarketSummary({ markets }: { markets: VNextDirectoryMarket[] }) {
  const volume = markets.reduce((total, market) => total + (Number.isFinite(market.volume24h) ? Math.max(0, market.volume24h) : 0), 0);
  const canonicalRwa = markets.filter((market) => market.rwaRelationship === "canonical-stock-token").length;
  return <dl className="rmtMarketSummary">
    <div><dt>Loaded markets</dt><dd>{markets.length}</dd></div>
    <div><dt>Observed 24h volume</dt><dd>{compactUsd(volume)}</dd></div>
    <div><dt>Verified Stock Tokens</dt><dd>{canonicalRwa}</dd></div>
  </dl>;
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

function PortfolioController({ visible, ...props }: TerminalPresentationProps & { visible: boolean }) {
  return <>
    <SpendBalance
      visible={visible}
      markets={props.markets}
      onAssetsChange={props.onAssetsChange}
      onNativeBalanceChange={props.onNativeBalanceChange}
      onSelectAsset={props.onSelectMarket}
      executionRecord={props.executionRecord}
      portfolioRevealRequest={props.portfolioRevealRequest}
    />
    {visible ? <VNextExecutionRecoveryBanner record={props.executionRecord} status={props.executionStatus} /> : null}
  </>;
}

function RecoveryStatus(props: TerminalPresentationProps) {
  return props.context !== "portfolio" && props.executionRecord
    ? <VNextExecutionRecoveryBanner record={props.executionRecord} status={props.executionStatus} />
    : null;
}

function DesktopHeader(props: TerminalPresentationProps) {
  return <header className="rmtDesktopHeader">
    <RmtBrand onActivate={props.onShowMarkets} />
    <nav aria-label="Terminal navigation">
      <button data-terminal-nav="markets" className={props.context === "markets" && props.directoryView !== "rwa" ? "isActive" : ""} type="button" onClick={props.onShowMarkets}>Markets</button>
      <button data-terminal-nav="portfolio" className={props.context === "portfolio" ? "isActive" : ""} type="button" onClick={props.onShowPortfolio}>Portfolio</button>
      <button data-terminal-nav="distribution" className={props.context === "distribution" ? "isActive" : ""} type="button" onClick={props.onShowDistribution}>Distribution</button>
      <button data-terminal-nav="rwa" className={props.context === "markets" && props.directoryView === "rwa" ? "isActive" : ""} type="button" onClick={props.onShowRwa}>RWA</button>
    </nav>
    <MarketSearch id="rmt-desktop-market-search" query={props.query} setQuery={props.setQuery} inputRef={props.marketSearch} onSubmit={props.onSearchSubmit} />
    <span className="rmtChainState"><i aria-hidden="true" /> Robinhood · 4663</span>
    <VNextWalletConnection />
  </header>;
}

function DesktopMarkets(props: TerminalPresentationProps) {
  return <section className="rmtDesktopMarketsView" id="rmt-markets" aria-labelledby="rmt-market-directory-heading">
    <header className="rmtMarketsHeading"><div><h1 id="rmt-market-directory-heading">Markets</h1><p>Robinhood Chain market intelligence</p></div><span className={`rmtDirectoryFreshness is${props.directoryStatus}`}><i aria-hidden="true" />{props.directoryStatus === "ready" ? "Directory ready" : props.directoryStatus === "stale" ? "Last verified data" : props.directoryStatus === "loading" ? "Syncing" : "Delayed"}</span></header>
    <MarketSummary markets={props.markets} />
    <div className="rmtScannerControls"><MarketCategoryNav view={props.directoryView} counts={props.directoryViewCounts} searchActive={props.searchActive} onChange={props.onDirectoryViewChange} /><span>{props.filteredMarkets.length} in view · routes checked on demand</span></div>
    <DesktopMarketTable {...props} />
  </section>;
}

function DesktopAsset(props: TerminalPresentationProps) {
  const requestTrade = (side: "buy" | "sell") => {
    props.onRequestTradeSide(side);
    window.requestAnimationFrame(() => document.getElementById("vnext-trade-ticket")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };
  return <section className="rmtDesktopAssetView" id="rmt-asset-workspace">
    <div className="rmtAssetContextBar"><button type="button" onClick={props.onShowMarkets}>← Markets</button><span>{props.selected ? `${props.selected.symbol} · Robinhood Chain` : "Select a market"}</span></div>
    <div className="rmtDesktopWorkstation">
      <CompactMarketNavigator {...props} />
      <section className="rmtDesktopAsset">
        {props.selected ? <VNextAssetWorkspace presentation="desktop" directoryMarket={props.selected} identityStatus={props.identityStatus} walletAssets={props.walletAssets} onTradeSide={requestTrade} /> : <div className="rmtEmptyWorkspace"><strong>Select a market</strong><span>RMT does not invent asset or route data.</span></div>}
      </section>
      <aside className="rmtDesktopExecution" aria-label="Persistent verified execution"><TradeComposer {...props} /></aside>
    </div>
  </section>;
}

function DesktopPortfolio(props: TerminalPresentationProps) {
  return <section className="rmtPortfolioSurface" aria-labelledby="rmt-portfolio-heading">
    <header className="rmtMarketsHeading"><div><h1 id="rmt-portfolio-heading">Portfolio</h1><p>Confirmed Robinhood Chain balances and wallet-held assets</p></div></header>
    <PortfolioController {...props} visible />
  </section>;
}

function DesktopDistribution(props: TerminalPresentationProps) {
  return <section className="rmtDistributionSurface" id="rmt-distribution" aria-labelledby="rmt-distribution-heading">
    <header className="rmtMarketsHeading">
      <div><h1 id="rmt-distribution-heading">Distribution Center</h1><p>Plan deterministic, auditable value distribution.</p></div>
    </header>
    <VNextDistributionPlanner />
  </section>;
}

export function DesktopTerminal(props: TerminalPresentationProps) {
  return <main className="rmtVnext rmtTerminal rmtDesktopTerminal" data-terminal-context={props.context}>
    <a className="vnSkipLink" href={
      props.context === "markets" ? "#rmt-markets"
      : props.context === "portfolio" ? "#vnext-portfolio"
      : props.context === "distribution" ? "#rmt-distribution"
      : "#rmt-asset-workspace"
    }>Skip to terminal content</a>
    <DesktopHeader {...props} />
    <RecoveryStatus {...props} />
    {props.context !== "portfolio" ? <PortfolioController {...props} visible={false} /> : null}
    {props.context === "markets" ? <DesktopMarkets {...props} />
      : props.context === "portfolio" ? <DesktopPortfolio {...props} />
      : props.context === "distribution" ? <DesktopDistribution {...props} />
      : <DesktopAsset {...props} />}
  </main>;
}

function focusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), details summary, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute("hidden"));
}

function MobileHeader(props: TerminalPresentationProps) {
  return <>
    <header className="rmtMobileHeader"><RmtBrand compact onActivate={props.onShowMarkets} /><span className="rmtMobileChain"><i aria-hidden="true" /> 4663</span><VNextWalletConnection showFunding={false} compact /></header>
    <nav className="rmtMobilePrimaryNav" aria-label="Terminal navigation">
      <button className={props.context === "markets" || props.context === "asset" ? "isActive" : ""} type="button" onClick={props.onShowMarkets}>Markets</button>
      <button className={props.context === "portfolio" ? "isActive" : ""} type="button" onClick={props.onShowPortfolio}>Portfolio</button>
      <button className={props.context === "distribution" ? "isActive" : ""} type="button" onClick={props.onShowDistribution}>Distribution</button>
    </nav>
  </>;
}

function MobileMarkets(props: TerminalPresentationProps) {
  return <section className="rmtMobileMarketsView" id="rmt-mobile-markets" aria-labelledby="rmt-mobile-markets-heading">
    <header className="rmtMobileContextHeading"><div><h1 id="rmt-mobile-markets-heading">Markets</h1><p>Robinhood Chain</p></div><span>{props.directoryStatus === "ready" ? "Directory ready" : props.directoryStatus === "stale" ? "Last verified" : props.directoryStatus === "loading" ? "Syncing" : "Delayed"}</span></header>
    <MarketSummary markets={props.markets} />
    <MarketCategoryNav view={props.directoryView} counts={props.directoryViewCounts} searchActive={props.searchActive} onChange={props.onDirectoryViewChange} />
    <MarketSearch id="rmt-mobile-market-search" query={props.query} setQuery={props.setQuery} inputRef={props.marketSearch} onSubmit={props.onSearchSubmit} />
    <MobileMarketList {...props} />
  </section>;
}

function MobileAsset(props: TerminalPresentationProps) {
  return <section className="rmtMobileAssetView" id="rmt-mobile-asset">
    <div className="rmtMobileAssetBack"><button type="button" onClick={props.onShowMarkets}>← Markets</button><span>{props.selected?.symbol ?? "Asset"}</span></div>
    {props.selected ? <VNextAssetWorkspace presentation="mobile" directoryMarket={props.selected} identityStatus={props.identityStatus} walletAssets={props.walletAssets} onTradeSide={props.onRequestTradeSide} /> : <div className="rmtEmptyWorkspace"><strong>Select a market</strong><span>Live market intelligence will appear here.</span></div>}
  </section>;
}

function MobilePortfolio(props: TerminalPresentationProps) {
  return <section className="rmtPortfolioSurface isMobile" aria-labelledby="rmt-mobile-portfolio-heading">
    <header className="rmtMobileContextHeading"><div><h1 id="rmt-mobile-portfolio-heading">Portfolio</h1><p>Confirmed wallet state</p></div></header>
    <PortfolioController {...props} visible />
  </section>;
}

function MobileDistribution(props: TerminalPresentationProps) {
  return <section className="rmtDistributionSurface isMobile" id="rmt-mobile-distribution" aria-labelledby="rmt-mobile-distribution-heading">
    <header className="rmtMobileContextHeading"><div><h1 id="rmt-mobile-distribution-heading">Distribution Center</h1><p>Plan deterministic, auditable value distribution.</p></div></header>
    <VNextDistributionPlanner />
  </section>;
}

export function MobileTerminal(props: TerminalPresentationProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const selectedHolding = props.selected && props.walletAssets.find((asset) => asset.address.toLowerCase() === props.selected?.address.toLowerCase());
  const canSell = Boolean(selectedHolding && BigInt(selectedHolding.balanceAtomic) > 0n);

  const restoreTradeFocus = useCallback(() => {
    const fallback = document.querySelector<HTMLElement>(".rmtMobileTradeDock .isBuy") ?? document.querySelector<HTMLElement>(".rmtMobileTradeDock .isSell");
    (returnFocus.current ?? fallback)?.focus({ preventScroll: true });
  }, []);

  const closeSheet = useCallback(() => {
    props.onCloseTrade();
  }, [props.onCloseTrade]);
  const openTrade = useCallback((side: "buy" | "sell") => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    props.onRequestTradeSide(side);
  }, [props.onRequestTradeSide]);

  useEffect(() => {
    if (!props.tradeOpen) return;
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
      window.requestAnimationFrame(restoreTradeFocus);
    };
  }, [closeSheet, props.tradeOpen, restoreTradeFocus]);

  const preventEscapePropagation = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") event.stopPropagation();
  };

  return <main className="rmtVnext rmtTerminal rmtMobileTerminal" data-terminal-context={props.context}>
    <a className="vnSkipLink" href={
      props.context === "markets" ? "#rmt-mobile-markets"
      : props.context === "portfolio" ? "#vnext-portfolio"
      : props.context === "distribution" ? "#rmt-mobile-distribution"
      : "#rmt-mobile-asset"
    }>Skip to terminal content</a>
    <MobileHeader {...props} />
    <RecoveryStatus {...props} />
    {props.context !== "portfolio" ? <PortfolioController {...props} visible={false} /> : null}
    {props.context === "markets" ? <MobileMarkets {...props} />
      : props.context === "portfolio" ? <MobilePortfolio {...props} />
      : props.context === "distribution" ? <MobileDistribution {...props} />
      : <MobileAsset {...props} />}
    {props.context === "asset" && props.selected ? <nav className="rmtMobileTradeDock" aria-label={`Trade ${props.selected.symbol}`}>
      <button type="button" className="isBuy" onClick={() => openTrade("buy")}>Buy</button>
      <button type="button" className="isSell" disabled={!canSell} aria-describedby={!canSell ? "rmt-sell-unavailable" : undefined} onClick={() => openTrade("sell")}>Sell</button>
      {!canSell ? <span className="vnSrOnly" id="rmt-sell-unavailable">No confirmed balance available to sell.</span> : null}
    </nav> : null}
    <div className={`rmtMobileSheetLayer${props.tradeOpen ? " isOpen" : ""}`} aria-hidden={!props.tradeOpen}>
      <button className="rmtMobileSheetBackdrop" type="button" aria-label="Close trade sheet" tabIndex={props.tradeOpen ? 0 : -1} onClick={closeSheet} />
      <div className="rmtMobileTradeSheet" ref={sheet} role="dialog" aria-modal="true" aria-label={props.selected ? `Trade ${props.selected.symbol}` : "Trade selected asset"} onKeyDown={preventEscapePropagation}>
        <header><span>Verified trade</span><button type="button" aria-label="Close trade sheet" onClick={closeSheet}>×</button></header>
        <div className="rmtMobileTradeSheetScroll"><TradeComposer {...props} /></div>
      </div>
    </div>
  </main>;
}
