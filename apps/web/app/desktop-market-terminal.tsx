"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  externalProjectProvenanceLabel,
  type ExternalMarket,
  type ExternalMarketResponse,
  type UniversalMarketResolution
} from "../lib/external-market";
import {
  canonicalExternalMarketLookupAddress,
  isNonzeroEvmAddress
} from "../lib/external-market-identity";
import {
  externalMarketViewCounts,
  selectExternalMarketView,
  type ExternalMarketDiscoveryView
} from "../lib/external-market-discovery";
import type { ExternalMarketRiskFlag, ExternalMarketSignal } from "../lib/external-market-ranking";
import {
  launchDistributionVenue,
  marketDistributionPassport,
  type LaunchDistributionVenue
} from "../lib/launch-distribution";
import { deriveLiveMarketSignals, type LiveMarketSignal } from "../lib/live-signal-engine";
import { recordExperienceStage } from "../lib/experience-funnel";
import { routeLiquidityDepthLabel } from "../lib/trade-route-selection";
import { ipfsToHttp } from "../lib/token-metadata";
import {
  addToWatchlist,
  readWatchlist,
  removeFromWatchlist,
  WATCHLIST_EVENT
} from "../lib/watchlist";

type FeedStatus = "loading" | "ready" | "stale" | "error";
type ExecutionAvailability = "checking" | "ready" | "view-only" | "unavailable";
type ContractLookupStatus = "idle" | "searching" | "resolved" | "not-found" | "error";
type DiscoveryView = ExternalMarketDiscoveryView;
type SourceFilter = "all" | "attributed" | "pons" | "lemon" | "sushi";
type VenueFilter = "all" | LaunchDistributionVenue;
type MarketSortKey = "rank" | "age" | "valuation" | "change5m" | "volume1h" | "liquidity" | "risk";
type MarketSortDirection = "asc" | "desc";
type MarketSort = { key: MarketSortKey; direction: MarketSortDirection };

const VIEWS: Array<{ id: DiscoveryView; label: string }> = [
  { id: "trending", label: "Signals" },
  { id: "new", label: "New · 24h" },
  { id: "top", label: "Active" },
  { id: "explore", label: "All" }
];
const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All origins" },
  { id: "attributed", label: "Launch sources" },
  { id: "sushi", label: "Sushi Launch" },
  { id: "pons", label: "Pons" },
  { id: "lemon", label: "Lemon" }
];
const VENUE_FILTERS: Array<{ id: VenueFilter; label: string }> = [
  { id: "all", label: "Any venue" },
  { id: "uniswap", label: "Uniswap" },
  { id: "sushi", label: "Sushi" }
];
const RISK_LABELS: Record<ExternalMarketRiskFlag, string> = {
  "thin-liquidity": "Thin liquidity",
  "extreme-price-spike": "Price spike",
  "high-volume-low-trades": "Volume anomaly",
  "very-new-low-activity": "Very new",
  "one-sided-activity": "One-sided flow"
};
const DATA_REFRESH_MS = 30_000;
const RANK_REFRESH_MS = 60_000;
const MAX_VISIBLE_MARKETS = 12;

function money(value: number, price = false) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (price && value < 0.0001) return "$" + value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  return "$" + value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: price ? 6 : 0
  });
}

function cleanSymbol(symbol: string) {
  return symbol.replaceAll("$", "");
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

function riskSummary(flags: ExternalMarketRiskFlag[]) {
  const first = RISK_LABELS[flags[0] ?? "thin-liquidity"];
  return flags.length > 1 ? `${first} +${flags.length - 1}` : first;
}

function originLabel(market: ExternalMarket) {
  if (market.project) return externalProjectProvenanceLabel(market.project);
  if (market.origin.kind === "rmt-v6") return "RMT V6 · Protocol verified";
  if (market.origin.state === "attributed") return `${market.origin.sourceName} · Origin verified`;
  if (market.origin.state === "disputed") return "Origin conflict";
  if (market.origin.state === "unattributed") return "External · No verified origin";
  return "External · Origin unknown";
}

function snapshotTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "an earlier update";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function runnerReason(market: ExternalMarket) {
  const trades5m = market.buys5m + market.sells5m;
  const trades1h = market.buys1h + market.sells1h;
  const pace = market.volume1h > 0
    ? 12 * Math.min(market.volume5m, market.volume1h) / market.volume1h
    : 0;
  if (market.signal === "moving") return `${pace.toFixed(1)}× 5m pace · ${trades5m} recent trades`;
  if (market.signal === "early") return `${trades1h} two-sided trades · qualified young market`;
  return "Observed market · no qualified runner signal";
}

function venueLabel(market: ExternalMarket) {
  return market.venue.kind === "dex" ? market.venue.dexId : "Circus curve";
}

function isUniswapVenue(market: ExternalMarket) {
  if (market.venue.kind !== "dex") return false;
  const venue = market.venue.dexId.trim().toLowerCase();
  return venue === "uniswap" || venue.startsWith("uniswap-");
}

function isSushiVenue(market: ExternalMarket) {
  return market.venue.kind === "dex" && market.venue.dexId.trim().toLowerCase().includes("sushi");
}

function canHandoffToVenue(market: ExternalMarket) {
  return isNonzeroEvmAddress(market.address) && (isSushiVenue(market) || isUniswapVenue(market));
}

function defaultSortDirection(key: MarketSortKey): MarketSortDirection {
  return key === "rank" || key === "age" || key === "risk" ? "asc" : "desc";
}

function sortValue(market: ExternalMarket, key: Exclude<MarketSortKey, "age">, ranks: Map<string, number>) {
  if (key === "rank") return ranks.get(market.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  if (key === "valuation") return valuation(market).value;
  if (key === "change5m") return market.priceChange5m;
  if (key === "volume1h") return market.volume1h;
  if (key === "liquidity") return market.liquidityUsd;
  return market.riskFlags.length;
}

function sortMarkets(markets: ExternalMarket[], sort: MarketSort, ranks: Map<string, number>) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...markets].sort((left, right) => {
    let difference = 0;
    if (sort.key === "age") {
      if (left.ageMinutes === null && right.ageMinutes !== null) return 1;
      if (right.ageMinutes === null && left.ageMinutes !== null) return -1;
      difference = ((left.ageMinutes ?? 0) - (right.ageMinutes ?? 0)) * direction;
    } else {
      difference = (sortValue(left, sort.key, ranks) - sortValue(right, sort.key, ranks)) * direction;
    }
    if (difference !== 0) return difference;
    return (ranks.get(left.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER)
      - (ranks.get(right.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name);
  });
}

function momentumWidth(value: number) {
  if (!Number.isFinite(value)) return 4;
  return Math.min(100, Math.max(Math.abs(value) < 0.01 ? 4 : 12, Math.abs(value) * 4));
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

function LiveSignalCard({ signal, onOpen }: { signal: LiveMarketSignal; onOpen?: () => void }) {
  return (
    <Link
      href={`/market/${signal.token}?tab=activity`}
      className={signal.severity}
      data-kind={signal.kind}
      onClick={onOpen}
    >
      <span>
        <b>{signal.severity === "urgent" ? "URGENT" : signal.severity === "review" ? "REVIEW" : "OBSERVE"}</b>
        <em>${cleanSymbol(signal.symbol)}</em>
      </span>
      <strong>{signal.title}</strong>
      <small>{signal.evidence}</small>
    </Link>
  );
}

function LiveSignalDesk({ signals }: { signals: LiveMarketSignal[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      if (!focusable.length) {
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
    window.addEventListener("keydown", onKeyDown);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.setTimeout(() => returnFocus.current?.focus(), 0);
    };
  }, [close, open]);

  const openBoard = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  };

  return (
    <section className="liveSignalDesk" aria-labelledby="desktop-live-signal-title">
      <header>
        <span><small>RMT LIVE SIGNAL DESK</small><strong id="desktop-live-signal-title">Markets requiring attention</strong></span>
        {signals.length > 5
          ? <button className="liveSignalBoardButton" type="button" aria-haspopup="dialog" onClick={openBoard}>View all {signals.length}</button>
          : <span className="liveSignalCount">{signals.length} live</span>}
      </header>
      {signals.length ? (
        <div className="liveSignalRail" aria-label="Highest-priority live market signals">
          {signals.map((signal) => <LiveSignalCard signal={signal} key={signal.id} />)}
        </div>
      ) : (
        <div className="liveSignalEmpty">
          <strong>No market has cleared a live signal threshold.</strong>
          <span>RMT continues checking activity, pace, price and liquidity every 30 seconds.</span>
        </div>
      )}
      <footer>Read-only observations from validated public market snapshots · never a profit promise or automatic trade</footer>

      {open && signals.length > 5 && <>
        <button className="liveSignalBoardBackdrop" type="button" tabIndex={-1} aria-label="Close complete signal board" onClick={close} />
        <section
          ref={dialog}
          className="liveSignalBoardDialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="complete-live-signal-title"
          tabIndex={-1}
        >
          <header>
            <div>
              <small>RMT SIGNAL BOARD</small>
              <strong id="complete-live-signal-title">All qualified market signals</strong>
              <span>{signals.length} markets · ranked by severity and signal strength</span>
            </div>
            <button ref={closeButton} type="button" onClick={close}>Close</button>
          </header>
          <div className="liveSignalBoardGrid">
            {signals.map((signal) => <LiveSignalCard signal={signal} onOpen={close} key={`board:${signal.id}`} />)}
          </div>
          <footer>Signals are automated review candidates from validated public snapshots. They are not recommendations, profit promises, or automatic trades.</footer>
        </section>
      </>}
    </section>
  );
}

export function DesktopMarketTerminal() {
  const [markets, setMarkets] = useState<ExternalMarket[]>([]);
  const [liveSignals, setLiveSignals] = useState<LiveMarketSignal[]>([]);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [view, setView] = useState<DiscoveryView>("trending");
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [marketQuery, setMarketQuery] = useState("");
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [venueFilter, setVenueFilter] = useState<VenueFilter>("all");
  const [tradeableOnly, setTradeableOnly] = useState(false);
  const [marketSort, setMarketSort] = useState<MarketSort>({ key: "rank", direction: "asc" });
  const [watchedAddresses, setWatchedAddresses] = useState<Set<string>>(new Set());
  const [executionAvailability, setExecutionAvailability] = useState<Record<string, ExecutionAvailability>>({});
  const [lookupStatus, setLookupStatus] = useState<ContractLookupStatus>("idle");
  const [lookupMarket, setLookupMarket] = useState<ExternalMarket>();
  const [lookupResolution, setLookupResolution] = useState<UniversalMarketResolution>();
  const previousMarkets = useRef<ExternalMarket[]>([]);
  const nextRankRefresh = useRef(0);
  const hasSuccessfulData = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const normalizedQuery = marketQuery.trim().toLowerCase();
  const lookupAddress = canonicalExternalMarketLookupAddress(normalizedQuery);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/external", { cache: "no-store" });
      const payload = await response.json() as ExternalMarketResponse;
      if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error || "Market data unavailable.");
      const now = Date.now();
      setLiveSignals(deriveLiveMarketSignals(payload.markets, previousMarkets.current, now));
      previousMarkets.current = payload.markets;
      setMarkets(payload.markets);
      setUpdatedAt(typeof payload.updatedAt === "string" ? payload.updatedAt : new Date(now).toISOString());
      hasSuccessfulData.current = true;
      if (nextRankRefresh.current <= now || rankOrder.length === 0) {
        setRankOrder(payload.markets.map((market) => market.address.toLowerCase()));
        nextRankRefresh.current = now + RANK_REFRESH_MS;
        setAnnouncement(payload.stale ? "Market data is delayed." : "Market rankings updated.");
      }
      setStatus(payload.stale ? "stale" : "ready");
    } catch {
      setStatus(hasSuccessfulData.current ? "stale" : "error");
    }
  }, [rankOrder.length]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), DATA_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const sync = () => setWatchedAddresses(new Set(readWatchlist().map((entry) => entry.address)));
    sync();
    window.addEventListener(WATCHLIST_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (!lookupAddress) {
      setLookupStatus("idle");
      setLookupMarket(undefined);
      setLookupResolution(undefined);
      return;
    }
    const listed = markets.find((market) =>
      market.address.toLowerCase() === lookupAddress || market.pairAddress.toLowerCase() === lookupAddress
    );
    if (listed) {
      setLookupStatus("resolved");
      setLookupMarket(listed);
      setLookupResolution(listed.resolution);
      return;
    }
    const controller = new AbortController();
    setLookupStatus("searching");
    setLookupMarket(undefined);
    setLookupResolution(undefined);
    const query = new URLSearchParams({ contract: lookupAddress });
    void fetch(`/api/markets/external?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ExternalMarketResponse;
        if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error || "Lookup unavailable.");
        const match = payload.markets.find((market) =>
          market.address.toLowerCase() === lookupAddress || market.pairAddress.toLowerCase() === lookupAddress
        );
        if (controller.signal.aborted) return;
        setLookupMarket(match);
        setLookupResolution(payload.resolution);
        setLookupStatus(match || payload.resolution ? "resolved" : "not-found");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLookupStatus("error");
      });
    return () => controller.abort();
  }, [lookupAddress, markets]);

  const orderedMarkets = useMemo(() => stabilizeOrder(rankOrder, markets), [markets, rankOrder]);
  const ranks = useMemo(() => new Map(orderedMarkets.map((market, index) => [market.address.toLowerCase(), index + 1])), [orderedMarkets]);
  const sourceCounts = useMemo(() => ({
    all: markets.length,
    attributed: markets.filter((market) => marketDistributionPassport(market).isAttributedLaunch).length,
    sushi: markets.filter((market) => market.project?.sourceId === "sushi").length,
    pons: markets.filter((market) => market.project?.sourceId === "pons").length,
    lemon: markets.filter((market) => market.project?.sourceId === "lemon").length
  }), [markets]);
  const sourceScopedMarkets = useMemo(() => sourceFilter === "all"
    ? markets
    : sourceFilter === "attributed"
      ? markets.filter((market) => marketDistributionPassport(market).isAttributedLaunch)
      : markets.filter((market) => market.project?.sourceId === sourceFilter), [markets, sourceFilter]);
  const venueCounts = useMemo(() => ({
    all: sourceScopedMarkets.length,
    uniswap: sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === "uniswap").length,
    sushi: sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === "sushi").length,
    other: sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === "other").length
  }), [sourceScopedMarkets]);
  const scopedMarkets = useMemo(() => venueFilter === "all"
    ? sourceScopedMarkets
    : sourceScopedMarkets.filter((market) => launchDistributionVenue(market) === venueFilter), [sourceScopedMarkets, venueFilter]);
  const counts = useMemo(() => externalMarketViewCounts(scopedMarkets), [scopedMarkets]);
  const viewMarkets = useMemo(() => selectExternalMarketView([...orderedMarkets], view), [orderedMarkets, view]);
  const searchableMarkets = lookupMarket
    ? [lookupMarket, ...orderedMarkets.filter((market) => market.address.toLowerCase() !== lookupMarket.address.toLowerCase())]
    : orderedMarkets;
  const searchedMarkets = normalizedQuery
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
      ].some((value) => value.toLowerCase().includes(normalizedQuery)))
    : viewMarkets;
  const sourceFilteredMarkets = normalizedQuery ? searchedMarkets : searchedMarkets.filter((market) => {
    if (sourceFilter === "attributed" && !marketDistributionPassport(market).isAttributedLaunch) return false;
    if (sourceFilter !== "all" && sourceFilter !== "attributed" && market.project?.sourceId !== sourceFilter) return false;
    return venueFilter === "all" || launchDistributionVenue(market) === venueFilter;
  });
  const sortedMarkets = useMemo(() => sortMarkets(sourceFilteredMarkets, marketSort, ranks), [marketSort, ranks, sourceFilteredMarkets]);
  const filteredMarkets = tradeableOnly
    ? sortedMarkets.filter((market) => executionAvailability[market.address.toLowerCase()] === "ready")
    : sortedMarkets;
  const expanded = showAllMarkets || normalizedQuery.length > 0;
  const visibleMarkets = expanded ? filteredMarkets : filteredMarkets.slice(0, MAX_VISIBLE_MARKETS);

  const availabilityCandidates = (tradeableOnly ? sortedMarkets : visibleMarkets.slice(0, MAX_VISIBLE_MARKETS))
    .filter(canHandoffToVenue)
    .map((market) => market.address.toLowerCase());
  const checking = availabilityCandidates.filter((address) => executionAvailability[address] === "checking");
  const unknown = availabilityCandidates.filter((address) => executionAvailability[address] === undefined);
  const availabilityAddresses = tradeableOnly
    ? (checking.length ? checking : unknown).slice(0, MAX_VISIBLE_MARKETS)
    : availabilityCandidates;
  const availabilityKey = availabilityAddresses.join(",");

  useEffect(() => {
    const tokens = availabilityAddresses.filter((address) => executionAvailability[address] === undefined);
    if (!tokens.length) return;
    setExecutionAvailability((current) => ({
      ...current,
      ...Object.fromEntries(tokens.map((address) => [address, "checking" as const]))
    }));
    const controller = new AbortController();
    const query = new URLSearchParams({ tokens: tokens.join(",") });
    void fetch(`/api/trade/external-availability?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as {
          availability?: Array<{ token?: string; status?: Exclude<ExecutionAvailability, "checking"> }>;
        };
        if (!response.ok || !Array.isArray(payload.availability)) throw new Error("Availability unavailable.");
        const requested = new Set(tokens);
        const resolved: Record<string, Exclude<ExecutionAvailability, "checking">> = Object.fromEntries(
          tokens.map((address) => [address, "unavailable" as const])
        );
        for (const item of payload.availability) {
          const address = item.token?.toLowerCase();
          if (!address || !requested.has(address)) continue;
          if (item.status === "ready" || item.status === "view-only" || item.status === "unavailable") resolved[address] = item.status;
        }
        setExecutionAvailability((current) => ({ ...current, ...resolved }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setExecutionAvailability((current) => ({
          ...current,
          ...Object.fromEntries(tokens.map((address) => [address, "unavailable" as const]))
        }));
      });
    return () => controller.abort();
    // The key advances through bounded route-verification batches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityKey]);

  const routeResolvedCount = sortedMarkets.filter((market) => {
    const state = executionAvailability[market.address.toLowerCase()];
    return !canHandoffToVenue(market) || (state !== undefined && state !== "checking");
  }).length;
  const tradeableCount = sortedMarkets.filter((market) => executionAvailability[market.address.toLowerCase()] === "ready").length;
  const routeSyncPending = routeResolvedCount < sortedMarkets.length;
  const tradeableVerificationPending = tradeableOnly && routeSyncPending;
  const marketCountLabel = lookupAddress && lookupStatus === "searching"
    ? "Searching Robinhood Chain…"
    : normalizedQuery
      ? `${filteredMarkets.length} match${filteredMarkets.length === 1 ? "" : "es"}`
      : tradeableVerificationPending
        ? `Verifying routes · ${routeResolvedCount} of ${sortedMarkets.length} checked · ${tradeableCount} tradeable`
        : showAllMarkets
          ? `Showing all ${filteredMarkets.length}`
          : `Top ${Math.min(MAX_VISIBLE_MARKETS, filteredMarkets.length)} of ${filteredMarkets.length}`;

  const changeView = (next: DiscoveryView) => {
    setView(next);
    setMarketQuery("");
    setShowAllMarkets(tradeableOnly || next === "explore");
  };
  const changeSort = (key: MarketSortKey) => {
    setMarketSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: defaultSortDirection(key) });
    setAnnouncement(`Market rows sorted by ${key}.`);
  };
  const sortMarker = (key: MarketSortKey) => marketSort.key === key
    ? marketSort.direction === "asc" ? "↑" : "↓"
    : "↕";
  const toggleWatch = (market: ExternalMarket) => {
    const address = market.address.toLowerCase();
    const watched = watchedAddresses.has(address);
    const image = market.project?.imageUri ?? market.imageUri;
    const updated = watched
      ? removeFromWatchlist(address)
      : addToWatchlist({
          address,
          name: market.name,
          symbol: cleanSymbol(market.symbol),
          addedAt: Date.now(),
          ...(image ? { image } : {})
        });
    setAnnouncement(updated
      ? `${market.name} ${watched ? "removed from" : "added to"} your watchlist.`
      : "The watchlist could not be updated in this browser.");
  };
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: DiscoveryView) => {
    const index = VIEWS.findIndex((item) => item.id === current);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % VIEWS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + VIEWS.length) % VIEWS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = VIEWS.length - 1;
    else return;
    event.preventDefault();
    const next = VIEWS[nextIndex].id;
    changeView(next);
    document.getElementById(`desktop-runner-tab-${next}`)?.focus();
  };

  return (
    <section className="panel externalMarkets runnerRadar terminalMarketShell desktopMarketTerminal" id="market-explorer" aria-labelledby="desktop-market-title">
      <div className="feedHeading externalHeading">
        <div>
          <p className="eyebrow">RMT MARKET INTELLIGENCE</p>
          <h2 id="desktop-market-title" ref={heading} tabIndex={-1}>Runner signals</h2>
          <p>Market-first discovery across Robinhood Chain, ranked by liquidity, two-sided activity and acceleration.</p>
        </div>
        <span className="externalBadge"><i aria-hidden="true" />{status === "stale" ? "DATA DELAYED" : "LIVE · 60S RANKS"}</span>
      </div>

      <p className="srOnly" aria-live="polite">{announcement}</p>
      {status === "stale" && (
        <p className="runnerDataNotice" role="status">
          <span>Data delayed · showing the last successful snapshot{updatedAt ? ` from ${snapshotTime(updatedAt)}` : ""}. Market workspaces still request fresh venue evidence.</span>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </p>
      )}

      <LiveSignalDesk signals={liveSignals} />

      <div className="runnerDirectoryControls" role="search" aria-label="Search Robinhood Chain markets">
        <div className="runnerMarketSearch">
          <span aria-hidden="true">⌕</span>
          <label className="srOnly" htmlFor="desktop-market-search">Search by name, ticker, token, or pool contract</label>
          <input
            id="desktop-market-search"
            ref={searchInput}
            type="search"
            value={marketQuery}
            onChange={(event) => {
              const value = event.target.value;
              setMarketQuery(value);
              if (value.trim()) {
                setView("explore");
                setShowAllMarkets(true);
                setSourceFilter("all");
                setVenueFilter("all");
                setTradeableOnly(false);
              }
            }}
            placeholder="Search name, ticker, token, or pool contract · press /"
            autoComplete="off"
            spellCheck={false}
            aria-keyshortcuts="/"
            aria-describedby="desktop-market-count"
            maxLength={96}
          />
          {marketQuery && <button type="button" aria-label="Clear market search" onClick={() => { setMarketQuery(""); searchInput.current?.focus(); }}>×</button>}
        </div>
        <button
          className="runnerDirectoryButton"
          type="button"
          aria-controls="desktop-runner-market-panel"
          aria-expanded={expanded}
          disabled={!normalizedQuery && filteredMarkets.length === 0}
          onClick={() => {
            if (normalizedQuery) setMarketQuery("");
            else if (showAllMarkets) setShowAllMarkets(false);
            else { setView("explore"); setShowAllMarkets(true); }
          }}
        >
          {normalizedQuery ? "Clear search" : showAllMarkets ? "Show top twelve" : `Browse all ${filteredMarkets.length}`}
        </button>
      </div>

      {lookupAddress && (
        <p className={`runnerContractLookup ${lookupStatus}`} role="status">
          <i aria-hidden="true" />
          {lookupStatus === "searching"
            ? "Searching beyond the loaded market list…"
            : lookupStatus === "resolved"
              ? lookupMarket
                ? lookupMarket.resolution
                  ? "Canonical market found directly on Robinhood Chain."
                  : "Exact contract market found."
                : "Token found, but no supported pool is available yet."
              : lookupStatus === "not-found"
                ? "No Robinhood Chain DEX market was found for this contract."
                : lookupStatus === "error"
                  ? "Direct contract lookup is temporarily delayed."
                  : "Preparing exact contract lookup…"}
        </p>
      )}
      {lookupAddress && lookupStatus === "resolved" && !lookupMarket && lookupResolution && (
        <div className="runnerResolvedToken">
          <span><small>ONCHAIN TOKEN</small><strong>{lookupResolution.token.name} · ${lookupResolution.token.symbol}</strong></span>
          <Link href={`/market/${lookupResolution.token.address}`}>Open token workspace →</Link>
        </div>
      )}

      <div className="runnerToolbar">
        <div className="runnerTabs" role="tablist" aria-label="Market discovery views">
          {VIEWS.map((item) => (
            <button
              type="button"
              role="tab"
              id={`desktop-runner-tab-${item.id}`}
              aria-controls="desktop-runner-market-panel"
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
        <small id="desktop-market-count" aria-live="polite">{marketCountLabel}</small>
      </div>

      <div className="runnerSourceFilters" role="group" aria-label="Filter markets by venue, source, or execution availability">
        <span>Market</span>
        {VENUE_FILTERS.map((item) => (
          <button
            type="button"
            aria-pressed={venueFilter === item.id}
            className={venueFilter === item.id ? "active" : ""}
            onClick={() => { setVenueFilter(item.id); setShowAllMarkets(tradeableOnly || view === "explore"); }}
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
          onClick={() => { setTradeableOnly((current) => !current); setShowAllMarkets(!tradeableOnly || view === "explore"); }}
        >
          {routeSyncPending ? "Routes syncing" : "Tradeable"}<b>{routeSyncPending ? `${routeResolvedCount}/${sortedMarkets.length}` : tradeableCount}</b>
        </button>
        <details className="runnerOriginFilters">
          <summary>Source · {sourceFilter === "all" ? "All" : SOURCE_FILTERS.find((item) => item.id === sourceFilter)?.label}</summary>
          <div>
            {SOURCE_FILTERS.map((item) => (
              <button
                type="button"
                aria-pressed={sourceFilter === item.id}
                className={sourceFilter === item.id ? "active" : ""}
                onClick={() => { setSourceFilter(item.id); setShowAllMarkets(tradeableOnly || view === "explore"); }}
                key={item.id}
              >
                {item.label}<b>{sourceCounts[item.id]}</b>
              </button>
            ))}
          </div>
        </details>
      </div>

      <div className="runnerColumnHeader" aria-label="Sortable market columns">
        <button type="button" className={marketSort.key === "rank" ? "active" : ""} aria-pressed={marketSort.key === "rank"} onClick={() => changeSort("rank")}><span>Rank / signal</span><b aria-hidden="true">{sortMarker("rank")}</b></button>
        <button type="button" className={marketSort.key === "age" ? "active" : ""} aria-pressed={marketSort.key === "age"} onClick={() => changeSort("age")}><span>Market / age</span><b aria-hidden="true">{sortMarker("age")}</b></button>
        <div className="runnerHeaderSplit">
          <button type="button" className={marketSort.key === "valuation" ? "active" : ""} aria-pressed={marketSort.key === "valuation"} onClick={() => changeSort("valuation")}><span>Valuation</span><b aria-hidden="true">{sortMarker("valuation")}</b></button>
          <button type="button" className={marketSort.key === "change5m" ? "active" : ""} aria-pressed={marketSort.key === "change5m"} onClick={() => changeSort("change5m")}><span>5m</span><b aria-hidden="true">{sortMarker("change5m")}</b></button>
        </div>
        <div className="runnerHeaderSplit">
          <button type="button" className={marketSort.key === "volume1h" ? "active" : ""} aria-pressed={marketSort.key === "volume1h"} onClick={() => changeSort("volume1h")}><span>1h flow</span><b aria-hidden="true">{sortMarker("volume1h")}</b></button>
          <button type="button" className={marketSort.key === "liquidity" ? "active" : ""} aria-pressed={marketSort.key === "liquidity"} onClick={() => changeSort("liquidity")}><span>Liquidity</span><b aria-hidden="true">{sortMarker("liquidity")}</b></button>
        </div>
        <button type="button" className={marketSort.key === "risk" ? "active" : ""} aria-pressed={marketSort.key === "risk"} onClick={() => changeSort("risk")}><span>Evidence / risk</span><b aria-hidden="true">{sortMarker("risk")}</b></button>
        <span>Execute</span>
      </div>

      <div id="desktop-runner-market-panel" role="tabpanel" aria-labelledby={`desktop-runner-tab-${view}`}>
        {status === "loading" ? (
          <div className="emptyFeed" role="status"><strong>Loading market intelligence…</strong><span>Scanning venue activity, age, liquidity, flow, and verified project metadata.</span></div>
        ) : status === "error" ? (
          <div className="emptyFeed"><strong>Market discovery is temporarily unavailable.</strong><span>Existing token workspaces and direct venue execution remain available.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>
        ) : visibleMarkets.length === 0 ? (
          <div className="emptyFeed">
            <strong>{tradeableVerificationPending
              ? "Verifying in-site execution routes…"
              : normalizedQuery ? "No markets match that search." : tradeableOnly ? "No verified routes match these filters." : "No markets meet this signal yet."}</strong>
            <span>{tradeableVerificationPending
              ? "RMT is checking prioritized markets in bounded batches."
              : normalizedQuery ? "Try a name, ticker, token contract, or pool contract." : "The scanner updates automatically as activity qualifies."}</span>
            {normalizedQuery && <button type="button" onClick={() => setMarketQuery("")}>Clear search</button>}
          </div>
        ) : (
          <div className="externalMarketGrid runnerMarketGrid">
            {visibleMarkets.map((market, index) => {
              const value = valuation(market);
              const marketRank = ranks.get(market.address.toLowerCase()) ?? index + 1;
              const addressKey = market.address.toLowerCase();
              const watched = watchedAddresses.has(addressKey);
              const executionState: ExecutionAvailability = canHandoffToVenue(market)
                ? executionAvailability[addressKey] ?? (index < MAX_VISIBLE_MARKETS ? "checking" : "unavailable")
                : "view-only";
              const distribution = marketDistributionPassport(market);
              const stockAssetLabel = market.stockAssetRelationships?.length
                ? market.stockAssetRelationships.map((relationship) => relationship.tokenSymbol).join("+")
                  + (market.stockAssetRelationships.some((relationship) => relationship.relationship === "canonical-stock-token") ? " stock token" : " pair")
                : "";
              return (
                <article className="externalMarketCard runnerMarketCard" data-signal={market.signal} key={market.address}>
                  <div className="runnerCardStatus">
                    <span className={`marketSignal ${market.signal}`}>{signalLabel(market.signal)}</span>
                    <span>#{String(marketRank).padStart(2, "0")} · Score {market.momentumScore}</span>
                    <small>{marketAge(market.ageMinutes)}</small>
                  </div>

                  <div className="externalIdentity">
                    <ExternalArtwork market={market} />
                    <span>
                      <Link className="externalIdentityLink" href={`/market/${market.address}`} onClick={() => recordExperienceStage("discovery_used")}><strong>{market.name}</strong></Link>
                      <small>{`$${cleanSymbol(market.symbol)} · ${venueLabel(market)}${stockAssetLabel ? ` · ${stockAssetLabel}` : ""}`}</small>
                      {market.project?.creator && <small className="runnerCreator" title={market.project.creator}>Creator {shortAddress(market.project.creator)}</small>}
                      <small className={`runnerDistribution ${distribution.state}`}>{distribution.shortLabel}</small>
                    </span>
                    <button
                      className={watched ? "runnerWatchButton active" : "runnerWatchButton"}
                      type="button"
                      aria-pressed={watched}
                      aria-label={`${watched ? "Remove" : "Add"} ${market.name} ${watched ? "from" : "to"} watchlist`}
                      title={watched ? "Remove from watchlist" : "Add to watchlist"}
                      onClick={() => toggleWatch(market)}
                    ><span aria-hidden="true">{watched ? "★" : "☆"}</span></button>
                    <em>{originLabel(market)}</em>
                  </div>

                  <div className="runnerStats">
                    <span><small>{value.label}</small><strong>{money(value.value)}</strong></span>
                    {market.curve
                      ? <span className="positive"><small>Curve progress</small><strong>{(market.curve.progressBps / 100).toFixed(2)}%</strong></span>
                      : <span className={changeTone(market.priceChange5m)}><small>5m change</small><strong>{signedPercent(market.priceChange5m)}</strong></span>}
                    {market.curve
                      ? <span><small>ETH raised</small><strong>{market.curve.ethRaised.toFixed(4)} ETH</strong></span>
                      : <span><small>1h volume</small><strong>{money(market.volume1h)}</strong></span>}
                    <span><small>{market.curve ? "Curve liquidity" : "Liquidity"}</small><strong>{money(market.liquidityUsd)}</strong></span>
                  </div>

                  <div className="runnerActivity">
                    <span>{market.curve
                      ? `${market.curve.uniqueTraders} traders · ${market.curve.volumeQuoteEth.toFixed(3)} ETH curve volume`
                      : runnerReason(market)}</span>
                    {!market.curve && (
                      <div className="runnerMomentumProfile" aria-label={`Momentum: 5 minutes ${signedPercent(market.priceChange5m)}, 1 hour ${signedPercent(market.priceChange1h)}, 24 hours ${signedPercent(market.priceChange24h)}`}>
                        {[
                          { label: "5m", value: market.priceChange5m },
                          { label: "1h", value: market.priceChange1h },
                          { label: "24h", value: market.priceChange24h }
                        ].map((movement) => (
                          <span className={changeTone(movement.value)} key={movement.label}>
                            <small>{movement.label}</small><i style={{ width: `${momentumWidth(movement.value)}%` }} />
                          </span>
                        ))}
                      </div>
                    )}
                    {market.riskFlags.length > 0 && <em>{riskSummary(market.riskFlags)}</em>}
                  </div>

                  {executionState === "ready" ? (
                    <div className="externalMarketActions">
                      <Link className="buyCardAction" href={`/market/${market.address}?side=buy`} onClick={() => recordExperienceStage("trade_preparation_opened")}>Buy</Link>
                      <Link className="sellCardAction" href={`/market/${market.address}?side=sell`} onClick={() => recordExperienceStage("trade_preparation_opened")}>Sell</Link>
                    </div>
                  ) : (
                    <Link className="externalBadge routeReviewAction" href={`/market/${market.address}`}>
                      {executionState === "checking" ? "VERIFYING ROUTE" : executionState === "view-only" ? "VIEW ONLY" : "REVIEW ROUTE"}
                    </Link>
                  )}
                  <a className="externalChartLink" href={market.url} target="_blank" rel="noreferrer">{market.curve ? "Open verified curve ↗" : `Chart · ${routeLiquidityDepthLabel(market.liquidityUsd)} ↗`}</a>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <details className="externalDisclosure">
        <summary>Data and methodology</summary>
        <p>Market data uses DEX Screener market data and public discovery, with documented launch APIs for cross-checked identity. Launch identity is attached only when token and pool evidence agree. Signals are automated review candidates—not investment recommendations or profit guarantees. Every Buy or Sell opens the complete RMT workspace, requests fresh Sushi or Uniswap evidence, and still requires wallet review.</p>
      </details>
    </section>
  );
}
