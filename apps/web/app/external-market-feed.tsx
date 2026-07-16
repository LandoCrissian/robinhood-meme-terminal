"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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

  const orderedMarkets = useMemo(() => stabilizeOrder(rankOrder, markets), [markets, rankOrder]);
  const counts = useMemo(() => ({
    moving: markets.filter((market) => market.signal === "moving").length,
    early: markets.filter((market) => market.signal === "early").length,
    active: markets.length
  }), [markets]);
  const filteredMarkets = orderedMarkets.filter((market) => view === "active" || market.signal === view);
  const visibleMarkets = filteredMarkets.slice(0, MAX_VISIBLE_MARKETS);

  const changeView = (nextView: RunnerView) => setView(nextView);
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentView: RunnerView) => {
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
    <section className="panel externalMarkets runnerRadar" aria-labelledby="external-markets-title">
      <div className="feedHeading externalHeading">
        <div>
          <p className="eyebrow">ROBINHOOD CHAIN · RUNNER RADAR</p>
          <h2 id="external-markets-title">Markets showing movement</h2>
          <p>Active Robinhood Chain markets discovered through WETH and USDG pairs. The board surfaces four risk-adjusted signals at a time instead of flooding the terminal with inactive tokens.</p>
        </div>
        <span className="externalBadge">{status === "stale" ? "DATA DELAYED" : "RECENT DATA · 60S RANKS"}</span>
      </div>

      <p className="srOnly" aria-live="polite">{rankingAnnouncement}</p>
      {status === "stale" && (
        <p className="runnerDataNotice" role="status">
          <span>Data delayed · showing the last successful snapshot{updatedAt ? " from " + snapshotTime(updatedAt) : ""}. RMT launches and trading are unaffected.</span>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </p>
      )}
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
        <small>Top {Math.min(MAX_VISIBLE_MARKETS, filteredMarkets.length)} of {filteredMarkets.length}</small>
      </div>

      <div id="runner-market-panel" role="tabpanel" aria-labelledby={"runner-tab-" + view}>
        {status === "loading" ? (
          <div className="emptyFeed" role="status"><strong>Loading runner signals…</strong><span>Checking liquidity, verified activity, volume pace, trade balance, and price movement.</span></div>
        ) : status === "error" ? (
          <div className="emptyFeed"><strong>Runner radar is temporarily unavailable.</strong><span>RMT launches and trading are unaffected.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>
        ) : visibleMarkets.length === 0 ? (
          <div className="emptyFeed"><strong>No markets meet this signal yet.</strong><span>The filter will update automatically when activity qualifies.</span>{view !== "active" && <button type="button" onClick={() => changeView("active")}>View active markets</button>}</div>
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
                    <span>#{String(index + 1).padStart(2, "0")} · Score {market.momentumScore}</span>
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
                  <a className="externalChartLink" href={market.url} target="_blank" rel="noreferrer" aria-label={"View " + market.name + " market on DEX Screener"}>Open market ↗</a>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <p className="externalDisclosure">Market data: DEX Screener. Confirmed RMT V6 launches are removed using RMT factory records. Token origin and market venue are labeled separately; external origin stays unknown until a creation adapter is contract-verified. Signals are automated filters, not endorsements or investment recommendations. External execution remains disabled.</p>
    </section>
  );
}
