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
import { ipfsToHttp } from "../lib/token-metadata";
import { routeLiquidityDepthLabel } from "../lib/trade-route-selection";
import {
  addToWatchlist,
  readWatchlist,
  removeFromWatchlist,
  WATCHLIST_EVENT
} from "../lib/watchlist";
import { recordExperienceStage } from "../lib/experience-funnel";

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
  { id: "attributed", label: "Verified sources" },
  { id: "sushi", label: "Sushi Launch" },
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
const MAX_ROUTE_BATCH = 48;

function money(value: number, priceValue = false) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (priceValue && value < 0.0001) {
    return "$" + value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  return "$" + value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: priceValue ? 6 : 0
  });
}

function cleanSymbol(symbol: string) {
  return symbol.replaceAll("$", "");
}

function initials(symbol: string) {
  return cleanSymbol(symbol).slice(0, 2).toUpperCase() || "↗";
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

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function snapshotTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "an earlier update";
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

function venueLabel(market: ExternalMarket) {
  return market.venue.kind === "dex" ? market.venue.dexId : "Circus curve";
}

function executionProvider(market: ExternalMarket) {
  if (market.venue.kind !== "dex") return null;
  const venue = market.venue.dexId.toLowerCase();
  if (venue.includes("sushi")) return "Sushi";
  if (venue === "uniswap" || venue.startsWith("uniswap-")) return "Uniswap";
  return null;
}

function canVerifyExecution(market: ExternalMarket) {
  return isNonzeroEvmAddress(market.address) && executionProvider(market) !== null;
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

function defaultSortDirection(key: MarketSortKey): MarketSortDirection {
  return key === "rank" || key === "age" || key === "risk" ? "asc" : "desc";
}

function sortMarkets(markets: ExternalMarket[], sort: MarketSort, rank: Map<string, number>) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...markets].sort((left, right) => {
    let leftValue: number;
    let rightValue: number;
    if (sort.key === "rank") {
      leftValue = rank.get(left.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      rightValue = rank.get(right.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    } else if (sort.key === "age") {
      leftValue = left.ageMinutes ?? Number.MAX_SAFE_INTEGER;
      rightValue = right.ageMinutes ?? Number.MAX_SAFE_INTEGER;
    } else if (sort.key === "valuation") {
      leftValue = valuation(left).value;
      rightValue = valuation(right).value;
    } else if (sort.key === "change5m") {
      leftValue = left.priceChange5m;
      rightValue = right.priceChange5m;
    } else if (sort.key === "volume1h") {
      leftValue = left.volume1h;
      rightValue = right.volume1h;
    } else if (sort.key === "liquidity") {
      leftValue = left.liquidityUsd;
      rightValue = right.liquidityUsd;
    } else {
      leftValue = left.riskFlags.length;
      rightValue = right.riskFlags.length;
    }
    const difference = (leftValue - rightValue) * direction;
    if (difference !== 0) return difference;
    return (rank.get(left.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER);
  });
}

function momentumWidth(value: number) {
  if (!Number.isFinite(value)) return 4;
  return Math.min(100, Math.max(Math.abs(value) < 0.01 ? 4 : 12, Math.abs(value) * 4));
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

function SignalCard({ signal }: { signal: LiveMarketSignal }) {
  const status = signal.severity === "urgent" ? "URGENT" : signal.severity === "review" ? "REVIEW" : "OBSERVE";
  return (
    <Link
      href={`/market/${signal.token}?tab=activity`}
      className={signal.severity}
      data-kind={signal.kind}
    >
      <span><b>{status}</b><em>${cleanSymbol(signal.symbol)}</em></span>
      <strong>{signal.title}</strong>
      <small>{signal.evidence}</small>
    </Link>
  );
}

function LiveSignalDesk({ signals }: { signals: LiveMarketSignal[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) return;
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
    close.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.setTimeout(() => returnFocus.current?.focus(), 0);
    };
  }, [open]);

  const openBoard = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  };

  return (
    <section className="liveSignalDesk" aria-labelledby="live-signal-desk-title">
      <header>
        <span><small>RMT LIVE SIGNAL DESK</small><strong id="live-signal-desk-title">Markets requiring attention</strong></span>
        {signals.length > 5
          ? <button className="liveSignalBoardButton" type="button" aria-haspopup="dialog" onClick={openBoard}>View all {signals.length}</button>
          : <span className="liveSignalCount">{signals.length} live</span>}
      </header>
      {signals.length ? (
        <div className="liveSignalRail" aria-label="Highest-priority market signals">
          {signals.map((signal) => <SignalCard signal={signal} key={signal.id} />)}
        </div>
      ) : (
        <div className="liveSignalEmpty">
          <strong>No market has cleared a live signal threshold.</strong>
          <span>RMT continues checking activity, pace, price, and liquidity every 30 seconds.</span>
        </div>
      )}
      <footer>Read-only observations from validated public market snapshots · never a profit promise or automatic trade</footer>

      {open && signals.length > 5 && <>
        <button className="liveSignalBoardBackdrop" type="button" tabIndex={-1} aria-label="Close signal board" onClick={() => setOpen(false)} />
        <section ref={dialog} className="liveSignalBoardDialog" role="dialog" aria-modal="true" aria-labelledby="live-signal-board-title" tabIndex={-1}>
          <header>
            <div>
              <small>RMT SIGNAL BOARD</small>
              <strong id="live-signal-board-title">All qualified market signals</strong>
              <span>{signals.length} markets · ranked by severity and signal strength</span>
            </div>
            <button ref={close} type="button" onClick={() => setOpen(false)}>Close</button>
          </header>
          <div className="liveSignalBoardGrid">
            {signals.map((signal) => <SignalCard signal={signal} key={`board:${signal.id}`} />)}
          </div>
          <footer>Signals are automated review candidates from validated public snapshots—not recommendations, profit promises, or automatic trades.</footer>
        </section>
      </>}
    </section>
  );
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

export function ExternalMarketFeedV10() {
  const [markets, setMarkets] = useState<ExternalMarket[]>([]);
  const [liveSignals, setLiveSignals] = useState<LiveMarketSignal[]>([]);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [view, setView] = useState<DiscoveryView>("trending");
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [marketQuery, setMarketQuery] = useState("");
  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [venueFilter, setVenueFilter] = useState<VenueFilter>("all");
  const [tradeableOnly, setTradeableOnly] = useState(false);
  const [marketSort, setMarketSort] = useState<MarketSort>({ key: "rank", direction: "asc" });
  const [executionAvailability, setExecutionAvailability] = useState<Record<string, ExecutionAvailability>>({});
  const [watchedAddresses, setWatchedAddresses] = useState(() => new Set<string>());
  const [contractLookupStatus, setContractLookupStatus] = useState<ContractLookupStatus>("idle");
  const [contractLookupMarket, setContractLookupMarket] = useState<ExternalMarket>();
  const [contractLookupResolution, setContractLookupResolution] = useState<UniversalMarketResolution>();
  const [announcement, setAnnouncement] = useState("");
  const previousSnapshot = useRef<ExternalMarket[]>([]);
  const rankRefreshAt = useRef(0);
  const hasData = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const normalizedQuery = marketQuery.trim().toLowerCase();
  const contractLookupAddress = canonicalExternalMarketLookupAddress(normalizedQuery);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/external", { cache: "no-store" });
      const payload = await response.json() as ExternalMarketResponse;
      if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error ?? "Market data unavailable.");
      const now = Date.now();
      setLiveSignals(deriveLiveMarketSignals(payload.markets, previousSnapshot.current, now));
      previousSnapshot.current = payload.markets;
      setMarkets(payload.markets);
      setUpdatedAt(payload.updatedAt ?? new Date(now).toISOString());
      if (rankRefreshAt.current <= now || !rankOrder.length) {
        setRankOrder(payload.markets.map((market) => market.address.toLowerCase()));
        rankRefreshAt.current = now + RANK_REFRESH_MS;
        setAnnouncement(payload.stale ? "Market data is delayed." : "Market rankings updated.");
      }
      hasData.current = true;
      setStatus(payload.stale ? "stale" : "ready");
    } catch {
      setStatus(hasData.current ? "stale" : "error");
    }
  }, [rankOrder.length]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), DATA_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const sync = () => setWatchedAddresses(new Set(readWatchlist().map((entry) => entry.address.toLowerCase())));
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
    if (!contractLookupAddress) {
      setContractLookupStatus("idle");
      setContractLookupMarket(undefined);
      setContractLookupResolution(undefined);
      return;
    }
    const listed = markets.find((market) =>
      market.address.toLowerCase() === contractLookupAddress
      || market.pairAddress.toLowerCase() === contractLookupAddress
    );
    if (listed) {
      setContractLookupStatus("resolved");
      setContractLookupMarket(listed);
      setContractLookupResolution(listed.resolution);
      return;
    }
    const controller = new AbortController();
    setContractLookupStatus("searching");
    setContractLookupMarket(undefined);
    setContractLookupResolution(undefined);
    const query = new URLSearchParams({ contract: contractLookupAddress });
    void fetch(`/api/markets/external?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ExternalMarketResponse;
        if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error ?? "Lookup unavailable.");
        const match = payload.markets.find((market) =>
          market.address.toLowerCase() === contractLookupAddress
          || market.pairAddress.toLowerCase() === contractLookupAddress
        );
        if (controller.signal.aborted) return;
        setContractLookupMarket(match);
        setContractLookupResolution(payload.resolution);
        setContractLookupStatus(match || payload.resolution ? "resolved" : "not-found");
      })
      .catch(() => {
        if (!controller.signal.aborted) setContractLookupStatus("error");
      });
    return () => controller.abort();
  }, [contractLookupAddress, markets]);

  const orderedMarkets = useMemo(() => stabilizeOrder(rankOrder, markets), [markets, rankOrder]);
  const rankByAddress = useMemo(
    () => new Map(orderedMarkets.map((market, index) => [market.address.toLowerCase(), index + 1])),
    [orderedMarkets]
  );
  const sourceCounts = useMemo(() => ({
    all: markets.length,
    attributed: markets.filter((market) => marketDistributionPassport(market).isAttributedLaunch).length,
    sushi: markets.filter((market) => market.project?.sourceId === "sushi").length,
    pons: markets.filter((market) => market.project?.sourceId === "pons").length,
    lemon: markets.filter((market) => market.project?.sourceId === "lemon").length
  }), [markets]);
  const sourceScoped = useMemo(() => sourceFilter === "all"
    ? markets
    : sourceFilter === "attributed"
      ? markets.filter((market) => marketDistributionPassport(market).isAttributedLaunch)
      : markets.filter((market) => market.project?.sourceId === sourceFilter), [markets, sourceFilter]);
  const venueCounts = useMemo(() => ({
    all: sourceScoped.length,
    uniswap: sourceScoped.filter((market) => launchDistributionVenue(market) === "uniswap").length,
    sushi: sourceScoped.filter((market) => launchDistributionVenue(market) === "sushi").length,
    other: sourceScoped.filter((market) => launchDistributionVenue(market) === "other").length
  }), [sourceScoped]);
  const viewCounts = useMemo(() => {
    const venueScoped = venueFilter === "all"
      ? sourceScoped
      : sourceScoped.filter((market) => launchDistributionVenue(market) === venueFilter);
    return externalMarketViewCounts(venueScoped);
  }, [sourceScoped, venueFilter]);
  const viewed = useMemo(() => selectExternalMarketView([...orderedMarkets], view), [orderedMarkets, view]);
  const searchable = contractLookupMarket
    ? [contractLookupMarket, ...orderedMarkets.filter((market) => market.address.toLowerCase() !== contractLookupMarket.address.toLowerCase())]
    : orderedMarkets;
  const searched = normalizedQuery
    ? searchable.filter((market) => [
        market.name,
        market.symbol,
        market.address,
        market.pairAddress,
        ...(market.stockAssetRelationships ?? []).flatMap((relationship) => [relationship.tokenName, relationship.tokenSymbol, relationship.contractAddress])
      ].some((value) => value.toLowerCase().includes(normalizedQuery)))
    : viewed;
  const filteredByEvidence = searched.filter((market) => {
    if (normalizedQuery) return true;
    if (sourceFilter === "attributed" && !marketDistributionPassport(market).isAttributedLaunch) return false;
    if (sourceFilter !== "all" && sourceFilter !== "attributed" && market.project?.sourceId !== sourceFilter) return false;
    return venueFilter === "all" || launchDistributionVenue(market) === venueFilter;
  });
  const sorted = useMemo(
    () => sortMarkets(filteredByEvidence, marketSort, rankByAddress),
    [filteredByEvidence, marketSort, rankByAddress]
  );
  const filtered = tradeableOnly
    ? sorted.filter((market) => executionAvailability[market.address.toLowerCase()] === "ready")
    : sorted;
  const expanded = showAllMarkets || normalizedQuery.length > 0 || view === "explore" || tradeableOnly;
  const visibleMarkets = expanded ? filtered : filtered.slice(0, MAX_VISIBLE_MARKETS);

  const routeCandidates = useMemo(() => {
    const candidates = (tradeableOnly ? sorted : visibleMarkets)
      .filter(canVerifyExecution)
      .map((market) => market.address.toLowerCase())
      .filter((address, index, list) => list.indexOf(address) === index)
      .slice(0, MAX_ROUTE_BATCH);
    const unresolved = candidates.filter((address) => executionAvailability[address] === undefined);
    const checking = candidates.filter((address) => executionAvailability[address] === "checking");
    return checking.length ? checking : unresolved;
  }, [executionAvailability, sorted, tradeableOnly, visibleMarkets]);
  const routeKey = routeCandidates.join(",");

  useEffect(() => {
    const tokens = routeCandidates.filter((address) => executionAvailability[address] === undefined);
    if (!tokens.length) return;
    setExecutionAvailability((current) => ({
      ...current,
      ...Object.fromEntries(tokens.map((address) => [address, "checking" as const]))
    }));
    const controller = new AbortController();
    const query = new URLSearchParams({ tokens: tokens.join(",") });
    void fetch(`/api/trade/external-availability?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { availability?: Array<{ token?: string; status?: Exclude<ExecutionAvailability, "checking"> }> };
        if (!response.ok || !Array.isArray(payload.availability)) throw new Error("Route verification unavailable.");
        const resolved: Record<string, Exclude<ExecutionAvailability, "checking">> = Object.fromEntries(
          tokens.map((address) => [address, "unavailable" as const])
        );
        for (const item of payload.availability) {
          const address = item.token?.toLowerCase();
          if (!address || !tokens.includes(address)) continue;
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
    // The stable address key is the intended dependency boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const routeResolvedCount = sorted.filter((market) => {
    if (!canVerifyExecution(market)) return true;
    const state = executionAvailability[market.address.toLowerCase()];
    return state !== undefined && state !== "checking";
  }).length;
  const tradeableCount = sorted.filter((market) => executionAvailability[market.address.toLowerCase()] === "ready").length;
  const routeSyncing = routeResolvedCount < sorted.length;

  const changeView = (next: DiscoveryView) => {
    setView(next);
    setMarketQuery("");
    setShowAllMarkets(next === "explore" || tradeableOnly);
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

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: DiscoveryView) => {
    const currentIndex = VIEWS.findIndex((item) => item.id === current);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % VIEWS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + VIEWS.length) % VIEWS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = VIEWS.length - 1;
    else return;
    event.preventDefault();
    const next = VIEWS[nextIndex].id;
    changeView(next);
    document.getElementById(`runner-tab-${next}`)?.focus();
  };

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

  const marketCountLabel = contractLookupAddress && contractLookupStatus === "searching"
    ? "Searching Robinhood Chain…"
    : normalizedQuery
      ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
      : tradeableOnly && routeSyncing
        ? `Verifying routes · ${routeResolvedCount}/${sorted.length} checked · ${tradeableCount} tradeable`
        : expanded
          ? `Showing all ${filtered.length}`
          : `Top ${Math.min(MAX_VISIBLE_MARKETS, filtered.length)} of ${filtered.length}`;

  return (
    <section className="panel externalMarkets runnerRadar terminalMarketShell" id="market-explorer" aria-labelledby="external-markets-title">
      <div className="feedHeading externalHeading">
        <div>
          <p className="eyebrow">RMT MARKET INTELLIGENCE</p>
          <h2 id="external-markets-title" ref={heading} tabIndex={-1}>Runner signals</h2>
          <p>Live Robinhood Chain discovery ranked by liquidity, two-sided activity, acceleration, and route evidence.</p>
        </div>
        <span className="externalBadge"><i aria-hidden="true" />{status === "stale" ? "DATA DELAYED" : "LIVE · 60S RANKS"}</span>
      </div>

      <p className="srOnly" aria-live="polite">{announcement}</p>
      {status === "stale" && (
        <p className="runnerDataNotice" role="status">
          <span>Data delayed · showing the last confirmed snapshot{updatedAt ? ` from ${snapshotTime(updatedAt)}` : ""}. Fresh route verification remains required.</span>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </p>
      )}

      <LiveSignalDesk signals={liveSignals} />

      <div className="runnerDirectoryControls" role="search" aria-label="Search Robinhood Chain markets">
        <div className="runnerMarketSearch">
          <span aria-hidden="true">⌕</span>
          <label className="srOnly" htmlFor="external-market-search">Search by name, ticker, token contract, or pool contract</label>
          <input
            id="external-market-search"
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
            placeholder="Search name, ticker, or contract · press /"
            autoComplete="off"
            spellCheck={false}
            aria-keyshortcuts="/"
            aria-describedby="runner-market-count"
            maxLength={96}
          />
          {marketQuery && <button type="button" aria-label="Clear market search" onClick={() => { setMarketQuery(""); searchInput.current?.focus(); }}>×</button>}
        </div>
        <button
          className="runnerDirectoryButton"
          type="button"
          aria-controls="runner-market-panel"
          aria-expanded={expanded}
          disabled={!normalizedQuery && filtered.length === 0}
          onClick={() => {
            if (normalizedQuery) setMarketQuery("");
            else setShowAllMarkets((current) => !current);
          }}
        >
          {normalizedQuery ? "Clear search" : expanded ? "Show top twelve" : `Browse all ${filtered.length}`}
        </button>
      </div>

      {contractLookupAddress && (
        <p className={`runnerContractLookup ${contractLookupStatus}`} role="status">
          <i aria-hidden="true" />
          {contractLookupStatus === "searching"
            ? "Searching beyond the loaded market snapshot…"
            : contractLookupStatus === "resolved"
              ? contractLookupMarket
                ? contractLookupMarket.resolution
                  ? "Canonical pool resolved directly on Robinhood Chain."
                  : "Exact contract market found."
                : "Token resolved, but no supported pool is available yet."
              : contractLookupStatus === "not-found"
                ? "No Robinhood Chain DEX market was found for this contract."
                : contractLookupStatus === "error"
                  ? "Direct contract lookup is temporarily delayed."
                  : "Preparing exact contract lookup…"}
        </p>
      )}
      {contractLookupAddress && contractLookupStatus === "resolved" && !contractLookupMarket && contractLookupResolution && (
        <div className="runnerResolvedToken">
          <span><small>ONCHAIN TOKEN</small><strong>{contractLookupResolution.token.name} · ${contractLookupResolution.token.symbol}</strong></span>
          <Link href={`/market/${contractLookupResolution.token.address}`}>Open token workspace →</Link>
        </div>
      )}

      <div className="runnerToolbar">
        <div className="runnerTabs" role="tablist" aria-label="Market discovery views">
          {VIEWS.map((item) => (
            <button
              id={`runner-tab-${item.id}`}
              type="button"
              role="tab"
              aria-controls="runner-market-panel"
              aria-selected={view === item.id}
              tabIndex={view === item.id ? 0 : -1}
              className={view === item.id ? "active" : ""}
              onClick={() => changeView(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, item.id)}
              key={item.id}
            >
              {item.label}<span>{viewCounts[item.id]}</span>
            </button>
          ))}
        </div>
        <small id="runner-market-count" aria-live="polite">{marketCountLabel}</small>
      </div>

      <div className="runnerSourceFilters" role="group" aria-label="Filter markets by venue, route, and origin">
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
          {routeSyncing ? "Routes syncing" : "Tradeable"}<b>{routeSyncing ? `${routeResolvedCount}/${sorted.length}` : tradeableCount}</b>
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

      <div id="runner-market-panel" role="tabpanel" aria-labelledby={`runner-tab-${view}`}>
        {status === "loading" ? (
          <div className="emptyFeed" role="status"><strong>Loading market intelligence…</strong><span>Scanning liquidity, price action, two-sided flow, origin evidence, and executable routes.</span></div>
        ) : status === "error" ? (
          <div className="emptyFeed"><strong>Market discovery is temporarily unavailable.</strong><span>Direct venue trading remains available.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>
        ) : visibleMarkets.length === 0 ? (
          <div className="emptyFeed">
            <strong>{normalizedQuery ? "No markets match that search." : tradeableOnly ? "No verified routes match these filters." : "No markets meet this signal yet."}</strong>
            <span>{normalizedQuery ? "Try a token name, ticker, or complete token or pool contract." : "Change a venue, origin, or execution filter."}</span>
            {normalizedQuery && <button type="button" onClick={() => setMarketQuery("")}>Clear search</button>}
          </div>
        ) : (
          <div className="externalMarketGrid runnerMarketGrid">
            {visibleMarkets.map((market, index) => {
              const value = valuation(market);
              const rank = rankByAddress.get(market.address.toLowerCase()) ?? index + 1;
              const addressKey = market.address.toLowerCase();
              const watched = watchedAddresses.has(addressKey);
              const executionState: ExecutionAvailability = canVerifyExecution(market)
                ? executionAvailability[addressKey] ?? "checking"
                : "view-only";
              const distribution = marketDistributionPassport(market);
              const changeClass = changeTone(market.priceChange5m);
              const stockAssetLabel = market.stockAssetRelationships?.length
                ? market.stockAssetRelationships.map((relationship) => relationship.tokenSymbol).join("+")
                : "";
              const reviewRequired = market.riskFlags.length > 0;
              const workspaceHref = `/market/${market.address}${reviewRequired ? "?tab=safety" : ""}`;
              const mobileAction = reviewRequired ? "Review" : executionState === "ready" ? "Trade" : executionState === "checking" ? "Verifying" : "Open";
              return (
                <article className="externalMarketCard runnerMarketCard" data-signal={market.signal} key={market.address}>
                  <div className="mobileRunnerMarketRow">
                    <Link className="mobileRunnerIdentity" href={workspaceHref} aria-label={`Open ${market.name} market workspace`}>
                      <span className="mobileRunnerRank">#{String(rank).padStart(2, "0")}</span>
                      <ExternalArtwork market={market} />
                      <span className="mobileRunnerCopy">
                        <strong>{market.name}</strong>
                        <small>${cleanSymbol(market.symbol)} · {marketAge(market.ageMinutes)}{stockAssetLabel ? ` · ${stockAssetLabel}` : ""}</small>
                        <em>{distribution.shortLabel}</em>
                      </span>
                    </Link>
                    <Link className={`mobileRunnerTrade ${reviewRequired ? "review" : executionState}`} href={workspaceHref}>{mobileAction}</Link>
                    <div className="mobileRunnerMetrics" aria-label={`${market.name} market snapshot`}>
                      <span><small>{value.label}</small><strong>{money(value.value)}</strong></span>
                      <span className={`mobileRunnerMove ${changeClass}`}><small>5m</small><strong>{signedPercent(market.priceChange5m)}</strong></span>
                      <span><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong></span>
                    </div>
                  </div>

                  <div className="runnerCardStatus">
                    <span className={`marketSignal ${market.signal}`}>{signalLabel(market.signal)}</span>
                    <span>#{String(rank).padStart(2, "0")} · Score {market.momentumScore}</span>
                    <small>{marketAge(market.ageMinutes)}</small>
                  </div>

                  <div className="externalIdentity">
                    <ExternalArtwork market={market} />
                    <span>
                      <Link className="externalIdentityLink" href={`/market/${market.address}`} onClick={() => recordExperienceStage("discovery_used")}><strong>{market.name}</strong></Link>
                      <small>${cleanSymbol(market.symbol)} · {venueLabel(market)}{stockAssetLabel ? ` · ${stockAssetLabel}` : ""}</small>
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
                    <span className={`externalChange ${changeClass}`}><small>5m change</small><strong>{signedPercent(market.priceChange5m)}</strong></span>
                    <span><small>1h volume</small><strong>{money(market.volume1h)}</strong></span>
                    <span><small>Liquidity · {routeLiquidityDepthLabel(market.liquidityUsd)}</small><strong>{money(market.liquidityUsd)}</strong></span>
                  </div>

                  <div className="runnerActivity">
                    <span>{market.curve
                      ? `${market.curve.uniqueTraders} traders · ${market.curve.volumeQuoteEth.toFixed(3)} ETH curve volume`
                      : runnerReason(market)}</span>
                    {!market.curve && (
                      <div className="runnerMomentumProfile" aria-label={`Momentum profile: 5 minutes ${signedPercent(market.priceChange5m)}, 1 hour ${signedPercent(market.priceChange1h)}, 24 hours ${signedPercent(market.priceChange24h)}`}>
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
                    <span className="externalBadge">
                      {executionState === "checking" ? "VERIFYING IN-SITE ROUTE" : executionState === "view-only" ? "VIEW ONLY · NO VERIFIED ROUTE" : "CHECK ROUTE IN WORKSPACE"}
                    </span>
                  )}
                  <a className="externalChartLink" href={market.url} target="_blank" rel="noreferrer">{market.curve ? "Open verified curve ↗" : "Chart & pair ↗"}</a>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <details className="externalDisclosure">
        <summary>Data and methodology</summary>
        <p>Market data uses validated public DEX snapshots and documented project-source APIs. Project identity is attached only after the source token and launch pool agree with the discovered market. Launch source is secondary evidence—not the ranking. Signals are automated review candidates, not investment recommendations or profit guarantees. Buy and Sell always enter the full RMT workspace, request a fresh Sushi or Uniswap quote, re-check the route, and require wallet review.</p>
      </details>
    </section>
  );
}
