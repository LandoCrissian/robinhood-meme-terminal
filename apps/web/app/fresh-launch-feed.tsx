"use client";

import Link from "next/link";
import { formatEther } from "viem";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { activeReleaseBadge, isMainnetRelease } from "../lib/network";
import { describeCreatorExposure } from "../lib/creator-signals";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import {
  buildRmtRankingOrders,
  rankRmtMomentum,
  type RmtDiscoveryView
} from "../lib/rmt-runner-ranking";
import { ipfsToHttp } from "../lib/token-metadata";
import { MarketPanel } from "./market-panel";

const FIXED_SUPPLY = 1_000_000_000n * 10n ** 18n;
const DATA_REFRESH_MS = 10_000;
const RANK_REFRESH_MS = 60_000;
const MAX_VISIBLE_LAUNCHES = 4;

const DISCOVERY_VIEWS: Array<{ id: RmtDiscoveryView; label: string }> = [
  { id: "moving", label: "Moving now" },
  { id: "early", label: "Early-stage" },
  { id: "graduation", label: "Near graduation" },
  { id: "new", label: "New" }
];

const EMPTY_RANKING_ORDERS: Record<RmtDiscoveryView, string[]> = {
  moving: [],
  early: [],
  graduation: [],
  new: []
};

const VIEW_COPY: Record<RmtDiscoveryView, { title: string; description: string; empty: string }> = {
  moving: {
    title: "RMT launches showing real movement",
    description: "Risk-adjusted momentum based on retained reserve, activity, volume, and creator behavior—not paid placement.",
    empty: "No RMT launch meets the protected momentum threshold yet."
  },
  early: {
    title: "Early-stage launches earning attention",
    description: "Low-progress launches with enough retained liquidity, balanced activity, and safer creator concentration.",
    empty: "No early-stage launch meets the protected activity threshold yet."
  },
  graduation: {
    title: "Closest to graduation",
    description: "Active RMT V6 projects ordered by live progress toward their verified curve target.",
    empty: "No active launch is currently approaching graduation."
  },
  new: {
    title: "Newest verified launches",
    description: "The latest tokens created through the active, origin-verified RMT factory.",
    empty: "No verified launches are available yet."
  }
};

function displaySymbol(symbol: string) {
  return symbol.replace(/^\$+/, "");
}

function reserveLabel(reserveWei: string) {
  const value = Number(formatEther(BigInt(reserveWei)));
  if (value === 0) return "New";
  if (value < 0.001) return "<0.001 ETH";
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 }) + " ETH";
}

function volumeLabel(volumeWei: string) {
  const value = Number(formatEther(BigInt(volumeWei)));
  if (value === 0) return "0 ETH";
  if (value < 0.001) return "<0.001 ETH";
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 }) + " ETH";
}

function activityLabel(launch: LaunchFeedItem) {
  if (launch.tradeCount === 0) return "No recent trades";
  return launch.buyCount + " buy" + (launch.buyCount === 1 ? "" : "s")
    + " · " + launch.sellCount + " sell" + (launch.sellCount === 1 ? "" : "s");
}

function TokenArtwork({ launch, featured = false }: { launch: LaunchFeedItem; featured?: boolean }) {
  return (
    <div className={featured ? "coin hotArtwork" : "coin launchArtwork"}>
      {launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : launch.symbol.slice(0, 2)}
    </div>
  );
}

function CreatorExposure({ launch }: { launch: LaunchFeedItem }) {
  const exposure = describeCreatorExposure(launch);
  return <small className={"creatorExposure " + exposure.tone}>{exposure.label}</small>;
}

function currentLaunchesForView(
  launches: LaunchFeedItem[],
  order: string[],
  view: RmtDiscoveryView
) {
  const byToken = new Map(launches.map((launch) => [launch.token.toLowerCase(), launch]));
  return order.flatMap((token) => {
    const launch = byToken.get(token);
    if (!launch) return [];
    const ranking = rankRmtMomentum(launch);
    if (view === "moving" && !ranking.moving) return [];
    if (view === "early" && !ranking.earlyStage) return [];
    if (view === "graduation" && launch.graduated) return [];
    return [launch];
  });
}

function QuickTradeDialog({
  launch,
  side,
  onClose,
  returnFocusTo
}: {
  launch: LaunchFeedItem;
  side: "buy" | "sell";
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

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
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    <button className="quickTradeBackdrop" type="button" aria-label="Close quick trade" onClick={onClose} />
    <section
      ref={dialog}
      className="quickTradeDialog"
      role="dialog"
      aria-modal="true"
      aria-label={(side === "buy" ? "Buy " : "Sell ") + launch.name}
      tabIndex={-1}
    >
      <header className="quickTradeHeader">
        <div className="quickTradeIdentity">
          <TokenArtwork launch={launch} featured />
          <span>
            <small>QUICK TRADE · RMT V6</small>
            <strong>{launch.name}</strong>
            <em>{"$" + displaySymbol(launch.symbol)}</em>
          </span>
        </div>
        <div className="quickTradeHeaderActions">
          <Link href={"/token/" + launch.token + "?side=" + side + "&launch=" + launch.launchId + "#trade"}>Full page ↗</Link>
          <button ref={closeButton} type="button" aria-label="Close quick trade" onClick={onClose}>×</button>
        </div>
      </header>
      <div className="quickTradeBody">
        <MarketPanel
          key={launch.token + "-" + side}
          tokenAddress={launch.token}
          symbol={displaySymbol(launch.symbol)}
          totalSupply={FIXED_SUPPLY}
          creator={launch.creator}
          compact
          initialMode={side}
          launchHint={launch}
        />
      </div>
      <footer className="quickTradeFooter">
        <span>Live onchain quote</span>
        <span>Wallet confirmation required</span>
        <span>RMT never controls your funds</span>
      </footer>
    </section>
  </>;
}

export function FreshLaunchFeed() {
  const [launches, setLaunches] = useState<LaunchFeedItem[]>([]);
  const [rankingOrders, setRankingOrders] = useState<Record<RmtDiscoveryView, string[]>>(EMPTY_RANKING_ORDERS);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [message, setMessage] = useState("Synchronizing verified launches.");
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<RmtDiscoveryView>("moving");
  const [quickTrade, setQuickTrade] = useState<{ launch: LaunchFeedItem; side: "buy" | "sell" }>();
  const [rankingAnnouncement, setRankingAnnouncement] = useState("");
  const restoredQuickTrade = useRef(false);
  const didSelectInitialView = useRef(false);
  const rankInitialized = useRef(false);
  const nextRankRefresh = useRef(0);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const syncQuickTradeUrl = useCallback((launch?: LaunchFeedItem, side?: "buy" | "sell") => {
    const url = new URL(window.location.href);
    if (launch && side) {
      url.searchParams.set("quickTrade", launch.token);
      url.searchParams.set("side", side);
      url.hash = "explore";
    } else {
      url.searchParams.delete("quickTrade");
      url.searchParams.delete("side");
    }
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []);

  const openQuickTrade = useCallback((launch: LaunchFeedItem, side: "buy" | "sell") => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuickTrade({ launch, side });
    syncQuickTradeUrl(launch, side);
  }, [syncQuickTradeUrl]);

  const closeQuickTrade = useCallback(() => {
    setQuickTrade(undefined);
    syncQuickTradeUrl();
  }, [syncQuickTradeUrl]);

  const refresh = useCallback(async () => {
    setStatus((current) => current === "live" ? "live" : "loading");
    try {
      const response = await fetch("/api/launches", { cache: "no-store" });
      const result = (await response.json()) as LaunchFeedResponse | { error?: string };
      if (!response.ok || !("launches" in result)) {
        throw new Error("error" in result && result.error ? result.error : "Launch data is temporarily unavailable.");
      }

      const now = Date.now();
      setLaunches(result.launches);
      if (!rankInitialized.current || now >= nextRankRefresh.current) {
        setRankingOrders(buildRmtRankingOrders(result.launches));
        rankInitialized.current = true;
        nextRankRefresh.current = now + RANK_REFRESH_MS;
        setRankingAnnouncement("RMT discovery rankings updated.");
      }
      setStatus("live");
      setMessage(result.launches.length === 0
        ? isMainnetRelease ? "Factory connected. No mainnet launches yet." : "Factory connected. No testnet launches yet."
        : result.launches.length + " verified factory launch" + (result.launches.length === 1 ? "" : "es") + ".");
    } catch (error) {
      setLaunches([]);
      setRankingOrders(EMPTY_RANKING_ORDERS);
      rankInitialized.current = false;
      nextRankRefresh.current = 0;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Launch data is temporarily unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), DATA_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (restoredQuickTrade.current || launches.length === 0) return;
    restoredQuickTrade.current = true;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("quickTrade")?.toLowerCase();
    const side = params.get("side");
    if (!token || (side !== "buy" && side !== "sell")) return;
    const launch = launches.find((item) => item.token.toLowerCase() === token);
    if (launch) setQuickTrade({ launch, side });
  }, [launches]);

  const launchesByView = useMemo(() => ({
    moving: currentLaunchesForView(launches, rankingOrders.moving, "moving"),
    early: currentLaunchesForView(launches, rankingOrders.early, "early"),
    graduation: currentLaunchesForView(launches, rankingOrders.graduation, "graduation"),
    new: currentLaunchesForView(launches, rankingOrders.new, "new")
  }), [launches, rankingOrders]);

  useEffect(() => {
    if (didSelectInitialView.current || status !== "live" || launches.length === 0) return;
    didSelectInitialView.current = true;
    if (launchesByView.moving.length === 0 && launchesByView.new.length > 0) setView("new");
  }, [launches.length, launchesByView.moving.length, launchesByView.new.length, status]);

  const orderedLaunches = launchesByView[view];
  const visibleLaunches = showAll ? orderedLaunches : orderedLaunches.slice(0, MAX_VISIBLE_LAUNCHES);
  const viewCopy = VIEW_COPY[view];

  const changeView = (nextView: RmtDiscoveryView) => {
    setView(nextView);
    setShowAll(false);
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentView: RmtDiscoveryView) => {
    const currentIndex = DISCOVERY_VIEWS.findIndex((item) => item.id === currentView);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % DISCOVERY_VIEWS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + DISCOVERY_VIEWS.length) % DISCOVERY_VIEWS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = DISCOVERY_VIEWS.length - 1;
    else return;

    event.preventDefault();
    const nextView = DISCOVERY_VIEWS[nextIndex].id;
    changeView(nextView);
    document.getElementById("discovery-tab-" + nextView)?.focus();
  };

  return (
    <section className="feed panel rmtDiscovery" id="explore" aria-labelledby="rmt-discovery-title">
      <div className="sectionTitle feedHeading">
        <div>
          <p className="eyebrow">LIVE RMT V6 DISCOVERY</p>
          <h2 id="rmt-discovery-title">{viewCopy.title}</h2>
          <p className="sectionCopy">{viewCopy.description}</p>
        </div>
        <span className={"badge " + (status === "live" ? "liveBadge" : status === "error" ? "errorBadge" : "warning")}>
          {status === "live" ? "RECENT DATA · 60S RANKS" : status === "error" ? "DATA DELAYED" : "SYNCING"}
        </span>
      </div>

      <p className="srOnly" aria-live="polite">{rankingAnnouncement}</p>
      <div className="discoveryToolbar">
        <div className="discoveryTabs" role="tablist" aria-label="RMT token discovery views">
          {DISCOVERY_VIEWS.map((item) => (
            <button
              type="button"
              role="tab"
              id={"discovery-tab-" + item.id}
              aria-controls="rmt-discovery-panel"
              aria-selected={view === item.id}
              tabIndex={view === item.id ? 0 : -1}
              className={view === item.id ? "active" : ""}
              onClick={() => changeView(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, item.id)}
              key={item.id}
            >
              {item.label}<span>{launchesByView[item.id].length}</span>
            </button>
          ))}
        </div>
        <Link className="discoveryLaunchLink" href="/launch">Launch yours ↗</Link>
      </div>

      <div id="rmt-discovery-panel" role="tabpanel" aria-labelledby={"discovery-tab-" + view}>
        {launches.length === 0 ? (
          <div className="emptyFeed">
            <strong>{status === "loading" ? "Reading Robinhood Chain…" : "No launches to display"}</strong>
            <span>{message}</span>
            {status === "error" && <button type="button" onClick={() => void refresh()}>Retry</button>}
          </div>
        ) : visibleLaunches.length === 0 ? (
          <div className="emptyFeed compactEmpty">
            <strong>{viewCopy.empty}</strong>
            <span>The board updates automatically as verified onchain activity changes.</span>
            {view !== "new" && <button type="button" onClick={() => changeView("new")}>View new launches</button>}
          </div>
        ) : (
          <div className="rmtDiscoveryRows">
            {visibleLaunches.map((launch, index) => {
              const ranking = rankRmtMomentum(launch);
              const progress = Math.min(100, Math.max(0, launch.progressBps / 100));
              return (
                <article className="rmtDiscoveryRow" key={view + "-" + launch.transactionHash + "-" + launch.launchId}>
                  <Link
                    className="rmtDiscoveryMain"
                    href={"/token/" + launch.token + "?launch=" + launch.launchId}
                    aria-label={"Open " + launch.name}
                  >
                    <span className="rmtDiscoveryRank">#{String(index + 1).padStart(2, "0")}</span>
                    <TokenArtwork launch={launch} />
                    <span className="rmtDiscoveryIdentity">
                      <strong>{launch.name}</strong>
                      <em>{"$" + displaySymbol(launch.symbol) + " · #" + launch.launchId}</em>
                      <CreatorExposure launch={launch} />
                    </span>
                    <span className="rmtDiscoveryMetrics">
                      <span><small>{view === "moving" || view === "early" ? "Momentum" : "Activity"}</small><strong>{view === "moving" || view === "early" ? ranking.momentumScore + "/100" : activityLabel(launch)}</strong></span>
                      <span><small>Volume</small><strong>{volumeLabel(launch.volumeWei)}</strong></span>
                      <span><small>Reserve</small><strong>{reserveLabel(launch.reserveWei)}</strong></span>
                      <span><small>Graduation</small><strong>{launch.graduated ? "Complete" : progress.toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%"}</strong></span>
                    </span>
                    <span
                      className="rmtDiscoveryProgress"
                      role="progressbar"
                      aria-label={launch.name + " graduation progress"}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    >
                      <span style={{ width: progress + "%" }} />
                    </span>
                  </Link>
                  <div className="rmtDiscoveryActions">
                    <button className="buyCardAction" type="button" aria-haspopup="dialog" aria-label={"Quick buy " + launch.name} onClick={() => openQuickTrade(launch, "buy")}>Buy</button>
                    <button className="sellCardAction" type="button" aria-haspopup="dialog" aria-label={"Quick sell " + launch.name} onClick={() => openQuickTrade(launch, "sell")}>Sell</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {orderedLaunches.length > MAX_VISIBLE_LAUNCHES && (
        <button className="showMore" type="button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show top 4" : "View all " + orderedLaunches.length}
        </button>
      )}
      <p className="feedStatus">{message} Data refreshes every 10 seconds; rank positions settle every 60 seconds.</p>
      <p className="rmtRankingDisclosure">Momentum is a discovery signal, not an endorsement and not a basis for fee rewards. Creator concentration and selling can reduce or block promotion.</p>

      {quickTrade && (
        <QuickTradeDialog
          launch={quickTrade.launch}
          side={quickTrade.side}
          onClose={closeQuickTrade}
          returnFocusTo={returnFocusTo.current}
        />
      )}
    </section>
  );
}
