"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ExternalMarket, ExternalMarketResponse } from "../lib/external-market";
import type { ExternalMarketRiskFlag, ExternalMarketSignal } from "../lib/external-market-ranking";

type FeedStatus = "loading" | "ready" | "stale" | "error";

type RunnerView = "moving" | "early" | "active";

const VIEWS: Array<{ id: RunnerView; label: string }> = [
  { id: "moving", label: "Moving now" },
  { id: "early", label: "Early signals" },
  { id: "active", label: "All active" }
];
const DATA_REFRESH_MS = 30_000;
const RANK_REFRESH_MS = 60_000;
const MAX_VISIBLE_MARKETS = 4;

function money(value: number, price = false) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (price && value < 0.0001) {
    return "$" + value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  return "$" + value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: price ? 6 : 0
  });
}

function cleanSymbol(symbol: string) {
  return symbol.split("$").join("");
}

function initials(symbol: string) {
  return cleanSymbol(symbol).slice(0, 2).toUpperCase() || "↗";
}

function signalLabel(signal: ExternalMarketSignal) {
  if (signal === "moving") return "Moving now";
  if (signal === "early") return "Early signal";
  return "Active";
}

function valuation(market: ExternalMarket) {
  if (market.marketCapUsd > 0) return { label: "Market cap", value: market.marketCapUsd };
  if (market.fdvUsd > 0) return { label: "FDV", value: market.fdvUsd };
  return { label: "Valuation", value: 0 };
}

const RISK_LABELS: Record<ExternalMarketRiskFlag, string> = {
  "thin-liquidity": "Thin liquidity",
  "extreme-price-spike": "Price spike",
  "high-volume-low-trades": "Volume anomaly",
  "very-new-low-activity": "Very new",
  "one-sided-activity": "One-sided flow"
};

function riskSummary(flags: ExternalMarketRiskFlag[]) {
  const first = RISK_LABELS[flags[0] ?? "thin-liquidity"];
  return flags.length > 1 ? first + " +" + (flags.length - 1) : first;
}

function originLabel(market: ExternalMarket) {
  const origin = market.origin;
  if (!origin) return "External · Origin unknown";
  if (origin.kind === "rmt-v6") return "RMT V6 · Protocol verified";
  if (origin.state === "attributed") return origin.sourceName + " · Origin verified";
  if (origin.state === "disputed") return "Origin conflict";
  if (origin.state === "unattributed") return "External · No verified origin";
  return "External · Origin unknown";
}

function snapshotTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "an earlier update";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}


type ExternalTradeSide = "buy" | "sell";

function isTradeableAddress(address: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

function isUniswapVenue(market: ExternalMarket) {
  const venue = (market.venue?.dexId ?? market.dexId).trim().toLowerCase();
  return venue === "uniswap" || venue.startsWith("uniswap-");
}

function canHandoffToUniswap(market: ExternalMarket) {
  return isTradeableAddress(market.address) && isUniswapVenue(market);
}

function uniswapSwapUrl(market: ExternalMarket, side: ExternalTradeSide) {
  const inputCurrency = side === "buy" ? "NATIVE" : market.address;
  const outputCurrency = side === "buy" ? market.address : "NATIVE";
  return "https://app.uniswap.org/swap?chain=robinhood&inputCurrency="
    + encodeURIComponent(inputCurrency)
    + "&outputCurrency="
    + encodeURIComponent(outputCurrency);
}

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function ExternalTradeDialog({
  market,
  side,
  delayed,
  onClose,
  returnFocusTo
}: {
  market: ExternalMarket;
  side: ExternalTradeSide;
  delayed: boolean;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const value = valuation(market);
  const venue = market.venue?.dexId ?? market.dexId;
  const reviewUrl = uniswapSwapUrl(market, side);
  const sideLabel = side === "buy" ? "Buy" : "Sell";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;

      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    closeButton.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.setTimeout(() => returnFocusTo?.focus(), 0);
    };
  }, [onClose, returnFocusTo]);

  return <>
    <button className="quickTradeBackdrop" type="button" aria-label="Close external trade review" onClick={onClose} />
    <section
      ref={dialog}
      className="quickTradeDialog"
      role="dialog"
      aria-modal="true"
      aria-label={sideLabel + " " + market.name}
      tabIndex={-1}
    >
      <header className="quickTradeHeader">
        <div className="quickTradeIdentity">
          <div className="coin externalArtwork" aria-hidden="true">{initials(market.symbol)}</div>
          <span>
            <small>EXTERNAL MARKET · UNISWAP REVIEW</small>
            <strong>{market.name}</strong>
            <em>{"$" + cleanSymbol(market.symbol) + " · " + sideLabel}</em>
          </span>
        </div>
        <div className="quickTradeHeaderActions">
          <a href={market.url} target="_blank" rel="noopener noreferrer">Chart ↗</a>
          <button ref={closeButton} type="button" aria-label="Close external trade review" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="quickTradeBody">
        <article className="externalMarketCard runnerMarketCard">
          <div className="runnerCardStatus">
            <span className={"marketSignal " + market.signal}>{signalLabel(market.signal)}</span>
            <span>Venue: {venue}</span>
          </div>
          <div className="externalIdentity">
            <span className="coin externalArtwork" aria-hidden="true">{initials(market.symbol)}</span>
            <span>
              <strong>{market.name}</strong>
              <small>{"$" + cleanSymbol(market.symbol)}</small>
            </span>
            <em>{originLabel(market)}</em>
          </div>
          <div className="runnerStats">
            <span><small>{value.label}</small><strong>{money(value.value)}</strong></span>
            <span><small>Live price</small><strong>{money(market.priceUsd, true)}</strong></span>
            <span><small>1h volume</small><strong>{money(market.volume1h)}</strong></span>
            <span><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong></span>
          </div>
          <div className="runnerActivity">
            <span>{"Token " + shortAddress(market.address) + " · Pool " + shortAddress(market.pairAddress)}</span>
            {market.riskFlags.length > 0 && <em>{riskSummary(market.riskFlags)}</em>}
          </div>
          {delayed && <p className="runnerDataNotice"><span>Runner data is delayed. Uniswap will calculate a fresh route and quote before any wallet confirmation.</span></p>}
          <p className="externalDisclosure">
            This token is external and its launchpad origin is not yet verified by RMT. Uniswap provides the final route, quote, price impact, and transaction review. RMT does not custody funds or construct external swap calldata in this release.
          </p>
          <div className="externalMarketActions externalTradeReviewAction">
            <a
              className={side === "buy" ? "buyCardAction" : "sellCardAction"}
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {"Review " + sideLabel + " on Uniswap ↗"}
            </a>
          </div>
        </article>
      </div>

      <footer className="quickTradeFooter">
        <span>Fresh Uniswap quote required</span>
        <span>Wallet confirmation required</span>
        <span>RMT never controls your funds</span>
      </footer>
    </section>
  </>;
}

function stabilizeOrder(order: string[], markets: ExternalMarket[]) {
  const byAddress = new Map(markets.map((market) => [market.address.toLowerCase(), market]));
  const ordered = order.flatMap((address) => {
    const market = byAddress.get(address);
    return market ? [market] : [];
  });
  const known = new Set(ordered.map((market) => market.address.toLowerCase()));
  ordered.push(...markets.filter((market) => !known.has(market.address.toLowerCase())));
  return ordered;
}

export function ExternalMarketFeed() {
  const [markets, setMarkets] = useState<ExternalMarket[]>([]);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [view, setView] = useState<RunnerView>("moving");
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [rankingAnnouncement, setRankingAnnouncement] = useState("");
  const nextRankRefresh = useRef(0);
  const rankInitialized = useRef(false);
  const hasSuccessfulData = useRef(false);
  const restoredQuickTrade = useRef(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const runnerHeading = useRef<HTMLHeadingElement>(null);
  const [quickTrade, setQuickTrade] = useState<{ address: string; side: ExternalTradeSide }>();
  const [tradeAnnouncement, setTradeAnnouncement] = useState("");
  const [marketQuery, setMarketQuery] = useState("");
  const [showAllMarkets, setShowAllMarkets] = useState(false);

  const syncQuickTradeUrl = useCallback((market?: ExternalMarket, side?: ExternalTradeSide) => {
    const url = new URL(window.location.href);
    if (market && side) {
      url.searchParams.delete("quickTrade");
      url.searchParams.delete("side");
      url.searchParams.set("externalTrade", market.address);
      url.searchParams.set("externalSide", side);
      url.hash = "runner-radar";
    } else {
      url.searchParams.delete("externalTrade");
      url.searchParams.delete("externalSide");
    }
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []);

  const openQuickTrade = useCallback((market: ExternalMarket, side: ExternalTradeSide) => {
    if (!canHandoffToUniswap(market)) return;
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : runnerHeading.current;
    setTradeAnnouncement("");
    setQuickTrade({ address: market.address, side });
    syncQuickTradeUrl(market, side);
  }, [syncQuickTradeUrl]);

  const closeQuickTrade = useCallback(() => {
    setQuickTrade(undefined);
    syncQuickTradeUrl();
  }, [syncQuickTradeUrl]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/external", { cache: "no-store" });
      const payload = (await response.json()) as ExternalMarketResponse;
      if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error || "Market data unavailable.");

      const now = Date.now();
      setMarkets(payload.markets);
      setUpdatedAt(typeof payload.updatedAt === "string" ? payload.updatedAt : new Date(now).toISOString());
      hasSuccessfulData.current = true;
      if (nextRankRefresh.current <= now || !rankInitialized.current) {
        setRankOrder(payload.markets.map((market) => market.address.toLowerCase()));
        rankInitialized.current = true;
        nextRankRefresh.current = now + RANK_REFRESH_MS;
        setRankingAnnouncement(payload.stale ? "Runner data is delayed." : "Runner rankings updated.");
      }
      setStatus(payload.stale ? "stale" : "ready");
    } catch {
      setStatus(hasSuccessfulData.current ? "stale" : "error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), DATA_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (restoredQuickTrade.current || status === "loading") return;
    restoredQuickTrade.current = true;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("externalTrade")?.toLowerCase();
    const side = params.get("externalSide");
    if (!token && !side) return;
    if (params.has("quickTrade")) {
      syncQuickTradeUrl();
      setTradeAnnouncement("The RMT launch trade was kept open; the conflicting external review was cleared.");
      return;
    }
    if (!token || (side !== "buy" && side !== "sell")) {
      syncQuickTradeUrl();
      setTradeAnnouncement("The external trade review link was incomplete and was cleared.");
      return;
    }
    const market = markets.find((item) => item.address.toLowerCase() === token);
    if (!market || !canHandoffToUniswap(market)) {
      syncQuickTradeUrl();
      setTradeAnnouncement("That external market is no longer available for Uniswap review.");
      return;
    }
    returnFocusTo.current = runnerHeading.current;
    setQuickTrade({ address: market.address, side });
  }, [markets, status, syncQuickTradeUrl]);

  const selectedQuickTradeMarket = useMemo(
    () => quickTrade
      ? markets.find((market) => market.address.toLowerCase() === quickTrade.address.toLowerCase())
      : undefined,
    [markets, quickTrade]
  );

  useEffect(() => {
    if (!quickTrade) return;
    if (selectedQuickTradeMarket && canHandoffToUniswap(selectedQuickTradeMarket)) return;
    setQuickTrade(undefined);
    syncQuickTradeUrl();
    setTradeAnnouncement("The external market changed or left the eligible feed, so its trade review was closed.");
    window.setTimeout(() => runnerHeading.current?.focus(), 0);
  }, [quickTrade, selectedQuickTradeMarket, syncQuickTradeUrl]);

  const orderedMarkets = useMemo(() => stabilizeOrder(rankOrder, markets), [markets, rankOrder]);
  const counts = useMemo(() => ({
    moving: markets.filter((market) => market.signal === "moving").length,
    early: markets.filter((market) => market.signal === "early").length,
    active: markets.length
  }), [markets]);
  const normalizedMarketQuery = marketQuery.trim().toLowerCase();
  const rankByAddress = useMemo(
    () => new Map(
      orderedMarkets.map((market, index) => [
        market.address.toLowerCase(),
        index + 1
      ])
    ),
    [orderedMarkets]
  );
  const viewMarkets = orderedMarkets.filter(
    (market) => view === "active" || market.signal === view
  );
  const filteredMarkets = normalizedMarketQuery
    ? orderedMarkets.filter((market) => [
        market.name,
        market.symbol,
        market.address,
        market.pairAddress
      ].some((value) => value.toLowerCase().includes(normalizedMarketQuery)))
    : viewMarkets;
  const expandedDirectory =
    showAllMarkets || normalizedMarketQuery.length > 0;
  const visibleMarkets = expandedDirectory
    ? filteredMarkets
    : filteredMarkets.slice(0, MAX_VISIBLE_MARKETS);
  const marketCountLabel = normalizedMarketQuery
    ? filteredMarkets.length + " match" + (filteredMarkets.length === 1 ? "" : "es")
    : showAllMarkets
      ? "Showing all " + filteredMarkets.length
      : "Top " + Math.min(MAX_VISIBLE_MARKETS, filteredMarkets.length) +
        " of " + filteredMarkets.length;

  const changeView = (nextView: RunnerView) => {
    setView(nextView);
    setMarketQuery("");
    setShowAllMarkets(false);
  };
  const handleMarketQueryChange = (value: string) => {
    setMarketQuery(value);
    if (value.trim()) {
      setView("active");
      setShowAllMarkets(false);
    }
  };
  const handleDirectoryAction = () => {
    if (normalizedMarketQuery) {
      setMarketQuery("");
      return;
    }
    if (showAllMarkets) {
      setShowAllMarkets(false);
      return;
    }
    setView("active");
    setShowAllMarkets(true);
  };
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentView: RunnerView) => {
    const currentIndex = VIEWS.findIndex((item) => item.id === currentView);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % VIEWS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + VIEWS.length) % VIEWS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = VIEWS.length - 1;
    else return;
    event.preventDefault();
    const nextView = VIEWS[nextIndex].id;
    changeView(nextView);
    document.getElementById("runner-tab-" + nextView)?.focus();
  };

  return (
    <section className="panel externalMarkets runnerRadar" id="runner-radar" aria-labelledby="external-markets-title">
      <div className="feedHeading externalHeading">
        <div>
          <p className="eyebrow">ROBINHOOD CHAIN · RUNNER RADAR</p>
          <h2 id="external-markets-title" ref={runnerHeading} tabIndex={-1}>Markets showing movement</h2>
          <p>Active Robinhood Chain markets discovered through WETH and USDG pairs. Top signals stay focused by default; search or browse every qualified market without losing the live ranking.</p>
        </div>
        <span className="externalBadge">{status === "stale" ? "DATA DELAYED" : "RECENT DATA · 60S RANKS"}</span>
      </div>

      <p className="srOnly" aria-live="polite">{rankingAnnouncement}</p>
      <p className="srOnly" aria-live="polite">{tradeAnnouncement}</p>
      {status === "stale" && (
        <p className="runnerDataNotice" role="status">
          <span>Data delayed · showing the last successful snapshot{updatedAt ? " from " + snapshotTime(updatedAt) : ""}. RMT launches and trading are unaffected.</span>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </p>
      )}
      <div className="runnerDirectoryControls" role="search" aria-label="Search external markets">
        <div className="runnerMarketSearch">
          <span aria-hidden="true">⌕</span>
          <label className="srOnly" htmlFor="external-market-search">Search external markets by name, ticker, or contract</label>
          <input
            id="external-market-search"
            type="search"
            value={marketQuery}
            onChange={(event) => handleMarketQueryChange(event.target.value)}
            placeholder="Search name, ticker, or contract"
            autoComplete="off"
            spellCheck={false}
            maxLength={96}
            aria-describedby="runner-market-count"
          />
          {marketQuery && (
            <button type="button" aria-label="Clear external market search" onClick={() => setMarketQuery("")}>×</button>
          )}
        </div>
        <button
          className="runnerDirectoryButton"
          type="button"
          aria-controls="runner-market-panel"
          aria-expanded={expandedDirectory}
          disabled={markets.length === 0}
          onClick={handleDirectoryAction}
        >
          {normalizedMarketQuery
            ? "Clear search"
            : showAllMarkets
              ? "Show top four"
              : "Browse all " + markets.length}
        </button>
      </div>
      <div className="runnerToolbar">
        <div className="runnerTabs" role="tablist" aria-label="External runner views">
          {VIEWS.map((item) => (
            <button
              type="button"
              role="tab"
              id={"runner-tab-" + item.id}
              aria-controls="runner-market-panel"
              aria-selected={view === item.id}
              tabIndex={view === item.id ? 0 : -1}
              className={view === item.id ? "active" : ""}
              onClick={() => changeView(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, item.id)}
              key={item.id}
            >
              {item.label}<span>{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <small id="runner-market-count" aria-live="polite">{marketCountLabel}</small>
      </div>

      <div id="runner-market-panel" role="tabpanel" aria-labelledby={"runner-tab-" + view}>
        {status === "loading" ? (
          <div className="emptyFeed" role="status"><strong>Loading runner signals…</strong><span>Checking liquidity, verified activity, volume pace, trade balance, and price movement.</span></div>
        ) : status === "error" ? (
          <div className="emptyFeed"><strong>Runner radar is temporarily unavailable.</strong><span>RMT launches and trading are unaffected.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>
        ) : visibleMarkets.length === 0 ? (
          <div className="emptyFeed">
            <strong>{normalizedMarketQuery ? "No external markets match that search." : "No markets meet this signal yet."}</strong>
            <span>{normalizedMarketQuery ? "Try a token name, ticker, or complete contract address." : "The filter will update automatically when activity qualifies."}</span>
            {normalizedMarketQuery
              ? <button type="button" onClick={() => setMarketQuery("")}>Clear search</button>
              : view !== "active" && <button type="button" onClick={() => changeView("active")}>View active markets</button>}
          </div>
        ) : (
          <div className="externalMarketGrid runnerMarketGrid">
            {visibleMarkets.map((market, index) => {
              const value = valuation(market);
              const changeClass = market.priceChange5m > 0 ? "positive" : market.priceChange5m < 0 ? "negative" : "flat";
              const oneHourTrades = market.buys1h + market.sells1h;
              return (
                <article className="externalMarketCard runnerMarketCard" key={market.address}>
                  <div className="runnerCardStatus">
                    <span className={"marketSignal " + market.signal}>{signalLabel(market.signal)}</span>
                    <span>#{String(rankByAddress.get(market.address.toLowerCase()) ?? index + 1).padStart(2, "0")} · Score {market.momentumScore}</span>
                  </div>
                  <div className="externalIdentity">
                    <span className="coin externalArtwork" aria-hidden="true">{initials(market.symbol)}</span>
                    <span><strong>{market.name}</strong><small>{"$" + cleanSymbol(market.symbol)} · Venue: {market.venue?.dexId ?? market.dexId}</small></span>
                    <em>{originLabel(market)}</em>
                  </div>
                  <div className="runnerStats">
                    <span><small>{value.label}</small><strong>{money(value.value)}</strong></span>
                    <span className={"externalChange " + changeClass}><small>5m change</small><strong>{market.priceChange5m > 0 ? "+" : ""}{market.priceChange5m.toFixed(2)}%</strong></span>
                    <span><small>1h volume</small><strong>{money(market.volume1h)}</strong></span>
                    <span><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong></span>
                  </div>
                  <div className="runnerActivity">
                    <span>{oneHourTrades > 0 ? Math.round(market.buyPressureBps / 100) + "% buys · 1h" : "No 1h trades"}</span>
                    {market.riskFlags.length > 0 && <em>{riskSummary(market.riskFlags)}</em>}
                  </div>
                  {canHandoffToUniswap(market) ? (
                    <div className="externalMarketActions">
                      <button className="buyCardAction" type="button" aria-haspopup="dialog" aria-label={"Buy " + market.name} onClick={() => openQuickTrade(market, "buy")}>Buy</button>
                      <button className="sellCardAction" type="button" aria-haspopup="dialog" aria-label={"Sell " + market.name} onClick={() => openQuickTrade(market, "sell")}>Sell</button>
                    </div>
                  ) : <span className="externalBadge">VIEW ONLY · VENUE REVIEW</span>}
                  <a className="externalChartLink" href={market.url} target="_blank" rel="noreferrer" aria-label={"View " + market.name + " market on DEX Screener"}>Chart & pair ↗</a>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <p className="externalDisclosure">Market data: DEX Screener. Confirmed RMT V6 launches are removed using RMT factory records. Token origin and market venue are labeled separately; external origin stays unknown until a creation adapter is contract-verified. Signals are automated filters, not endorsements or investment recommendations. For Uniswap-backed markets, Buy/Sell opens an RMT review, then Uniswap provides the fresh route and wallet transaction.</p>

      {quickTrade && selectedQuickTradeMarket && canHandoffToUniswap(selectedQuickTradeMarket) && (
        <ExternalTradeDialog
          market={selectedQuickTradeMarket}
          side={quickTrade.side}
          delayed={status === "stale"}
          onClose={closeQuickTrade}
          returnFocusTo={returnFocusTo.current ?? runnerHeading.current}
        />
      )}
    </section>
  );
}
