"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { WalletButton } from "../wallet-button";
import { SpendBalance } from "./spend-balance";
import { TradeIntentComposer } from "./trade-intent-composer";
import { VNextExecutionRecoveryBanner } from "./vnext-execution-recovery-banner";
import { useVNextExecutionRecovery } from "./use-vnext-execution-recovery";
import { useVNextMarketDirectory } from "./use-vnext-market-directory";

const navItems = [
  { label: "Terminal", icon: "⌂" },
  { label: "Markets", icon: "⌕" },
  { label: "Portfolio", icon: "◫" },
  { label: "Activity", icon: "↗" }
];

function MarketMark({ symbol }: { symbol: string }) {
  return <span className={`vnMarketMark vnMarketMark${symbol}`} aria-hidden="true">{symbol.slice(0, 1)}</span>;
}

function formatUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function formatCompactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatChange(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

function formatAge(minutes: number | null) {
  if (minutes === null) return "Unknown";
  if (minutes < 60) return `${Math.max(1, Math.floor(minutes))}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1_440)}d`;
}

export function VNextTerminalShell() {
  const [query, setQuery] = useState("");
  const [walletAssets, setWalletAssets] = useState<VNextDetectedWalletAsset[]>([]);
  const marketSearch = useRef<HTMLInputElement>(null);
  const executionRecovery = useVNextExecutionRecovery();
  const { markets, status, selected, selectedAsset, identityStatus, setSelectedAddress, refresh } = useVNextMarketDirectory();
  const filteredMarkets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = !normalized ? markets : markets.filter((market) =>
      `${market.symbol} ${market.name} ${market.address}`.toLowerCase().includes(normalized)
    );
    return matches.slice(0, 8);
  }, [markets, query]);
  const continueTrading = useCallback(() => {
    setQuery("");
    window.requestAnimationFrame(() => {
      marketSearch.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      marketSearch.current?.focus({ preventScroll: true });
    });
  }, []);

  return (
    <main className="rmtVnext">
      <a className="vnSkipLink" href="#vnext-workspace">Skip to trading workspace</a>
      <aside className="vnSidebar" aria-label="VNext navigation">
        <Link className="vnBrand" href="/" aria-label="Return to the current RMT terminal">
          <Image src="/brand/rmt-master-logo.png" alt="" width={42} height={42} priority />
          <span><strong>RMT</strong><small>Terminal</small></span>
        </Link>
        <nav className="vnPrimaryNav">
          {navItems.map((item, index) => (
            <button className={index === 0 ? "isActive" : ""} type="button" key={item.label}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="vnSidebarFoot">
          <span className="vnNetworkDot" aria-hidden="true" />
          <span><strong>Robinhood Chain</strong><small>Mainnet · 4663</small></span>
        </div>
      </aside>

      <div className="vnApp">
        <header className="vnTopbar">
          <div className="vnMobileBrand">
            <Image src="/brand/rmt-master-logo.png" alt="" width={36} height={36} priority />
            <strong>RMT</strong>
          </div>
          <div className="vnTopbarTitle">
            <span className="vnPreviewPill">VNext preview</span>
            <span className="vnChainLabel"><i aria-hidden="true" /> Robinhood Chain</span>
          </div>
          <div className="vnTopbarActions">
            <button className="vnIconButton" type="button" aria-label="Open notifications">○<span className="vnUnread" /></button>
            <WalletButton target="mainnet" showFunding={false} returnTo="/vnext" />
          </div>
        </header>

        <div className="vnCanvas" id="vnext-workspace">
          <SpendBalance markets={markets} onAssetsChange={setWalletAssets} executionRecord={executionRecovery.record} />
          <VNextExecutionRecoveryBanner record={executionRecovery.record} status={executionRecovery.status} />

          <div className="vnWorkspaceGrid">
            <section className="vnMarketPanel" aria-labelledby="vn-markets-heading">
              <div className="vnSectionHeading">
                <div><span className="vnEyebrow">Discover</span><h1 id="vn-markets-heading">Markets</h1></div>
                <button className="vnFilterButton" type="button">Trending <span aria-hidden="true">⌄</span></button>
              </div>
              <label className="vnSearch">
                <span aria-hidden="true">⌕</span>
                <span className="vnSrOnly">Search markets</span>
                <input ref={marketSearch} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset or address" />
                <kbd>/</kbd>
              </label>
              <div className="vnMarketTabs" role="tablist" aria-label="Market categories">
                <button className="isActive" type="button" role="tab" aria-selected="true">Trending</button>
                <button type="button" role="tab" aria-selected="false">New</button>
                <button type="button" role="tab" aria-selected="false">Watchlist</button>
              </div>
              <div className="vnMarketList" aria-live="polite">
                {status === "loading" && markets.length === 0 && <div className="vnNoResults"><strong>Syncing markets</strong><span>Loading the fast directory. Routes are not being checked.</span></div>}
                {status === "error" && markets.length === 0 && <div className="vnNoResults"><strong>Directory unavailable</strong><span>Market data could not be loaded. No asset has been marked untradeable.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>}
                {filteredMarkets.map((market) => (
                  <button
                    className={`vnMarketRow${selected?.address === market.address ? " isSelected" : ""}`}
                    key={market.address}
                    type="button"
                    onClick={() => setSelectedAddress(market.address)}
                    aria-pressed={selected?.address === market.address}
                  >
                    <MarketMark symbol={market.symbol} />
                    <span className="vnMarketIdentity"><strong>{market.symbol}</strong><small>{market.name}</small></span>
                    <span className="vnMarketPrice"><strong>{formatUsd(market.priceUsd)}</strong><small className={market.priceChange24h > 0 ? "vnPositive" : market.priceChange24h < 0 ? "vnNegative" : ""}>{formatChange(market.priceChange24h)}</small></span>
                    <span className={`vnSignal vnSignal${market.signal === "moving" ? "positive" : market.signal === "early" ? "warning" : "neutral"}`}><i aria-hidden="true" />{market.signal}</span>
                  </button>
                ))}
                {status !== "loading" && markets.length > 0 && filteredMarkets.length === 0 && <div className="vnNoResults"><strong>No matching assets</strong><span>Try a symbol, name, or contract address.</span></div>}
              </div>
              <Link className="vnViewAll" href="/">Open current market directory <span aria-hidden="true">→</span></Link>
            </section>

            {selected ? <section className="vnAssetPanel" aria-labelledby="vn-asset-heading">
              <div className="vnAssetHeader">
                <div className="vnAssetIdentity">
                  <MarketMark symbol={selected.symbol} />
                  <div><span><h2 id="vn-asset-heading">{selected.name}</h2><b>{selected.symbol}</b></span><small>Robinhood Chain · {identityStatus === "verified" ? "Verified identity" : identityStatus === "checking" ? "Identity checking" : "Detected asset"}</small></div>
                </div>
                <button className="vnStarButton" type="button" aria-label={`Add ${selected.symbol} to watchlist`}>☆</button>
              </div>
              <div className="vnPriceHeader">
                <div><strong>{formatUsd(selected.priceUsd)}</strong><span className={selected.priceChange24h > 0 ? "vnPositive" : selected.priceChange24h < 0 ? "vnNegative" : ""}>{formatChange(selected.priceChange24h)} <small>24h</small></span></div>
                <Link className="vnOpenChart" href={`/market/${selected.address}`}>Open live chart <span aria-hidden="true">↗</span></Link>
              </div>
              <div className="vnChartPending">
                <span className="vnEyebrow">Price history</span>
                <strong>No synthetic chart</strong>
                <small>Live candles load in the current market workspace.</small>
                <Link href={`/market/${selected.address}`}>Open verified market data <span aria-hidden="true">→</span></Link>
              </div>
              <dl className="vnAssetStats">
                <div><dt>Market cap</dt><dd>{formatCompactUsd(selected.marketCapUsd)}</dd></div>
                <div><dt>Liquidity</dt><dd>{formatCompactUsd(selected.liquidityUsd)}</dd></div>
                <div><dt>24h volume</dt><dd>{formatCompactUsd(selected.volume24h)}</dd></div>
                <div><dt>Market age</dt><dd>{formatAge(selected.ageMinutes)}</dd></div>
              </dl>
              <div className="vnEvidence">
                <div><span className="vnEvidenceIcon" aria-hidden="true">{identityStatus === "verified" ? "✓" : identityStatus === "checking" ? "…" : "!"}</span><span><strong>{identityStatus === "verified" ? "Identity verified" : identityStatus === "checking" ? "Checking identity" : "Identity not verified"}</strong><small>{identityStatus === "verified" ? "Chain, contract, and decimals confirmed" : identityStatus === "checking" ? "One selected-asset contract lookup" : "Execution remains blocked"}</small></span></div>
                <Link href={`/market/${selected.address}`}>View market evidence <span aria-hidden="true">→</span></Link>
              </div>
            </section> : <section className="vnAssetPanel vnAssetEmpty" aria-label="Market detail"><strong>{status === "loading" ? "Syncing market directory" : "Select a market"}</strong><span>No price, identity, or execution claims are shown until real directory data is available.</span></section>}

            <TradeIntentComposer
              marketName={selected?.name ?? "No market selected"}
              marketSymbol={selected?.symbol ?? "—"}
              marketAsset={selectedAsset}
              walletAssets={walletAssets}
              executionRecord={executionRecovery.record}
              onContinueTrading={continueTrading}
            />
          </div>
        </div>
      </div>

      <nav className="vnMobileDock" aria-label="VNext mobile navigation">
        {navItems.map((item, index) => <button className={index === 0 ? "isActive" : ""} type="button" key={item.label}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
      </nav>
    </main>
  );
}
