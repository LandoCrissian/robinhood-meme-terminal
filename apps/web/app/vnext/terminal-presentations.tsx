"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { AssetMetadata } from "../../lib/vnext/execution-domain";
import type { VNextExecutionRecord } from "../../lib/vnext/execution-recovery";
import {
  VNEXT_MARKET_DIRECTORY_PAGE_SIZE,
  VNEXT_MARKET_DIRECTORY_VIEWS,
  selectVNextCanonicalMarket,
  vNextRwaClassificationLabel,
  type VNextDirectoryMarket,
  type VNextExecutionUiState,
  type VNextMarketDirectoryView,
  type VNextSelectedMarketExecutionState
} from "../../lib/vnext/market-directory";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import type { VNextUniversalMarketSearchStatus } from "../../lib/vnext/universal-market-search-contract";
import { SpendBalance } from "./spend-balance";
import { formatTerminalAge, formatTerminalCompactUsd, formatTerminalPercent, formatTerminalPrice } from "./terminal-format";
import { TokenArtwork } from "./token-artwork";
import { TradeIntentComposer } from "./trade-intent-composer";
import type { DirectoryStatus, IdentityStatus } from "./use-vnext-market-directory";
import { VNextAssetWorkspace } from "./vnext-asset-workspace";
import { VNextChainPulseCard } from "./vnext-chain-pulse-card";
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
  searchStatus: VNextUniversalMarketSearchStatus;
  expandedSearchResultCount: number;
  directoryStatus: DirectoryStatus;
  activityCoveragePending: boolean;
  hasMoreDirectoryMarkets: boolean;
  selected?: VNextDirectoryMarket;
  selectedExecutionState: VNextSelectedMarketExecutionState;
  executionUiState: VNextExecutionUiState;
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

function formatUsd(value: number | null) {
  return formatTerminalPrice(value);
}

function compactUsd(value: number | null) {
  return formatTerminalCompactUsd(value);
}

function formatChange(value: number | null) {
  return formatTerminalPercent(value);
}

function formatAge(ageMinutes: number | null) {
  return formatTerminalAge(ageMinutes);
}

function changeClass(value: number | null) {
  if (value === null) return "";
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

function MarketSearch({ query, setQuery, inputRef, onSubmit, searchStatus, id }: {
  query: string;
  setQuery: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  searchStatus: VNextUniversalMarketSearchStatus;
  id: string;
}) {
  return <form className="rmtMarketSearch" role="search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <span aria-hidden="true">⌕</span>
    <label className="vnSrOnly" htmlFor={id}>Search Robinhood Chain markets</label>
    <input id={id} ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search token, contract or pool" autoComplete="off" spellCheck={false} />
    {query ? <button className="rmtSearchClear" type="button" aria-label="Clear market search" onClick={() => setQuery("")}>×</button> : null}
    <button className="rmtSearchSubmit" type="submit" disabled={searchStatus === "searching"}>{searchStatus === "searching" ? "Finding…" : "Find"}</button>
  </form>;
}

function SearchStatusMessage({ status, count }: { status: VNextUniversalMarketSearchStatus; count: number }) {
  if (status === "idle") return null;
  if (status === "searching") return <div className="rmtSearchStatus" role="status">Searching Robinhood Chain markets…</div>;
  if (status === "found") return <div className="rmtSearchStatus" role="status">{count === 1 ? "Market found." : `${count} market matches found. Choose one.`}</div>;
  if (status === "not_admitted") return <div className="rmtSearchStatus isDelayed" role="status">Not admitted to the RMT directory.</div>;
  if (status === "not_found") return <div className="rmtSearchStatus" role="status">No additional market match found.</div>;
  if (status === "inventory_unavailable") return <div className="rmtSearchStatus isDelayed" role="status">Expanded search unavailable: canonical inventory is delayed.</div>;
  if (status === "candidate_discovery_unavailable") return <div className="rmtSearchStatus isDelayed" role="status">Expanded text search unavailable. Loaded markets remain available.</div>;
  if (status === "invalid_query") return <div className="rmtSearchStatus isDelayed" role="status">Enter a valid token, contract, or pool identity.</div>;
  return <div className="rmtSearchStatus isDelayed" role="status">Expanded search unavailable. Loaded markets remain available.</div>;
}

function MarketCategoryNav({ view, counts, searchActive, activityCoveragePending, onChange }: {
  view: VNextMarketDirectoryView;
  counts: Record<VNextMarketDirectoryView, number>;
  searchActive: boolean;
  activityCoveragePending: boolean;
  onChange: (view: VNextMarketDirectoryView) => void;
}) {
  return <nav className="rmtMarketViews" aria-label="Market categories">
    {VNEXT_MARKET_DIRECTORY_VIEWS.map((candidate) => <button
      className={!searchActive && candidate.id === view ? "isActive" : ""}
      type="button"
      key={candidate.id}
      aria-pressed={!searchActive && candidate.id === view}
      onClick={() => onChange(candidate.id)}
    ><span>{candidate.label}</span><small>{activityCoveragePending && candidate.id === "active" ? "…" : counts[candidate.id]}</small></button>)}
  </nav>;
}

function DirectoryMessage({ status, count, searchActive, view, onRefresh }: {
  status: DirectoryStatus;
  count: number;
  searchActive: boolean;
  view: VNextMarketDirectoryView;
  onRefresh: () => void;
}) {
  if (status === "loading" && count === 0) return <div className="rmtDirectoryMessage"><strong>Syncing markets…</strong><span>Loading Robinhood Chain directory data without prechecking routes.</span></div>;
  if (status === "error" && count === 0) return <div className="rmtDirectoryMessage"><strong>Market data delayed</strong><span>No asset has been marked untradeable.</span><button type="button" onClick={onRefresh}>Try again</button></div>;
  if (count === 0) return <div className="rmtDirectoryMessage"><strong>{searchActive ? "No matching markets" : `No ${view === "held" ? "wallet-held" : view} markets yet`}</strong><span>{searchActive ? "Search by name, symbol, token contract, pool contract, or V4 PoolId." : "Choose another category or use exact contract search."}</span></div>;
  return null;
}

function LoadMore({ visibleCount, totalCount, hasMore, onLoadMore }: { visibleCount: number; totalCount: number; hasMore: boolean; onLoadMore: () => void }) {
  const remaining = Math.max(0, totalCount - visibleCount);
  if (!remaining && !hasMore) return null;
  return <button className="rmtMarketLoadMore" type="button" onClick={onLoadMore}>{remaining ? `Load ${Math.min(VNEXT_MARKET_DIRECTORY_PAGE_SIZE, remaining)} more` : "Load more markets"} <span>{remaining ? `${remaining} remaining` : "Continue canonical inventory"}</span></button>;
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
        <span className="rmtMarketTokenCell" role="cell"><TokenArtwork className="rmtMarketArtwork" symbol={market.symbol} imageUrl={market.imageUri} /><span><strong>{market.symbol}</strong><small>{market.name}</small>{props.searchActive ? <code className="rmtSearchContract">{market.address}</code> : null}</span></span>
        <strong role="cell">{formatUsd(market.priceUsd)}</strong>
        <strong className={changeClass(market.priceChange24h)} role="cell">{formatChange(market.priceChange24h)}</strong>
        <span role="cell">{compactUsd(market.marketCapUsd)}</span>
        <span role="cell">{compactUsd(market.volume24h)}</span>
        <span role="cell">{compactUsd(market.liquidityUsd)}</span>
        <span role="cell">{formatAge(market.ageMinutes)}</span>
        <span role="cell"><RwaLabel market={market} /></span>
      </button>)}
    </div>
    <SearchStatusMessage status={props.searchStatus} count={props.expandedSearchResultCount} />
    <DirectoryMessage status={props.directoryStatus} count={props.visibleMarkets.length} searchActive={props.searchActive} view={props.directoryView} onRefresh={props.onRefresh} />
    <LoadMore visibleCount={props.visibleMarkets.length} totalCount={props.filteredMarkets.length} hasMore={props.hasMoreDirectoryMarkets} onLoadMore={props.onLoadMoreMarkets} />
  </div>;
}

function CompactMarketNavigator(props: TerminalPresentationProps) {
  return <aside className="rmtAssetNavigator" aria-label="Market navigator">
    <header><strong>Markets</strong><button type="button" onClick={props.onShowMarkets}>Full scanner</button></header>
    <MarketCategoryNav view={props.directoryView} counts={props.directoryViewCounts} searchActive={props.searchActive} activityCoveragePending={props.activityCoveragePending} onChange={props.onDirectoryViewChange} />
    <div className="rmtCompactMarketList">
      {props.visibleMarkets.map((market) => <button className={props.selected?.address === market.address ? "isSelected" : ""} type="button" key={market.address} aria-pressed={props.selected?.address === market.address} onClick={() => props.onSelectMarket(market.address)}>
        <TokenArtwork className="rmtMarketArtwork" symbol={market.symbol} imageUrl={market.imageUri} />
        <span><strong>{market.symbol}</strong><small>{formatUsd(market.priceUsd)}</small></span>
        <b className={changeClass(market.priceChange24h)}>{formatChange(market.priceChange24h)}</b>
      </button>)}
    </div>
    <SearchStatusMessage status={props.searchStatus} count={props.expandedSearchResultCount} />
    <DirectoryMessage status={props.directoryStatus} count={props.visibleMarkets.length} searchActive={props.searchActive} view={props.directoryView} onRefresh={props.onRefresh} />
  </aside>;
}

function MobileMarketList(props: TerminalPresentationProps) {
  return <div className="rmtMobileMarketList">
    {props.visibleMarkets.map((market) => <button className="rmtMobileMarketRow" type="button" key={market.address} onClick={() => props.onSelectMarket(market.address)}>
      <TokenArtwork className="rmtMarketArtwork" symbol={market.symbol} imageUrl={market.imageUri} />
      <span className="rmtMobileMarketIdentity"><span><strong>{market.symbol}</strong><RwaLabel market={market} /></span><small>{market.name}</small>{props.searchActive ? <code className="rmtSearchContract">{market.address}</code> : null}</span>
      <span className="rmtMobileMarketPrice"><strong>{formatUsd(market.priceUsd)}</strong><small className={changeClass(market.priceChange24h)}>{formatChange(market.priceChange24h)}</small></span>
      <span className="rmtMobileMarketMeta">M {compactUsd(market.marketCapUsd)} · V {compactUsd(market.volume24h)} · {formatAge(market.ageMinutes)}</span>
    </button>)}
    <SearchStatusMessage status={props.searchStatus} count={props.expandedSearchResultCount} />
    <DirectoryMessage status={props.directoryStatus} count={props.visibleMarkets.length} searchActive={props.searchActive} view={props.directoryView} onRefresh={props.onRefresh} />
    <LoadMore visibleCount={props.visibleMarkets.length} totalCount={props.filteredMarkets.length} hasMore={props.hasMoreDirectoryMarkets} onLoadMore={props.onLoadMoreMarkets} />
  </div>;
}

function TradeComposer(props: TerminalPresentationProps) {
  if (props.executionUiState === "asset-only") {
    return <aside className="vnTradePanel" id="vnext-trade-ticket" aria-labelledby="vn-trade-heading">
      <div className="vnTradeHeader">
        <div><span className="vnEyebrow">Asset identity</span><h2 id="vn-trade-heading">Market evidence unavailable</h2><small>{props.selected?.name ?? "Verified Robinhood Chain asset"}</small></div>
        <span className="vnFixtureBadge isViewOnly">Asset only</span>
      </div>
      <p className="vnTradeSafety">RMT verified this asset onchain, but no supported market evidence is attached. Metrics, chart activity, and execution are not evaluated.</p>
    </aside>;
  }
  return <TradeIntentComposer
    marketName={props.selected?.name ?? "No market selected"}
    marketSymbol={props.selected?.symbol ?? "—"}
    marketAsset={props.selectedAsset}
    walletAssets={props.walletAssets}
    nativeBalance={props.nativeBalance}
    executionRecord={props.executionRecord}
    onContinueTrading={props.onContinueTrading}
    sideRequest={props.tradeSideRequest}
    executionState={props.selectedExecutionState}
    executionUiState={props.executionUiState}
    canonicalMarket={props.selected ? selectVNextCanonicalMarket(props.selected) : undefined}
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
    <MarketSearch id="rmt-desktop-market-search" query={props.query} setQuery={props.setQuery} inputRef={props.marketSearch} onSubmit={props.onSearchSubmit} searchStatus={props.searchStatus} />
    <span className="rmtChainState"><i aria-hidden="true" /> Robinhood · 4663</span>
    <VNextWalletConnection />
  </header>;
}

function DesktopMarkets(props: TerminalPresentationProps) {
  return <section className="rmtDesktopMarketsView" id="rmt-markets" aria-labelledby="rmt-market-directory-heading">
    <header className="rmtMarketsHeading"><div><h1 id="rmt-market-directory-heading">Markets</h1><p>Robinhood Chain market intelligence</p></div><span className={`rmtDirectoryFreshness is${props.directoryStatus}`}><i aria-hidden="true" />{props.directoryStatus === "ready" ? "Directory ready" : props.directoryStatus === "stale" ? "Last loaded data" : props.directoryStatus === "loading" ? "Syncing" : "Delayed"}</span></header>
    <div className="rmtScannerControls"><MarketCategoryNav view={props.directoryView} counts={props.directoryViewCounts} searchActive={props.searchActive} activityCoveragePending={props.activityCoveragePending} onChange={props.onDirectoryViewChange} /><span>{props.activityCoveragePending ? `${props.filteredMarkets.length} canonical markets · activity enrichment pending` : `${props.filteredMarkets.length} in view · routes checked on demand`}</span></div>
    <DesktopMarketTable {...props} />
    <VNextChainPulseCard />
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
        {props.selected ? <VNextAssetWorkspace presentation="desktop" directoryMarket={props.selected} identityStatus={props.identityStatus} walletAssets={props.walletAssets} executionState={props.selectedExecutionState} executionUiState={props.executionUiState} onTradeSide={requestTrade} /> : <div className="rmtEmptyWorkspace"><strong>Select a market</strong><span>RMT does not invent asset or route data.</span></div>}
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
    <VNextDistributionPlanner presentation="desktop" />
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
    <header className="rmtMobileContextHeading"><div><h1 id="rmt-mobile-markets-heading">Markets</h1><p>Robinhood Chain</p></div><span>{props.directoryStatus === "ready" ? "Directory ready" : props.directoryStatus === "stale" ? "Last loaded" : props.directoryStatus === "loading" ? "Syncing" : "Delayed"}</span></header>
    <MarketCategoryNav view={props.directoryView} counts={props.directoryViewCounts} searchActive={props.searchActive} activityCoveragePending={props.activityCoveragePending} onChange={props.onDirectoryViewChange} />
    {props.activityCoveragePending ? <p className="rmtSearchStatus" role="status">Canonical markets ready · activity enrichment pending</p> : null}
    <MarketSearch id="rmt-mobile-market-search" query={props.query} setQuery={props.setQuery} inputRef={props.marketSearch} onSubmit={props.onSearchSubmit} searchStatus={props.searchStatus} />
    <MobileMarketList {...props} />
    <VNextChainPulseCard />
  </section>;
}

function MobileAsset(props: TerminalPresentationProps) {
  return <section className="rmtMobileAssetView" id="rmt-mobile-asset">
    <div className="rmtMobileAssetBack"><button type="button" onClick={props.onShowMarkets}>← Markets</button><span>{props.selected?.symbol ?? "Asset"}</span></div>
    {props.selected ? <VNextAssetWorkspace presentation="mobile" directoryMarket={props.selected} identityStatus={props.identityStatus} walletAssets={props.walletAssets} executionState={props.selectedExecutionState} executionUiState={props.executionUiState} onTradeSide={props.onRequestTradeSide} /> : <div className="rmtEmptyWorkspace"><strong>Select a market</strong><span>Live market intelligence will appear here.</span></div>}
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
    <VNextDistributionPlanner presentation="mobile" />
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
    {props.context === "asset" && props.selected ? <nav className={`rmtMobileTradeDock${props.executionUiState === "stock-token-view-only" || props.executionUiState === "asset-only" ? " isViewOnly" : ""}`} aria-label={props.executionUiState === "stock-token-view-only" ? `${props.selected.symbol} execution policy` : props.executionUiState === "asset-only" ? `${props.selected.symbol} market evidence` : props.executionUiState === "preview-only" ? `Preview ${props.selected.symbol} routes` : `Trade ${props.selected.symbol}`}>
      {props.executionUiState === "stock-token-view-only" ? <>
        <button type="button" className="isViewOnly" disabled aria-describedby="rmt-stock-token-view-only">View only</button>
        <span className="vnSrOnly" id="rmt-stock-token-view-only">Official Robinhood Stock Tokens are view-only in RMT until jurisdiction controls are available.</span>
      </> : props.executionUiState === "asset-only" ? <>
        <button type="button" className="isViewOnly" disabled aria-describedby="rmt-asset-only">Asset only</button>
        <span className="vnSrOnly" id="rmt-asset-only">Onchain identity is verified. No supported market evidence is attached, so execution is not evaluated.</span>
      </> : <>
        <button type="button" className="isBuy" onClick={() => openTrade("buy")}>{props.executionUiState === "preview-only" ? "Buy quote" : "Buy"}</button>
        <button type="button" className="isSell" disabled={!canSell} aria-describedby={!canSell ? "rmt-sell-unavailable" : undefined} onClick={() => openTrade("sell")}>{props.executionUiState === "preview-only" ? "Sell quote" : "Sell"}</button>
        {!canSell ? <span className="vnSrOnly" id="rmt-sell-unavailable">No confirmed balance available to sell.</span> : null}
      </>}
    </nav> : null}
    <div className={`rmtMobileSheetLayer${props.tradeOpen ? " isOpen" : ""}`} aria-hidden={!props.tradeOpen}>
      <button className="rmtMobileSheetBackdrop" type="button" aria-label="Close trade sheet" tabIndex={props.tradeOpen ? 0 : -1} onClick={closeSheet} />
      <div className="rmtMobileTradeSheet" ref={sheet} role="dialog" aria-modal="true" aria-label={props.selected ? `${props.executionUiState === "preview-only" ? "Preview" : "Trade"} ${props.selected.symbol}` : "Trade selected asset"} onKeyDown={preventEscapePropagation}>
        <header><span>{props.executionUiState === "preview-only" ? "Trade preview" : "Verified trade"}</span><button type="button" aria-label="Close trade sheet" onClick={closeSheet}>×</button></header>
        <div className="rmtMobileTradeSheetScroll"><TradeComposer {...props} /></div>
      </div>
    </div>
  </main>;
}
