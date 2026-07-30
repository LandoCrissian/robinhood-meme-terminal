"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  externalProjectProvenanceDescription,
  externalProjectProvenanceLabel,
  type ExternalMarket,
  type ExternalMarketResponse
} from "../lib/external-market";
import { isNonzeroEvmAddress } from "../lib/external-market-identity";
import type { ExternalMarketRiskFlag, ExternalMarketSignal } from "../lib/external-market-ranking";
import {
  launchDistributionVenue,
  marketDistributionPassport,
  type LaunchDistributionVenue
} from "../lib/launch-distribution";
import { ipfsToHttp } from "../lib/token-metadata";
import { routeLiquidityDepthLabel } from "../lib/trade-route-selection";
import { recordExperienceStage } from "../lib/experience-funnel";
import { ExternalSushiQuotePanel } from "./external-sushi-quote-panel";
import { ExternalUniswapTradePanel } from "./external-uniswap-trade-panel";

type FeedStatus = "loading" | "ready" | "stale" | "error";
type ExecutionAvailability = "checking" | "ready" | "view-only" | "unavailable";

type DiscoveryView = "trending" | "new" | "top" | "explore";
type SourceFilter = "all" | "attributed" | "pons" | "lemon";
type VenueFilter = "all" | LaunchDistributionVenue;

const VIEWS: Array<{ id: DiscoveryView; label: string }> = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top", label: "Top" },
  { id: "explore", label: "Explore" }
];
const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All origins" },
  { id: "attributed", label: "Launch sources" },
  { id: "pons", label: "Pons" },
  { id: "lemon", label: "Lemon" }
];
const VENUE_FILTERS: Array<{ id: VenueFilter; label: string }> = [
  { id: "all", label: "Any venue" },
  { id: "uniswap", label: "Uniswap" },
  { id: "sushi", label: "Sushi" }
];
const DATA_REFRESH_MS = 30_000;
const RANK_REFRESH_MS = 60_000;
const MAX_VISIBLE_MARKETS = 12;

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

function ExternalArtwork({ market }: { market: ExternalMarket }) {
  const [failed, setFailed] = useState(false);
  const image = market.project?.imageUri;
  return (
    <span className="coin externalArtwork" aria-hidden="true">
      {image && !failed
        ? <img src={ipfsToHttp(image)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : initials(market.symbol)}
    </span>
  );
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
  if (market.project) {
    return externalProjectProvenanceLabel(market.project);
  }
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

function signedPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function changeTone(value: number) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

function marketAge(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "Age unavailable";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m old`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h old`;
  return `${Math.round(minutes / 1_440)}d old`;
}


type ExternalTradeSide = "buy" | "sell";

function isTradeableAddress(address: string) {
  return isNonzeroEvmAddress(address);
}

function isUniswapVenue(market: ExternalMarket) {
  if (market.venue.kind !== "dex") return false;
  const venue = market.venue.dexId.trim().toLowerCase();
  return venue === "uniswap" || venue.startsWith("uniswap-");
}

function isSushiVenue(market: ExternalMarket) {
  if (market.venue.kind !== "dex") return false;
  return market.venue.dexId.trim().toLowerCase().includes("sushi");
}

function venueLabel(market: ExternalMarket) {
  return market.venue.kind === "dex" ? market.venue.dexId : "Circus curve";
}

function executionProvider(market: ExternalMarket) {
  if (isSushiVenue(market)) return "Sushi";
  if (isUniswapVenue(market)) return "Uniswap";
  return null;
}

function canHandoffToVenue(market: ExternalMarket) {
  return isTradeableAddress(market.address) && executionProvider(market) !== null;
}

function venueSwapUrl(market: ExternalMarket, side: ExternalTradeSide) {
  const inputCurrency = side === "buy" ? "NATIVE" : market.address;
  const outputCurrency = side === "buy" ? market.address : "NATIVE";
  if (isSushiVenue(market)) {
    return "https://www.sushi.com/robinhood/swap?token0="
      + encodeURIComponent(inputCurrency)
      + "&token1="
      + encodeURIComponent(outputCurrency);
  }
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
  onSideChange,
  onClose,
  returnFocusTo
}: {
  market: ExternalMarket;
  side: ExternalTradeSide;
  delayed: boolean;
  onSideChange: (side: ExternalTradeSide) => void;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const value = valuation(market);
  const venue = venueLabel(market);
  const provider = executionProvider(market) ?? "DEX";
  const reviewUrl = venueSwapUrl(market, side);
  const sideLabel = side === "buy" ? "Buy" : "Sell";
  const oneHourTrades = market.buys1h + market.sells1h;
  const buyPressure = Math.max(0, Math.min(100, market.buyPressureBps / 100));

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
          <ExternalArtwork market={market} />
          <span>
            <small>EXTERNAL MARKET · {provider.toUpperCase()} REVIEW</small>
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
        <div className="externalTradeSideTabs" role="tablist" aria-label={`Trade side for ${market.name}`}>
          <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "active buy" : ""} onClick={() => onSideChange("buy")}>Buy</button>
          <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "active sell" : ""} onClick={() => onSideChange("sell")}>Sell</button>
        </div>

        <section className="externalTradeSnapshot" aria-labelledby="external-market-snapshot">
          <header>
            <div>
              <span className={`marketSignal ${market.signal}`}>{signalLabel(market.signal)}</span>
              <small>{venue} · {marketAge(market.ageMinutes)}</small>
            </div>
            {market.riskFlags.length > 0
              ? <strong className="externalTradeRisk">{riskSummary(market.riskFlags)}</strong>
              : <strong className="externalTradeRisk clear">No ranking flags</strong>}
          </header>
          <div className="externalTradePrice">
            <span><small id="external-market-snapshot">Live price</small><strong>{money(market.priceUsd, true)}</strong></span>
            <em className={changeTone(market.priceChange1h)}>{signedPercent(market.priceChange1h)} · 1h</em>
          </div>
          <div className="externalTradeMetrics">
            <span><small>{value.label}</small><strong>{money(value.value)}</strong></span>
            <span><small>Liquidity · {routeLiquidityDepthLabel(market.liquidityUsd)}</small><strong>{money(market.liquidityUsd)}</strong></span>
            <span><small>1h volume</small><strong>{money(market.volume1h)}</strong></span>
            <span><small>1h trades</small><strong>{oneHourTrades.toLocaleString()}</strong></span>
          </div>
        </section>

        {isSushiVenue(market) && <ExternalSushiQuotePanel market={market} side={side} />}
        {isUniswapVenue(market) && <ExternalUniswapTradePanel market={market} side={side} />}

        <section className="externalTradePulse" aria-labelledby="external-market-pulse">
          <header><div><small>MARKET PULSE</small><strong id="external-market-pulse">Momentum and flow</strong></div><a href={market.url} target="_blank" rel="noopener noreferrer">Full chart ↗</a></header>
          <div className="externalTradeChanges">
            <span className={changeTone(market.priceChange5m)}><small>5m</small><strong>{signedPercent(market.priceChange5m)}</strong></span>
            <span className={changeTone(market.priceChange1h)}><small>1h</small><strong>{signedPercent(market.priceChange1h)}</strong></span>
            <span className={changeTone(market.priceChange24h)}><small>24h</small><strong>{signedPercent(market.priceChange24h)}</strong></span>
          </div>
          <div className="externalTradeFlow">
            <div><span>Buy pressure</span><strong>{oneHourTrades > 0 ? `${Math.round(buyPressure)}% buys` : "No 1h trades"}</strong></div>
            <span className="externalTradeFlowTrack" aria-hidden="true"><i style={{ width: `${oneHourTrades > 0 ? buyPressure : 0}%` }} /></span>
            <small>{market.buys1h.toLocaleString()} buys · {market.sells1h.toLocaleString()} sells in 1h</small>
          </div>
        </section>

        <section className="externalTradeProvenance" aria-labelledby="external-market-origin">
          <div><small id="external-market-origin">PROJECT ORIGIN</small><strong>{originLabel(market)}</strong></div>
          <dl>
            <div><dt>Token</dt><dd title={market.address}>{shortAddress(market.address)}</dd></div>
            <div><dt>Pool</dt><dd title={market.pairAddress}>{shortAddress(market.pairAddress)}</dd></div>
          </dl>
          {delayed && <p className="runnerDataNotice"><span>RMT’s snapshot is delayed. {provider} will still calculate a fresh route and quote before any wallet confirmation.</span></p>}
          <details>
            <summary>How this market is verified</summary>
            <p>
            {market.project
              ? externalProjectProvenanceDescription(market.project) + " This is provenance, not an endorsement. "
              : "This token is external and its launchpad origin is not yet verified by RMT. "}
            {isUniswapVenue(market)
              ? "RMT re-verifies the canonical V3 pool and constructs deadline- and slippage-bounded calldata for your wallet. RMT never takes custody."
              : "RMT re-verifies the displayed Sushi pool, audits Sushi’s simulated transaction, and checks its sender, recipient, tokens, amount, minimum output, router and executor before your wallet can submit it. RMT never takes custody."}
            </p>
          </details>
        </section>
      </div>

      <div className={`externalTradeActionDock ${side}`}>
        <a href={reviewUrl} target="_blank" rel="noopener noreferrer">
          {isSushiVenue(market) ? "Sushi fallback ↗" : "Uniswap fallback ↗"}
        </a>
        <small>
          {isSushiVenue(market)
            ? "Verified Sushi trading is available above without leaving RMT."
            : "Verified Uniswap V3 trading is available above without leaving RMT."}
        </small>
      </div>
      <footer className="quickTradeFooter">
        <span>Fresh {provider} quote required</span>
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
  const [view, setView] = useState<DiscoveryView>("trending");
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [rankingAnnouncement, setRankingAnnouncement] = useState("");
  const nextRankRefresh = useRef(0);
  const rankInitialized = useRef(false);
  const hasSuccessfulData = useRef(false);
  const restoredQuickTrade = useRef(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const runnerHeading = useRef<HTMLHeadingElement>(null);
  const marketSearchInput = useRef<HTMLInputElement>(null);
  const [quickTrade, setQuickTrade] = useState<{ address: string; side: ExternalTradeSide }>();
  const [tradeAnnouncement, setTradeAnnouncement] = useState("");
  const [marketQuery, setMarketQuery] = useState("");
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [venueFilter, setVenueFilter] = useState<VenueFilter>("all");
  const [tradeableOnly, setTradeableOnly] = useState(false);
  const [executionAvailability, setExecutionAvailability] = useState<Record<string, ExecutionAvailability>>({});

  const syncQuickTradeUrl = useCallback((market?: ExternalMarket, side?: ExternalTradeSide) => {
    const url = new URL(window.location.href);
    if (market && side) {
      url.searchParams.delete("quickTrade");
      url.searchParams.delete("side");
      url.searchParams.set("externalTrade", market.address);
      url.searchParams.set("externalSide", side);
      url.hash = "market-explorer";
    } else {
      url.searchParams.delete("externalTrade");
      url.searchParams.delete("externalSide");
    }
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []);

  const openQuickTrade = useCallback((market: ExternalMarket, side: ExternalTradeSide) => {
    if (
      !canHandoffToVenue(market)
      || executionAvailability[market.address.toLowerCase()] !== "ready"
    ) return;
    recordExperienceStage("discovery_used");
    recordExperienceStage("trade_preparation_opened");
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : runnerHeading.current;
    setTradeAnnouncement("");
    setQuickTrade({ address: market.address, side });
    syncQuickTradeUrl(market, side);
  }, [executionAvailability, syncQuickTradeUrl]);

  const closeQuickTrade = useCallback(() => {
    setQuickTrade(undefined);
    syncQuickTradeUrl();
  }, [syncQuickTradeUrl]);

  const changeQuickTradeSide = useCallback((market: ExternalMarket, side: ExternalTradeSide) => {
    setQuickTrade({ address: market.address, side });
    syncQuickTradeUrl(market, side);
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
        setRankingAnnouncement(payload.stale ? "Market data is delayed." : "Market rankings updated.");
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
    if (!market || !canHandoffToVenue(market)) {
      syncQuickTradeUrl();
      setTradeAnnouncement("That market is no longer available for venue review.");
      return;
    }
    const executionState = executionAvailability[market.address.toLowerCase()];
    if (executionState === undefined || executionState === "checking") return;
    if (executionState !== "ready") {
      syncQuickTradeUrl();
      setTradeAnnouncement("That market does not currently have a verified in-site execution route.");
      return;
    }
    returnFocusTo.current = runnerHeading.current;
    setQuickTrade({ address: market.address, side });
  }, [executionAvailability, markets, status, syncQuickTradeUrl]);

  const selectedQuickTradeMarket = useMemo(
    () => quickTrade
      ? markets.find((market) => market.address.toLowerCase() === quickTrade.address.toLowerCase())
      : undefined,
    [markets, quickTrade]
  );

  useEffect(() => {
    if (!quickTrade) return;
    if (
      selectedQuickTradeMarket
      && canHandoffToVenue(selectedQuickTradeMarket)
      && executionAvailability[selectedQuickTradeMarket.address.toLowerCase()] === "ready"
    ) return;
    if (
      selectedQuickTradeMarket
      && executionAvailability[selectedQuickTradeMarket.address.toLowerCase()] === undefined
    ) return;
    setQuickTrade(undefined);
    syncQuickTradeUrl();
    setTradeAnnouncement("The external market changed or left the eligible feed, so its trade review was closed.");
    window.setTimeout(() => runnerHeading.current?.focus(), 0);
  }, [executionAvailability, quickTrade, selectedQuickTradeMarket, syncQuickTradeUrl]);

  const orderedMarkets = useMemo(() => stabilizeOrder(rankOrder, markets), [markets, rankOrder]);
  const sourceCounts = useMemo(() => ({
    all: markets.length,
    attributed: markets.filter((market) => marketDistributionPassport(market).isAttributedLaunch).length,
    pons: markets.filter((market) => market.project?.sourceId === "pons").length,
    lemon: markets.filter((market) => market.project?.sourceId === "lemon").length
  }), [markets]);
  const sourceScopedMarkets = useMemo(
    () => sourceFilter === "all"
      ? markets
      : sourceFilter === "attributed"
        ? markets.filter((market) => marketDistributionPassport(market).isAttributedLaunch)
      : markets.filter((market) => market.project?.sourceId === sourceFilter),
    [markets, sourceFilter]
  );
  const venueCounts = useMemo(() => ({
    all: sourceScopedMarkets.length,
    uniswap: sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === "uniswap").length,
    sushi: sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === "sushi").length,
    other: sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === "other").length
  }), [sourceScopedMarkets]);
  const scopedMarkets = useMemo(
    () => venueFilter === "all"
      ? sourceScopedMarkets
      : sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === venueFilter),
    [sourceScopedMarkets, venueFilter]
  );
  const counts = useMemo(() => ({
    trending: scopedMarkets.filter((market) => market.signal !== "active").length || scopedMarkets.length,
    new: scopedMarkets.filter((market) => market.ageMinutes !== null && market.ageMinutes <= 24 * 60).length,
    top: scopedMarkets.filter((market) => market.marketCapUsd > 0 || market.fdvUsd > 0).length,
    explore: scopedMarkets.length
  }), [scopedMarkets]);
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
  const viewMarkets = useMemo(() => {
    if (view === "new") {
      return [...orderedMarkets].sort((a, b) =>
        (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0)
        || b.momentumScore - a.momentumScore
      );
    }
    if (view === "top") {
      return [...orderedMarkets].sort((a, b) =>
        Math.max(b.marketCapUsd, b.fdvUsd) - Math.max(a.marketCapUsd, a.fdvUsd)
        || b.volume24h - a.volume24h
      );
    }
    if (view === "trending") {
      const signaled = orderedMarkets.filter((market) => market.signal !== "active");
      return signaled.length > 0 ? signaled : orderedMarkets;
    }
    return orderedMarkets;
  }, [orderedMarkets, view]);
  const searchedMarkets = normalizedMarketQuery
    ? orderedMarkets.filter((market) => [
        market.name,
        market.symbol,
        market.address,
        market.pairAddress
      ].some((value) => value.toLowerCase().includes(normalizedMarketQuery)))
    : viewMarkets;
  const sourceFilteredMarkets = searchedMarkets.filter((market) => {
    if (sourceFilter === "attributed" && !marketDistributionPassport(market).isAttributedLaunch) return false;
    if (
      sourceFilter !== "all"
      && sourceFilter !== "attributed"
      && market.project?.sourceId !== sourceFilter
    ) return false;
    return venueFilter === "all" || launchDistributionVenue(market) === venueFilter;
  });
  const filteredMarkets = tradeableOnly
    ? sourceFilteredMarkets.filter((market) => executionAvailability[market.address.toLowerCase()] === "ready")
    : sourceFilteredMarkets;
  const expandedDirectory =
    showAllMarkets || normalizedMarketQuery.length > 0;
  const visibleMarkets = expandedDirectory
    ? filteredMarkets
    : filteredMarkets.slice(0, MAX_VISIBLE_MARKETS);
  const availabilityCandidates = (tradeableOnly ? sourceFilteredMarkets : visibleMarkets.slice(0, MAX_VISIBLE_MARKETS))
    .filter(canHandoffToVenue)
    .map((market) => market.address.toLowerCase());
  const checkingAvailability = availabilityCandidates.filter(
    (address) => executionAvailability[address] === "checking"
  );
  const unknownAvailability = availabilityCandidates.filter(
    (address) => executionAvailability[address] === undefined
  );
  const availabilityAddresses = tradeableOnly
    ? (checkingAvailability.length > 0 ? checkingAvailability : unknownAvailability).slice(0, MAX_VISIBLE_MARKETS)
    : availabilityCandidates;
  const availabilityKey = availabilityAddresses.join(",");
  const tradeableCount = sourceFilteredMarkets.filter(
    (market) => executionAvailability[market.address.toLowerCase()] === "ready"
  ).length;
  const routeResolvedCount = sourceFilteredMarkets.filter((market) => {
    const executionState = executionAvailability[market.address.toLowerCase()];
    return !canHandoffToVenue(market)
      || (executionState !== undefined && executionState !== "checking");
  }).length;
  const routeSyncPending = routeResolvedCount < sourceFilteredMarkets.length;
  const tradeableVerificationPending = tradeableOnly && routeResolvedCount < sourceFilteredMarkets.length;

  useEffect(() => {
    const tokens = availabilityAddresses.filter((address) => executionAvailability[address] === undefined);
    if (tokens.length === 0) return;

    setExecutionAvailability((current) => ({
      ...current,
      ...Object.fromEntries(tokens.map((address) => [address, "checking" as const]))
    }));
    const controller = new AbortController();
    let settled = false;
    const query = new URLSearchParams({ tokens: tokens.join(",") });
    void fetch(`/api/trade/external-availability?${query}`, {
      cache: "no-store",
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json() as {
        availability?: Array<{
          token?: string;
          status?: Exclude<ExecutionAvailability, "checking">;
        }>;
      };
      if (!response.ok || !Array.isArray(payload.availability)) {
        throw new Error("Execution availability is unavailable.");
      }
      const requested = new Set(tokens);
      const resolved: Record<string, Exclude<ExecutionAvailability, "checking">> = Object.fromEntries(
        tokens.map((address) => [address, "unavailable" as const])
      );
      for (const item of payload.availability) {
        const address = item.token?.toLowerCase();
        if (
          !address
          || !requested.has(address)
          || (item.status !== "ready" && item.status !== "view-only" && item.status !== "unavailable")
        ) continue;
        resolved[address] = item.status;
      }
      settled = true;
      setExecutionAvailability((current) => ({ ...current, ...resolved }));
    }).catch(() => {
      if (controller.signal.aborted) return;
      settled = true;
      setExecutionAvailability((current) => ({
        ...current,
        ...Object.fromEntries(tokens.map((address) => [address, "unavailable" as const]))
      }));
    });
    return () => {
      controller.abort();
      if (!settled) {
        setExecutionAvailability((current) => {
          const next = { ...current };
          for (const address of tokens) {
            if (next[address] === "checking") delete next[address];
          }
          return next;
        });
      }
    };
    // availabilityKey changes only when the prioritized market set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityKey]);

  const marketCountLabel = normalizedMarketQuery
    ? filteredMarkets.length + " match" + (filteredMarkets.length === 1 ? "" : "es")
    : tradeableVerificationPending
      ? "Verifying routes · " + routeResolvedCount + " of " + sourceFilteredMarkets.length +
        " checked · " + tradeableCount + " tradeable"
    : showAllMarkets
      ? "Showing all " + filteredMarkets.length
      : "Top " + Math.min(MAX_VISIBLE_MARKETS, filteredMarkets.length) +
        " of " + filteredMarkets.length;

  const changeView = (nextView: DiscoveryView) => {
    setView(nextView);
    setMarketQuery("");
    setShowAllMarkets(tradeableOnly || nextView === "explore");
  };
  const handleMarketQueryChange = (value: string) => {
    setMarketQuery(value);
    if (value.trim()) {
      setView("explore");
      setShowAllMarkets(true);
    }
  };
  const clearMarketQuery = () => {
    setMarketQuery("");
    window.requestAnimationFrame(() => marketSearchInput.current?.focus());
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
    setView("explore");
    setShowAllMarkets(true);
  };
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentView: DiscoveryView) => {
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
    <section className="panel externalMarkets runnerRadar terminalMarketShell" id="market-explorer" aria-labelledby="external-markets-title">
      <div className="feedHeading externalHeading">
        <div>
          <p className="eyebrow">UNIVERSAL MARKET INDEX</p>
          <h2 id="external-markets-title" ref={runnerHeading} tabIndex={-1}>Live markets</h2>
          <p>Origin-aware discovery across Robinhood Chain launchpads and DEX venues.</p>
        </div>
        <span className="externalBadge"><i aria-hidden="true" />{status === "stale" ? "DATA DELAYED" : "LIVE · 60S RANKS"}</span>
      </div>

      <p className="srOnly" aria-live="polite">{rankingAnnouncement}</p>
      <p className="srOnly" aria-live="polite">{tradeAnnouncement}</p>
      {status === "stale" && (
        <p className="runnerDataNotice" role="status">
          <span>Data delayed · showing the last successful snapshot{updatedAt ? " from " + snapshotTime(updatedAt) : ""}. Direct venue trading remains available.</span>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </p>
      )}
      <div className="runnerDirectoryControls" role="search" aria-label="Search external markets">
        <div className="runnerMarketSearch">
          <span aria-hidden="true">⌕</span>
          <label className="srOnly" htmlFor="external-market-search">Search external markets by name, ticker, or contract</label>
          <input
            id="external-market-search"
            ref={marketSearchInput}
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
            <button type="button" aria-label="Clear external market search" onClick={clearMarketQuery}>×</button>
          )}
        </div>
        <button
          className="runnerDirectoryButton"
          type="button"
          aria-controls="runner-market-panel"
          aria-expanded={expandedDirectory}
          disabled={filteredMarkets.length === 0}
          onClick={handleDirectoryAction}
        >
          {normalizedMarketQuery
            ? "Clear search"
            : showAllMarkets
              ? "Show top twelve"
              : "Browse all " + filteredMarkets.length}
        </button>
      </div>
      <div className="runnerToolbar">
        <div className="runnerTabs" role="tablist" aria-label="Market discovery views">
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
      <div className="runnerSourceFilters" role="group" aria-label="Filter markets by launch origin, liquidity venue, or execution availability">
        <span>Origin</span>
        {SOURCE_FILTERS.map((item) => (
          <button
            type="button"
            aria-pressed={sourceFilter === item.id}
            className={sourceFilter === item.id ? "active" : ""}
            onClick={() => {
              setSourceFilter(item.id);
              setShowAllMarkets(tradeableOnly || view === "explore");
            }}
            key={item.id}
          >
            {item.label}<b>{sourceCounts[item.id]}</b>
          </button>
        ))}
        <span className="runnerFilterDivider">Venue</span>
        {VENUE_FILTERS.map((item) => (
          <button
            type="button"
            aria-pressed={venueFilter === item.id}
            className={venueFilter === item.id ? "active" : ""}
            onClick={() => {
              setVenueFilter(item.id);
              setShowAllMarkets(tradeableOnly || view === "explore");
            }}
            key={item.id}
          >
            {item.label}<b>{venueCounts[item.id]}</b>
          </button>
        ))}
        <span className="runnerFilterDivider">Execute</span>
        <button
          type="button"
          aria-pressed={tradeableOnly}
          className={tradeableOnly ? "active executionFilter" : "executionFilter"}
          onClick={() => {
            setTradeableOnly((current) => !current);
            setShowAllMarkets(!tradeableOnly || view === "explore");
          }}
        >
          {routeSyncPending ? "Routes syncing" : "Tradeable"}
          <b>{routeSyncPending ? `${routeResolvedCount}/${sourceFilteredMarkets.length}` : tradeableCount}</b>
        </button>
      </div>

      <div className="runnerColumnHeader" aria-hidden="true">
        <span>Rank / signal</span><span>Market / origin</span><span>Valuation / 5m</span><span>1h flow / liquidity</span><span>Activity / risk</span><span>Execute</span>
      </div>

      <div id="runner-market-panel" role="tabpanel" aria-labelledby={"runner-tab-" + view}>
        {status === "loading" ? (
          <div className="emptyFeed" role="status"><strong>Loading live markets…</strong><span>Indexing Pons, Lemon, Sushi, Uniswap, liquidity, activity, and verified project metadata.</span></div>
        ) : status === "error" ? (
          <div className="emptyFeed"><strong>Market discovery is temporarily unavailable.</strong><span>Direct venue trading remains available.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>
        ) : visibleMarkets.length === 0 ? (
          <div className="emptyFeed">
            <strong>{tradeableVerificationPending
              ? "Verifying in-site execution routes…"
              : normalizedMarketQuery
                ? "No external markets match that search."
                : tradeableOnly
                  ? "No verified in-site routes match these filters."
                  : "No markets meet this signal yet."}</strong>
            <span>{tradeableVerificationPending
              ? "RMT is checking prioritized markets in bounded batches. Tradeable results appear as each route is independently verified."
              : normalizedMarketQuery
              ? "Try a token name, ticker, or complete contract address, or change the project-source filter."
              : tradeableOnly
                ? "Change the project source or turn off Tradeable to inspect view-only markets."
              : sourceFilter !== "all" || venueFilter !== "all"
                ? "No markets meet the selected origin and venue evidence filters."
                : "The filter will update automatically when activity qualifies."}</span>
            {!tradeableVerificationPending && normalizedMarketQuery
              ? <button type="button" onClick={clearMarketQuery}>Clear search</button>
              : !tradeableVerificationPending && !tradeableOnly && view !== "explore" && <button type="button" onClick={() => changeView("explore")}>Explore all markets</button>}
          </div>
        ) : (
          <div className="externalMarketGrid runnerMarketGrid">
            {visibleMarkets.map((market, index) => {
              const value = valuation(market);
              const changeClass = market.priceChange5m > 0 ? "positive" : market.priceChange5m < 0 ? "negative" : "flat";
              const oneHourTrades = market.buys1h + market.sells1h;
              const marketRank = rankByAddress.get(market.address.toLowerCase()) ?? index + 1;
              const mobileMoveLabel = market.curve
                ? (market.curve.progressBps / 100).toFixed(1) + "%"
                : (market.priceChange5m > 0 ? "+" : "") + market.priceChange5m.toFixed(2) + "%";
              const addressKey = market.address.toLowerCase();
              const executionState: ExecutionAvailability = canHandoffToVenue(market)
                ? executionAvailability[addressKey] ?? (index < MAX_VISIBLE_MARKETS ? "checking" : "unavailable")
                : "view-only";
              const executionDepth = executionState === "ready"
                ? routeLiquidityDepthLabel(market.liquidityUsd)
                : null;
              const mobileReviewRequired = market.riskFlags.length > 0;
              const mobileActionLabel = mobileReviewRequired
                ? "Review"
                : executionState === "ready"
                  ? "Trade"
                  : executionState === "checking"
                    ? "Verifying"
                    : executionState === "view-only"
                      ? "View only"
                      : "Check route";
              const mobileWorkspaceHref = `/market/${market.address}${mobileReviewRequired ? "?tab=safety" : ""}`;
              const distribution = marketDistributionPassport(market);
              return (
                <article className="externalMarketCard runnerMarketCard" data-signal={market.signal} key={market.address}>
                  <div className="mobileRunnerMarketRow">
                    <a className="mobileRunnerIdentity" href={mobileWorkspaceHref} aria-label={`Open ${market.name} ${mobileReviewRequired ? "safety review" : "trading workspace"}`}>
                      <span className="mobileRunnerRank">#{String(marketRank).padStart(2, "0")}</span>
                      <ExternalArtwork market={market} />
                      <span className="mobileRunnerCopy">
                        <strong>{market.name}</strong>
                        <small>{"$" + cleanSymbol(market.symbol)} · {distribution.shortLabel}</small>
                      </span>
                    </a>
                    <a
                      className={`mobileRunnerTrade ${mobileReviewRequired ? "review" : executionState}`}
                      href={mobileWorkspaceHref}
                      aria-label={`${mobileActionLabel} ${market.name}`}
                    >
                      {mobileActionLabel}
                    </a>
                    <div className="mobileRunnerMetrics" aria-label={`${market.name} market snapshot`}>
                      <span><small>{value.label}</small><strong>{money(value.value)}</strong></span>
                      <span className={"mobileRunnerMove " + (market.curve ? "positive" : changeClass)}>
                        <small>{market.curve ? "Progress" : "5m"}</small><strong>{mobileMoveLabel}</strong>
                      </span>
                      <span><small>{executionDepth ? "Depth · " + executionDepth : "Liquidity"}</small><strong>{money(market.liquidityUsd)}</strong></span>
                    </div>
                  </div>
                  <div className="runnerCardStatus">
                    <span className={"marketSignal " + market.signal}>{signalLabel(market.signal)}</span>
                    <span>#{String(marketRank).padStart(2, "0")} · Score {market.momentumScore}</span>
                  </div>
                  <div className="externalIdentity">
                    <ExternalArtwork market={market} />
                    <span>
                      <a className="externalIdentityLink" href={`/market/${market.address}`} aria-label={`Open ${market.name} trading workspace`} onClick={() => recordExperienceStage("discovery_used")}><strong>{market.name}</strong></a>
                      <small>{"$" + cleanSymbol(market.symbol)} · Venue: {venueLabel(market)}</small>
                      {market.project?.creator && (
                        <small className="runnerCreator" title={market.project.creator}>Creator {shortAddress(market.project.creator)}</small>
                      )}
                      <small className={`runnerDistribution ${distribution.state}`}>{distribution.shortLabel}</small>
                    </span>
                    <em>{originLabel(market)}</em>
                  </div>
                  <div className="runnerStats">
                    <span><small>{value.label}</small><strong>{money(value.value)}</strong></span>
                    {market.curve
                      ? <span className="externalChange positive"><small>Curve progress</small><strong>{(market.curve.progressBps / 100).toFixed(2)}%</strong></span>
                      : <span className={"externalChange " + changeClass}><small>5m change</small><strong>{market.priceChange5m > 0 ? "+" : ""}{market.priceChange5m.toFixed(2)}%</strong></span>}
                    {market.curve
                      ? <span><small>ETH raised</small><strong>{market.curve.ethRaised.toFixed(4)} ETH</strong></span>
                      : <span><small>1h volume</small><strong>{money(market.volume1h)}</strong></span>}
                    <span><small>{market.curve ? "Curve liquidity" : "Liquidity"}</small><strong>{money(market.liquidityUsd)}</strong></span>
                  </div>
                  <div className="runnerActivity">
                    <span>{market.curve
                      ? market.curve.uniqueTraders + " traders · " + market.curve.volumeQuoteEth.toFixed(3) + " ETH curve volume"
                      : (oneHourTrades > 0 ? Math.round(market.buyPressureBps / 100) + "% buys · 1h" : "No 1h trades")
                        + (executionDepth ? " · " + executionDepth + " liquidity" : "")}</span>
                    {market.riskFlags.length > 0 && <em>{riskSummary(market.riskFlags)}</em>}
                  </div>
                  {executionState === "ready" ? (
                    <div className="externalMarketActions">
                      <button className="buyCardAction" type="button" aria-haspopup="dialog" aria-label={"Buy " + market.name} onClick={() => openQuickTrade(market, "buy")}>Buy</button>
                      <button className="sellCardAction" type="button" aria-haspopup="dialog" aria-label={"Sell " + market.name} onClick={() => openQuickTrade(market, "sell")}>Sell</button>
                    </div>
                  ) : (
                    <span className="externalBadge">
                      {executionState === "checking"
                        ? "VERIFYING IN-SITE ROUTE"
                        : executionState === "view-only"
                          ? "VIEW ONLY · NO VERIFIED ROUTE"
                          : "CHECK ROUTE IN WORKSPACE"}
                    </span>
                  )}
                  <a className="externalChartLink" href={market.url} target="_blank" rel="noreferrer" aria-label={"View " + market.name + " market source"}>{market.curve ? "Open verified curve ↗" : "Chart & pair ↗"}</a>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <p className="externalDisclosure">Market data combines DEX Screener with Lemon&apos;s documented public API. Lemon identity is attached only when its token and pool match the discovered DEX pair; Pons identity requires matching factory and token records. Other qualified markets remain discoverable without implied endorsement. Token origin and execution venue are kept separate. Rankings are automated signals, not investment recommendations. Depth labels describe displayed-pool liquidity for independently verified routes, not token safety or guaranteed execution. Buy and Sell always require a fresh Sushi or Uniswap quote and wallet review.</p>

      {quickTrade
        && selectedQuickTradeMarket
        && executionAvailability[selectedQuickTradeMarket.address.toLowerCase()] === "ready"
        && (
        <ExternalTradeDialog
          market={selectedQuickTradeMarket}
          side={quickTrade.side}
          delayed={status === "stale"}
          onSideChange={(side) => changeQuickTradeSide(selectedQuickTradeMarket, side)}
          onClose={closeQuickTrade}
          returnFocusTo={returnFocusTo.current ?? runnerHeading.current}
        />
      )}
    </section>
  );
}
