"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  externalProjectProvenanceLabel,
  type ExternalMarket,
  type ExternalMarketResponse,
  type UniversalMarketResolution
} from "../lib/external-market";
import { canonicalExternalMarketLookupAddress } from "../lib/external-market-identity";
import type { ExternalMarketRiskFlag, ExternalMarketSignal } from "../lib/external-market-ranking";
import {
  externalMarketViewCounts,
  selectExternalMarketView,
  type ExternalMarketDiscoveryView
} from "../lib/external-market-discovery";
import {
  launchDistributionVenue,
  marketDistributionPassport,
  type LaunchDistributionVenue
} from "../lib/launch-distribution";
import { ipfsToHttp } from "../lib/token-metadata";
import { recordExperienceStage } from "../lib/experience-funnel";
import { deriveLiveMarketSignals, type LiveMarketSignal } from "../lib/live-signal-engine";

type FeedStatus = "loading" | "ready" | "stale" | "error";
type ContractLookupStatus = "idle" | "searching" | "resolved" | "not-found" | "error";

type DiscoveryView = ExternalMarketDiscoveryView;
type VenueFilter = "all" | LaunchDistributionVenue;

const VIEWS: Array<{ id: DiscoveryView; label: string }> = [
  { id: "trending", label: "Signals" },
  { id: "new", label: "New · 24h" },
  { id: "top", label: "Active" },
  { id: "explore", label: "All" }
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
  const image = market.project?.imageUri ?? market.imageUri;
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

function marketAge(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "Age unavailable";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m old`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h old`;
  return `${Math.round(minutes / 1_440)}d old`;
}

function runnerReason(market: ExternalMarket) {
  const trades5m = market.buys5m + market.sells5m;
  const trades1h = market.buys1h + market.sells1h;
  const pace = market.volume1h > 0
    ? 12 * Math.min(market.volume5m, market.volume1h) / market.volume1h
    : 0;
  if (market.signal === "moving") {
    return `${pace.toFixed(1)}× 5m pace · ${trades5m} recent trades`;
  }
  if (market.signal === "early") {
    return `${trades1h} two-sided trades · qualified young market`;
  }
  return "Observed market · no qualified runner signal";
}

function LiveSignalDesk({ signals, loading }: { signals: LiveMarketSignal[]; loading: boolean }) {
  return (
    <section className="liveSignalDesk" aria-labelledby="live-signal-desk-title">
      <header>
        <span><small>RMT LIVE SIGNAL DESK</small><strong id="live-signal-desk-title">Markets requiring attention</strong></span>
        <em>{loading ? "Scanning markets" : `${signals.length} live · all shown`}</em>
      </header>
      {loading ? (
        <div className="liveSignalEmpty loading" role="status"><strong>Building the live signal desk…</strong><span>RMT is validating liquidity, two-sided activity, price movement and market pace.</span></div>
      ) : signals.length ? (
        <div className="liveSignalRail">
          {signals.map((signal) => (
            <a
              href={`/market/${signal.token}?tab=activity`}
              className={signal.severity}
              data-kind={signal.kind}
              key={signal.id}
            >
              <span><b>{signal.severity === "urgent" ? "URGENT" : signal.severity === "review" ? "REVIEW" : "OBSERVE"}</b><em>${cleanSymbol(signal.symbol)}</em></span>
              <strong>{signal.title}</strong>
              <small>{signal.evidence}</small>
            </a>
          ))}
        </div>
      ) : (
        <div className="liveSignalEmpty"><strong>No market has cleared a live signal threshold.</strong><span>RMT continues checking activity, pace, price and liquidity every 30 seconds.</span></div>
      )}
      <footer>Read-only observations from validated public market snapshots · open a market for confirmed swap and wallet evidence · never a profit promise or automatic trade</footer>
    </section>
  );
}


function venueLabel(market: ExternalMarket) {
  return market.venue.kind === "dex" ? market.venue.dexId : "Circus curve";
}

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
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
  const [liveSignals, setLiveSignals] = useState<LiveMarketSignal[]>([]);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [view, setView] = useState<DiscoveryView>("trending");
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [rankingAnnouncement, setRankingAnnouncement] = useState("");
  const nextRankRefresh = useRef(0);
  const rankInitialized = useRef(false);
  const hasSuccessfulData = useRef(false);
  const previousMarketSnapshot = useRef<ExternalMarket[]>([]);
  const runnerHeading = useRef<HTMLHeadingElement>(null);
  const marketSearchInput = useRef<HTMLInputElement>(null);
  const [marketQuery, setMarketQuery] = useState("");
  const [contractLookupStatus, setContractLookupStatus] = useState<ContractLookupStatus>("idle");
  const [contractLookupMarket, setContractLookupMarket] = useState<ExternalMarket>();
  const [contractLookupResolution, setContractLookupResolution] = useState<UniversalMarketResolution>();
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [venueFilter, setVenueFilter] = useState<VenueFilter>("all");
  const normalizedMarketQuery = marketQuery.trim().toLowerCase();
  const contractLookupAddress = canonicalExternalMarketLookupAddress(normalizedMarketQuery);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/external", { cache: "no-store" });
      const payload = (await response.json()) as ExternalMarketResponse;
      if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error || "Market data unavailable.");

      const now = Date.now();
      setLiveSignals(deriveLiveMarketSignals(payload.markets, previousMarketSnapshot.current, now));
      previousMarketSnapshot.current = payload.markets;
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
    const contract = contractLookupAddress;
    if (!contract) {
      setContractLookupStatus("idle");
      setContractLookupMarket(undefined);
      setContractLookupResolution(undefined);
      return;
    }

    const listedMarket = markets.find((market) =>
      market.address.toLowerCase() === contract
      || market.pairAddress.toLowerCase() === contract
    );
    if (listedMarket) {
      setContractLookupStatus("resolved");
      setContractLookupMarket(listedMarket);
      setContractLookupResolution(listedMarket.resolution);
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ contract });
    setContractLookupStatus("searching");
    setContractLookupMarket(undefined);
    setContractLookupResolution(undefined);
    void fetch(`/api/markets/external?${query}`, {
      cache: "no-store",
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json() as ExternalMarketResponse;
      if (!response.ok || !Array.isArray(payload.markets)) {
        throw new Error(payload.error || "Contract lookup is unavailable.");
      }
      const match = payload.markets.find((market) =>
        market.address.toLowerCase() === contract
        || market.pairAddress.toLowerCase() === contract
      );
      if (controller.signal.aborted) return;
      setContractLookupMarket(match);
      setContractLookupResolution(payload.resolution);
      setContractLookupStatus(match || payload.resolution ? "resolved" : "not-found");
    }).catch(() => {
      if (controller.signal.aborted) return;
      setContractLookupStatus("error");
      setContractLookupMarket(undefined);
      setContractLookupResolution(undefined);
    });
    return () => controller.abort();
  }, [contractLookupAddress, markets]);

  const orderedMarkets = useMemo(() => stabilizeOrder(rankOrder, markets), [markets, rankOrder]);
  const venueCounts = useMemo(() => ({
    all: markets.length,
    uniswap: markets.filter((market) => launchDistributionVenue(market) === "uniswap").length,
    sushi: markets.filter((market) => launchDistributionVenue(market) === "sushi").length,
    other: markets.filter((market) => launchDistributionVenue(market) === "other").length
  }), [markets]);
  const scopedMarkets = useMemo(
    () => venueFilter === "all"
      ? markets
      : markets.filter((market) => launchDistributionVenue(market) === venueFilter),
    [markets, venueFilter]
  );
  const counts = useMemo(() => externalMarketViewCounts(scopedMarkets), [scopedMarkets]);
  const rankByAddress = useMemo(
    () => new Map(
      orderedMarkets.map((market, index) => [
        market.address.toLowerCase(),
        index + 1
      ])
    ),
    [orderedMarkets]
  );
  const viewMarkets = useMemo(
    () => selectExternalMarketView([...orderedMarkets], view),
    [orderedMarkets, view]
  );
  const searchableMarkets = contractLookupMarket
    ? [
        contractLookupMarket,
        ...orderedMarkets.filter((market) =>
          market.address.toLowerCase() !== contractLookupMarket.address.toLowerCase()
        )
      ]
    : orderedMarkets;
  const searchedMarkets = normalizedMarketQuery
    ? searchableMarkets.filter((market) => [
        market.name,
        market.symbol,
        market.address,
        market.pairAddress,
        ...(market.stockAssetRelationships ?? []).flatMap((relationship) => [
          relationship.tokenSymbol,
          relationship.tokenName,
          relationship.contractAddress
        ])
      ].some((value) => value.toLowerCase().includes(normalizedMarketQuery)))
    : viewMarkets;
  const filteredMarkets = normalizedMarketQuery
    ? searchedMarkets
    : searchedMarkets.filter((market) => venueFilter === "all" || launchDistributionVenue(market) === venueFilter);
  const expandedDirectory =
    showAllMarkets || normalizedMarketQuery.length > 0;
  const visibleMarkets = expandedDirectory
    ? filteredMarkets
    : filteredMarkets.slice(0, MAX_VISIBLE_MARKETS);
  const marketCountLabel = contractLookupAddress && contractLookupStatus === "searching"
    ? "Searching Robinhood Chain…"
    : normalizedMarketQuery
      ? filteredMarkets.length + " match" + (filteredMarkets.length === 1 ? "" : "es")
    : showAllMarkets
      ? "Showing all " + filteredMarkets.length
      : "Top " + Math.min(MAX_VISIBLE_MARKETS, filteredMarkets.length) +
        " of " + filteredMarkets.length;

  const changeView = (nextView: DiscoveryView) => {
    setView(nextView);
    setMarketQuery("");
    setShowAllMarkets(nextView === "explore");
  };
  const handleMarketQueryChange = (value: string) => {
    setMarketQuery(value);
    if (value.trim()) {
      setView("explore");
      setShowAllMarkets(true);
      setVenueFilter("all");
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
          <p className="eyebrow">RMT MARKET INTELLIGENCE</p>
          <h2 id="external-markets-title" ref={runnerHeading} tabIndex={-1}>Runner signals</h2>
          <p>Market-first discovery across Robinhood Chain, ranked by liquidity, two-sided activity and acceleration.</p>
        </div>
        <span className="externalBadge"><i aria-hidden="true" />{status === "loading" ? "SYNCING MARKETS" : status === "stale" ? "DATA DELAYED" : "LIVE · 60S RANKS"}</span>
      </div>

      <p className="srOnly" aria-live="polite">{rankingAnnouncement}</p>
      {status === "stale" && (
        <p className="runnerDataNotice" role="status">
          <span>Data delayed · showing the last successful snapshot{updatedAt ? " from " + snapshotTime(updatedAt) : ""}. Direct venue trading remains available.</span>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </p>
      )}
      <LiveSignalDesk signals={liveSignals} loading={status === "loading"} />
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
          disabled={!normalizedMarketQuery && filteredMarkets.length === 0}
          onClick={handleDirectoryAction}
        >
          {normalizedMarketQuery
            ? "Clear search"
            : showAllMarkets
              ? "Show top twelve"
              : "Browse all " + filteredMarkets.length}
        </button>
      </div>
      {contractLookupAddress && (
        <p className={`runnerContractLookup ${contractLookupStatus}`} role="status">
          <i aria-hidden="true" />
          {contractLookupStatus === "idle"
            ? "Preparing exact contract lookup…"
            : contractLookupStatus === "searching"
            ? "Searching beyond the loaded market list…"
            : contractLookupStatus === "resolved"
              ? contractLookupMarket
                ? contractLookupMarket.resolution
                  ? "Canonical pool found directly on Robinhood Chain. Live route verification is available."
                  : "Exact contract market found on Robinhood Chain."
                : "Token contract found on Robinhood Chain. No supported pool is available yet."
              : contractLookupStatus === "not-found"
                ? "No Robinhood Chain DEX market was found for this contract."
                : "Direct contract lookup is temporarily delayed."}
        </p>
      )}
      {contractLookupAddress
        && contractLookupStatus === "resolved"
        && !contractLookupMarket
        && contractLookupResolution && (
          <div className="runnerResolvedToken">
            <span><small>ONCHAIN TOKEN</small><strong>{contractLookupResolution.token.name} · ${contractLookupResolution.token.symbol}</strong></span>
            <Link href={`/market/${contractLookupResolution.token.address}`}>Open token workspace →</Link>
          </div>
        )}
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
              {item.label}<span>{status === "loading" ? "—" : counts[item.id]}</span>
            </button>
          ))}
        </div>
        <small id="runner-market-count" aria-live="polite">{marketCountLabel}</small>
      </div>
      <div className="runnerSourceFilters" role="group" aria-label="Filter markets by observed venue">
        <span>Market</span>
        {VENUE_FILTERS.map((item) => (
          <button
            type="button"
            aria-pressed={venueFilter === item.id}
            className={venueFilter === item.id ? "active" : ""}
            onClick={() => {
              setVenueFilter(item.id);
              setShowAllMarkets(view === "explore");
            }}
            key={item.id}
          >
            {item.label}<b>{status === "loading" ? "—" : venueCounts[item.id]}</b>
          </button>
        ))}
        <span className="runnerFilterDivider">Execution route checked on open</span>
      </div>

      <div className="runnerEdgeBrief" role="note">
        <strong>RMT EDGE</strong>
        <span>Signals only appear after liquidity, two-sided trading, activity and pace qualify. A signal is evidence to review—not a profit promise.</span>
      </div>

      <div className="runnerColumnHeader" aria-hidden="true">
        <span>Rank / signal</span><span>Market / age</span><span>Valuation / 5m</span><span>1h flow / liquidity</span><span>Evidence / risk</span><span>Execute</span>
      </div>

      <div id="runner-market-panel" role="tabpanel" aria-labelledby={"runner-tab-" + view}>
        {status === "loading" ? (
          <div className="emptyFeed" role="status"><strong>Loading market intelligence…</strong><span>Scanning Sushi and Uniswap activity, age, liquidity, flow, public discovery and verified project metadata.</span></div>
        ) : status === "error" ? (
          <div className="emptyFeed"><strong>Market discovery is temporarily unavailable.</strong><span>Direct venue trading remains available.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>
        ) : visibleMarkets.length === 0 ? (
          <div className="emptyFeed">
            <strong>{contractLookupAddress && contractLookupStatus === "searching"
                ? "Searching the chain for this contract…"
                : contractLookupAddress && contractLookupStatus === "not-found"
                  ? "No live DEX market was found for this contract."
                  : contractLookupAddress && contractLookupStatus === "error"
                    ? "Direct contract lookup is temporarily delayed."
              : normalizedMarketQuery
                ? "No external markets match that search."
                : "No markets meet this signal yet."}</strong>
            <span>{contractLookupAddress && contractLookupStatus === "searching"
                ? "RMT is checking Sushi and Uniswap market data beyond the loaded terminal snapshot."
                : contractLookupAddress && contractLookupStatus === "not-found"
                  ? "Check that this is the token contract on Robinhood Chain and that a DEX pool has been created."
                  : contractLookupAddress && contractLookupStatus === "error"
                    ? "The loaded terminal remains available. Clear the search or retry this contract shortly."
              : normalizedMarketQuery
              ? "Try a token name, ticker, or complete contract address."
              : venueFilter !== "all"
                ? "No markets meet the selected venue filter."
                : "The filter will update automatically when activity qualifies."}</span>
            {normalizedMarketQuery
              ? <button type="button" onClick={clearMarketQuery}>Clear search</button>
              : view !== "explore" && <button type="button" onClick={() => changeView("explore")}>Explore all markets</button>}
          </div>
        ) : (
          <div className="externalMarketGrid runnerMarketGrid">
            {visibleMarkets.map((market, index) => {
              const value = valuation(market);
              const changeClass = market.priceChange5m > 0 ? "positive" : market.priceChange5m < 0 ? "negative" : "flat";
              const marketRank = rankByAddress.get(market.address.toLowerCase()) ?? index + 1;
              const mobileMoveLabel = market.curve
                ? (market.curve.progressBps / 100).toFixed(1) + "%"
                : (market.priceChange5m > 0 ? "+" : "") + market.priceChange5m.toFixed(2) + "%";
              const addressKey = market.address.toLowerCase();
              const mobileReviewRequired = market.riskFlags.length > 0;
              const mobileActionLabel = mobileReviewRequired
                ? "Review"
                : "Trade";
              const mobileWorkspaceHref = `/market/${market.address}${mobileReviewRequired ? "?tab=safety" : ""}`;
              const distribution = marketDistributionPassport(market);
              const stockAssetLabel = market.stockAssetRelationships?.length
                ? market.stockAssetRelationships.map((relationship) => relationship.tokenSymbol).join("+")
                  + (market.stockAssetRelationships.some((relationship) => relationship.relationship === "canonical-stock-token")
                    ? " stock token"
                    : " pair")
                : "";
              return (
                <article className="externalMarketCard runnerMarketCard" data-signal={market.signal} key={market.address}>
                  <div className="mobileRunnerMarketRow">
                    <a className="mobileRunnerIdentity" href={mobileWorkspaceHref} aria-label={`Open ${market.name} ${mobileReviewRequired ? "safety review" : "trading workspace"}`}>
                      <span className="mobileRunnerRank">#{String(marketRank).padStart(2, "0")}</span>
                      <ExternalArtwork market={market} />
                      <span className="mobileRunnerCopy">
                        <strong>{market.name}</strong>
                        <small>{"$" + cleanSymbol(market.symbol)} · {marketAge(market.ageMinutes)}{stockAssetLabel ? ` · ${stockAssetLabel}` : ""}</small>
                        <em>{distribution.shortLabel}</em>
                      </span>
                    </a>
                    <a
                      className={`mobileRunnerTrade ${mobileReviewRequired ? "review" : "ready"}`}
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
                      <span><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong></span>
                    </div>
                  </div>
                  <div className="runnerCardStatus">
                    <span className={"marketSignal " + market.signal}>{signalLabel(market.signal)}</span>
                    <span>#{String(marketRank).padStart(2, "0")} · Score {market.momentumScore}</span>
                    <small>{marketAge(market.ageMinutes)}</small>
                  </div>
                  <div className="externalIdentity">
                    <ExternalArtwork market={market} />
                    <span>
                      <a className="externalIdentityLink" href={`/market/${market.address}`} aria-label={`Open ${market.name} trading workspace`} onClick={() => recordExperienceStage("discovery_used")}><strong>{market.name}</strong></a>
                      <small>{"$" + cleanSymbol(market.symbol)} · Venue: {venueLabel(market)}{stockAssetLabel ? ` · ${stockAssetLabel}` : ""}</small>
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
                      : runnerReason(market)}</span>
                    {market.riskFlags.length > 0 && <em>{riskSummary(market.riskFlags)}</em>}
                  </div>
                  <div className="externalMarketActions">
                    <Link className="buyCardAction" href={`/market/${market.address}?side=buy`} onClick={() => recordExperienceStage("trade_preparation_opened")}>Buy</Link>
                    <Link className="sellCardAction" href={`/market/${market.address}?side=sell`} onClick={() => recordExperienceStage("trade_preparation_opened")}>Sell</Link>
                  </div>
                  <a className="externalChartLink" href={market.url} target="_blank" rel="noreferrer" aria-label={"View " + market.name + " market source"}>{market.curve ? "Open verified curve ↗" : "Chart & pair ↗"}</a>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <p className="externalDisclosure">Market data uses DEX Screener and other documented public records for discovery and cross-checked project identity. Robinhood Stock Token labels require an exact contract match to Robinhood&apos;s live asset registry; a paired market asset does not make another token stock-backed. External artwork is accepted only from its validated HTTPS source when verified project metadata has no image. Project provenance is attached only when token, factory, and referenced-market evidence agree. Provenance is secondary evidence—not the ranking, an endorsement, or an execution promise. Signals are automated review candidates, not investment recommendations or profit guarantees. Buy and Sell always require a fresh Sushi or Uniswap quote and wallet review.</p>

    </section>
  );
}
