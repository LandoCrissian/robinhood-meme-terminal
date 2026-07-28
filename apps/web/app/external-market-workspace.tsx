"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import {
  externalProjectProvenanceDescription,
  externalProjectProvenanceLabel,
  type ExternalMarket,
  type ExternalMarketResponse
} from "../lib/external-market";
import {
  type ExternalChartRange,
  type ExternalOhlcvPayload
} from "../lib/external-ohlcv";
import { ipfsToHttp } from "../lib/token-metadata";
import {
  resilientTradeVenue,
  type TradeVenueHealth,
  type TradeVenueId,
  type TradeVenueSelectionMode
} from "../lib/trade-route-selection";
import { ExternalMarketChart } from "./external-market-chart";
import { ExternalHolderIntelligence, ExternalTradeTape, ExternalWalletPosition } from "./external-market-live";
import { ExternalRouteComparison } from "./external-route-comparison";
import { ExternalSushiQuotePanel } from "./external-sushi-quote-panel";
import { ExternalUniswapTradePanel } from "./external-uniswap-trade-panel";
import { SiteFooter } from "./site-footer";
import { WatchlistButton } from "./watchlist-button";

type WorkspaceTab = "activity" | "safety" | "origin";
type TradeSide = "buy" | "sell";
type TradeVenue = {
  venue: "sushi" | "uniswap";
  pair: Address;
  dexId: string;
  liquidityUsd: number;
  verification: "dex-and-route" | "dex-and-onchain";
};

function money(value: number, price = false) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (price && value < 0.0001) return "$" + value.toLocaleString(undefined, { maximumSignificantDigits: 5 });
  return "$" + value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: price ? 6 : 0
  });
}

function signedPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function age(minutes: number | null) {
  if (minutes === null) return "Age unavailable";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}

function venueKind(market: ExternalMarket) {
  const id = market.dexId.toLowerCase();
  if (id.includes("sushi")) return "sushi";
  if (id === "uniswap" || id.startsWith("uniswap-")) return "uniswap";
  return null;
}

function originLabel(market: ExternalMarket) {
  if (market.project) return externalProjectProvenanceLabel(market.project);
  if (market.origin.kind === "rmt-v6") return "RMT V6 · Protocol verified";
  if (market.origin.state === "attributed") return `${market.origin.sourceName} · Origin verified`;
  if (market.origin.state === "disputed") return "Origin conflict";
  if (market.origin.state === "unattributed") return "External · No verified origin";
  return "External · Origin unknown";
}

function ImageMark({ market }: { market: ExternalMarket }) {
  const [failed, setFailed] = useState(false);
  const image = market.project?.imageUri;
  return (
    <span className="universalMarketMark" aria-hidden="true">
      {image && !failed
        ? <img src={ipfsToHttp(image)} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : market.symbol.replaceAll("$", "").slice(0, 2).toUpperCase()}
    </span>
  );
}

export function ExternalMarketWorkspace() {
  const params = useParams<{ address: string }>();
  const searchParams = useSearchParams();
  const tokenAddress = params.address && isAddress(params.address) ? getAddress(params.address) : null;
  const initialSide = searchParams.get("side") === "sell" ? "sell" : "buy";
  const initialWorkspaceTab: WorkspaceTab = searchParams.get("tab") === "safety"
    ? "safety"
    : searchParams.get("tab") === "origin"
      ? "origin"
      : "activity";
  const [market, setMarket] = useState<ExternalMarket>();
  const [status, setStatus] = useState<"loading" | "ready" | "stale" | "error">("loading");
  const [side, setSide] = useState<TradeSide>(initialSide);
  const [tradeAmount, setTradeAmount] = useState(initialSide === "buy" ? "0.0001" : "");
  const [tab, setTab] = useState<WorkspaceTab>(initialWorkspaceTab);
  const [range, setRange] = useState<ExternalChartRange>("24H");
  const [chart, setChart] = useState<ExternalOhlcvPayload>();
  const [chartStatus, setChartStatus] = useState<"loading" | "ready" | "error">("loading");
  const [chartError, setChartError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [tradeVenues, setTradeVenues] = useState<TradeVenue[]>([]);
  const [tradeVenueStatus, setTradeVenueStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedTradeVenue, setSelectedTradeVenue] = useState<"sushi" | "uniswap" | null>(null);
  const [tradeVenueHealth, setTradeVenueHealth] = useState<Partial<Record<TradeVenueId, TradeVenueHealth>>>({});
  const [tradeVenueSelectionMode, setTradeVenueSelectionMode] = useState<TradeVenueSelectionMode>("automatic");
  const [tradeVenueNotice, setTradeVenueNotice] = useState("");
  const [tradeVenueRefresh, setTradeVenueRefresh] = useState(0);
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const tradeRef = useRef<HTMLElement>(null);
  const tradeReturnFocus = useRef<HTMLElement>(null);
  const marketAddress = market?.address;
  const marketPair = market?.pairAddress;
  const preferredVenue = market ? venueKind(market) : null;

  const refreshMarket = useCallback(async () => {
    if (!tokenAddress) {
      setStatus("error");
      return;
    }
    try {
      const response = await fetch("/api/markets/external", { cache: "no-store" });
      const payload = await response.json() as ExternalMarketResponse;
      if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error ?? "Market unavailable.");
      const next = payload.markets.find((item) => item.address.toLowerCase() === tokenAddress.toLowerCase());
      if (!next) throw new Error("This market is no longer in the qualified index.");
      setMarket(next);
      setStatus(payload.stale ? "stale" : "ready");
    } catch {
      setStatus((current) => current === "ready" || current === "stale" ? "stale" : "error");
    }
  }, [tokenAddress]);

  useEffect(() => {
    void refreshMarket();
    const interval = window.setInterval(() => void refreshMarket(), 30_000);
    return () => window.clearInterval(interval);
  }, [refreshMarket]);

  useEffect(() => {
    setTradeAmount(side === "buy" ? "0.0001" : "");
  }, [market?.address, side]);

  const closeMobileTrade = useCallback(() => {
    setMobileTradeOpen(false);
    window.requestAnimationFrame(() => tradeReturnFocus.current?.focus());
  }, []);

  useEffect(() => {
    if (!mobileTradeOpen) return;
    const previousOverflow = document.body.style.overflow;
    const mobileViewport = window.matchMedia("(max-width: 760px)");
    const syncScrollLock = () => {
      document.body.style.overflow = mobileViewport.matches ? "hidden" : previousOverflow;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileTrade();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        tradeRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !tradeRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !tradeRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    syncScrollLock();
    mobileViewport.addEventListener("change", syncScrollLock);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      mobileViewport.removeEventListener("change", syncScrollLock);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMobileTrade, mobileTradeOpen]);

  useEffect(() => {
    if (!marketAddress || !marketPair) return;
    const controller = new AbortController();
    setChartStatus("loading");
    setChartError(undefined);
    const query = new URLSearchParams({
      token: marketAddress,
      pair: marketPair,
      range
    });
    void fetch(`/api/markets/ohlcv?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ExternalOhlcvPayload | { error?: string };
        if (!response.ok || !("candles" in payload)) {
          throw new Error("error" in payload ? payload.error : "Price history unavailable.");
        }
        if (
          payload.token.toLowerCase() !== marketAddress.toLowerCase()
          || payload.pair.toLowerCase() !== marketPair.toLowerCase()
          || payload.range !== range
          || !Array.isArray(payload.candles)
        ) throw new Error("RMT rejected mismatched chart data.");
        setChart(payload);
        setChartStatus("ready");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setChart(undefined);
        setChartStatus("error");
        setChartError(cause instanceof Error ? cause.message : "Price history unavailable.");
      });
    return () => controller.abort();
  }, [marketAddress, marketPair, range]);

  useEffect(() => {
    if (!marketAddress || !marketPair) return;
    const controller = new AbortController();
    setTradeVenueStatus("loading");
    setTradeVenues([]);
    setSelectedTradeVenue(null);
    setTradeVenueHealth({});
    setTradeVenueSelectionMode("automatic");
    setTradeVenueNotice("");
    const query = new URLSearchParams({ token: marketAddress });
    if (tradeVenueRefresh > 0) query.set("refresh", "1");
    void fetch(`/api/trade/external-venues?${query}`, {
      cache: "no-store",
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json() as { token?: string; venues?: TradeVenue[]; error?: string };
      if (
        !response.ok
        || !payload.token
        || payload.token.toLowerCase() !== market.address.toLowerCase()
        || !Array.isArray(payload.venues)
      ) throw new Error(payload.error ?? "Execution venues unavailable.");
      const verified = payload.venues.filter((candidate) => (
        (candidate.venue === "sushi" || candidate.venue === "uniswap")
        && isAddress(candidate.pair)
        && typeof candidate.dexId === "string"
        && Number.isFinite(candidate.liquidityUsd)
        && candidate.liquidityUsd > 0
        && (candidate.verification === "dex-and-route" || candidate.verification === "dex-and-onchain")
      ));
      setTradeVenues(verified);
      setSelectedTradeVenue(
        preferredVenue && verified.some((candidate) => candidate.venue === preferredVenue)
          ? preferredVenue
          : verified[0]?.venue ?? null
      );
      setTradeVenueStatus("ready");
    }).catch(() => {
      if (controller.signal.aborted) return;
      setTradeVenueStatus("error");
      setTradeVenues([]);
      setSelectedTradeVenue(null);
    });
    return () => controller.abort();
  }, [marketAddress, marketPair, preferredVenue, tradeVenueRefresh]);

  const setTradeSide = (next: TradeSide, focus = false) => {
    if (focus && (tradeVenueStatus !== "ready" || tradeVenues.length === 0)) return;
    setSide(next);
    const url = new URL(window.location.href);
    url.searchParams.set("side", next);
    window.history.replaceState(window.history.state, "", url);
    if (!focus) return;
    if (window.matchMedia("(max-width: 760px)").matches) {
      tradeReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMobileTradeOpen(true);
      window.requestAnimationFrame(() => tradeRef.current?.querySelector<HTMLElement>(".universalTradeRailClose")?.focus());
      return;
    }
    window.requestAnimationFrame(() => tradeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const copyContract = async () => {
    if (!market) return;
    try {
      await navigator.clipboard.writeText(market.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const activity = useMemo(() => market ? [
    { label: "5m", buys: market.buys5m, sells: market.sells5m, volume: market.volume5m },
    { label: "1h", buys: market.buys1h, sells: market.sells1h, volume: market.volume1h },
    { label: "24h", buys: market.buys24h, sells: market.sells24h, volume: market.volume24h }
  ] : [], [market]);
  const tradeVenueOptions = useMemo(() => (
    tradeVenues.filter((candidate, index, all) => (
      all.findIndex((item) => item.venue === candidate.venue) === index
    ))
  ), [tradeVenues]);
  const tradeVenueIds = useMemo(() => tradeVenueOptions.map((candidate) => candidate.venue), [tradeVenueOptions]);

  useEffect(() => {
    const resilientVenue = resilientTradeVenue({
      selected: selectedTradeVenue,
      mode: tradeVenueSelectionMode,
      venues: tradeVenueIds,
      health: tradeVenueHealth
    });
    if (resilientVenue !== selectedTradeVenue) {
      const previous = selectedTradeVenue === "sushi" ? "Sushi" : "Uniswap";
      const next = resilientVenue === "sushi" ? "Sushi" : "Uniswap";
      setSelectedTradeVenue(resilientVenue);
      setTradeVenueNotice(`${previous} became unavailable. RMT moved this order to the verified ${next} route.`);
      return;
    }
    if (
      tradeVenueSelectionMode === "manual"
      && selectedTradeVenue
      && tradeVenueHealth[selectedTradeVenue] === "unavailable"
      && tradeVenueIds.some((venue) => venue !== selectedTradeVenue && tradeVenueHealth[venue] === "ready")
    ) {
      setTradeVenueNotice("Your selected route is unavailable. Choose the verified alternative or resume automatic routing.");
    }
  }, [selectedTradeVenue, tradeVenueHealth, tradeVenueIds, tradeVenueSelectionMode]);

  const activeTradeVenue = tradeVenueOptions.find((candidate) => candidate.venue === selectedTradeVenue);
  const tradingMarket = market && activeTradeVenue
    ? {
        ...market,
        pairAddress: activeTradeVenue.pair,
        dexId: activeTradeVenue.dexId,
        liquidityUsd: activeTradeVenue.liquidityUsd
      }
    : undefined;
  const selectTradeVenue = (venue: TradeVenueId) => {
    setSelectedTradeVenue(venue);
    setTradeVenueSelectionMode("manual");
    setTradeVenueNotice(`${venue === "sushi" ? "Sushi" : "Uniswap"} selected by you. RMT will not replace a manual route.`);
  };
  const resumeAutomaticRouting = () => {
    const resilientVenue = resilientTradeVenue({
      selected: selectedTradeVenue,
      mode: "automatic",
      venues: tradeVenueIds,
      health: tradeVenueHealth
    });
    setTradeVenueSelectionMode("automatic");
    setSelectedTradeVenue(resilientVenue);
    setTradeVenueNotice("Automatic fallback restored. RMT changes venues only when the selected route is unavailable.");
  };
  const retryTradeVenueDiscovery = () => {
    setTradeVenueRefresh((value) => value + 1);
  };
  const routeDecision = tradeVenueNotice || (
    tradeVenueOptions.length === 1
      ? "This is the only independently verified in-site route currently available."
      : selectedTradeVenue === preferredVenue
        ? "Matches this market’s verified venue. Protected output from alternatives is compared below."
        : "Selected from the independently verified routes discovered for this token."
  );

  if (!tokenAddress) {
    return <main className="universalMarketPage professionalTradeWorkspace"><Link href="/">← Terminal</Link><section className="universalWorkspaceState"><h1>Invalid market address</h1><p>Open a qualified market from RMT Terminal.</p></section></main>;
  }
  if (!market && status === "loading") {
    return <main className="universalMarketPage professionalTradeWorkspace"><Link href="/">← Terminal</Link><section className="universalWorkspaceState"><p className="eyebrow">UNIVERSAL TOKEN WORKSPACE</p><h1>Opening live market…</h1><p>Matching token, pool, venue, and origin evidence.</p></section></main>;
  }
  if (!market) {
    return <main className="universalMarketPage professionalTradeWorkspace"><Link href="/">← Terminal</Link><section className="universalWorkspaceState"><p className="eyebrow">MARKET UNAVAILABLE</p><h1>This market is not in RMT’s qualified index</h1><p>RMT hides execution when the current token and pool cannot be matched to a live indexed market.</p><button type="button" onClick={() => void refreshMarket()}>Retry verification</button></section></main>;
  }

  const valuation = market.marketCapUsd > 0 ? market.marketCapUsd : market.fdvUsd;
  const oneHourTrades = market.buys1h + market.sells1h;
  const buyPressure = oneHourTrades > 0 ? Math.round(market.buyPressureBps / 100) : 0;

  return (
    <main className="universalMarketPage professionalTradeWorkspace">
      <div className="universalWorkspaceNav">
        <Link href="/">← Back to Terminal</Link>
        <span>UNIVERSAL TOKEN WORKSPACE · MAINNET</span>
      </div>

      {status === "stale" && <div className="universalDataNotice" role="status">Market snapshot delayed · trading still requires a fresh onchain quote.</div>}

      <header className="universalMarketHero">
        <div className="universalMarketIdentity">
          <ImageMark market={market} />
          <div>
            <p>{originLabel(market)}</p>
            <h1>{market.name}</h1>
            <span>${market.symbol.replaceAll("$", "")} · {market.dexId}</span>
          </div>
        </div>
        <div className="universalHeroPrice">
          <small>LIVE PRICE</small>
          <strong>{money(market.priceUsd, true)}</strong>
          <span className={market.priceChange1h >= 0 ? "positive" : "negative"}>{signedPercent(market.priceChange1h)} · 1h</span>
        </div>
        <div className="universalHeroActions">
          <WatchlistButton
            address={market.address as Address}
            name={market.name}
            symbol={market.symbol}
            image={market.project?.imageUri ?? undefined}
            compactLabel
          />
          <button type="button" onClick={() => void copyContract()}>{copied ? "Copied" : "Copy contract"}</button>
          <a href={market.url} target="_blank" rel="noopener noreferrer">Market source ↗</a>
        </div>
      </header>

      <section className="universalTickerStrip" aria-label="Live market metrics">
        <span><small>Market cap / FDV</small><strong>{money(valuation)}</strong></span>
        <span><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong></span>
        <span><small>24h volume</small><strong>{money(market.volume24h)}</strong></span>
        <span><small>24h trades</small><strong>{(market.buys24h + market.sells24h).toLocaleString()}</strong></span>
        <span><small>Age</small><strong>{age(market.ageMinutes)}</strong></span>
        <span><small>Signal</small><strong>{market.signal === "moving" ? "Moving" : market.signal === "early" ? "Early" : "Active"}</strong></span>
      </section>

      <section className="workspaceEvidenceBar" aria-label="Pre-trade market evidence">
        <header>
          <span><i aria-hidden="true" />PRE-TRADE EVIDENCE</span>
          <small>Evidence, not a safety guarantee</small>
        </header>
        <div>
          <span className="verified"><small>Market identity</small><strong>Token + pool matched</strong></span>
          <span className={market.sells1h > 0 ? "verified" : "caution"}><small>Recent exits</small><strong>{market.sells1h > 0 ? `${market.sells1h.toLocaleString()} sells · 1h` : "No sells observed · 1h"}</strong></span>
          <span className={market.liquidityUsd >= 25_000 ? "verified" : "caution"}><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong></span>
          <button type="button" className={market.riskFlags.length ? "caution" : "verified"} onClick={() => setTab("safety")}>
            <small>Ranking flags</small>
            <strong>{market.riskFlags.length ? `${market.riskFlags.length} review needed` : "None detected"}</strong>
          </button>
        </div>
      </section>

      <div className="universalWorkspaceGrid">
        <section className="universalMarketCanvas">
          <ExternalMarketChart
            candles={chart?.candles ?? []}
            range={range}
            loading={chartStatus === "loading"}
            error={chartError}
            onRangeChange={setRange}
          />

          <div className="universalInsightTabs" role="tablist" aria-label="Market intelligence">
            {([
              ["activity", "Activity"],
              ["safety", "Safety"],
              ["origin", "Origin"]
            ] as const).map(([id, label]) => (
              <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>
            ))}
          </div>

          {tab === "activity" && (
            <>
              <ExternalWalletPosition
                market={market}
                onBuy={() => setTradeSide("buy", true)}
                onSell={() => setTradeSide("sell", true)}
              />
              <section className="universalInsightPanel" aria-labelledby="workspace-activity">
                <header><div><small>MARKET FLOW</small><h2 id="workspace-activity">Buyers and sellers</h2></div><span>{buyPressure}% buys · 1h</span></header>
                <div className="universalFlowTrack" aria-hidden="true"><i style={{ width: `${buyPressure}%` }} /></div>
                <div className="universalActivityGrid">
                  {activity.map((item) => (
                    <article key={item.label}>
                      <strong>{item.label}</strong>
                      <span><b>{item.buys.toLocaleString()}</b> buys</span>
                      <span><b>{item.sells.toLocaleString()}</b> sells</span>
                      <span><b>{money(item.volume)}</b> volume</span>
                    </article>
                  ))}
                </div>
              </section>
              <ExternalTradeTape market={market} />
            </>
          )}

          {tab === "safety" && (
            <>
              <section className="universalInsightPanel" aria-labelledby="workspace-safety">
                <header><div><small>PRE-TRADE EVIDENCE</small><h2 id="workspace-safety">Know what RMT can—and cannot—prove</h2></div><span>{market.riskFlags.length} ranking flags</span></header>
                <div className="universalSafetyGrid">
                  <article><small>Pool match</small><strong>Rechecked before every quote</strong><p>The exact token, displayed pool, venue contracts, and wallet recipient must match.</p></article>
                  <article><small>Exit evidence</small><strong>{market.sells1h > 0 ? `${market.sells1h} sells observed · 1h` : "No sells observed · 1h"}</strong><p>The trade panel runs separate contract, holder, and sell-direction checks.</p></article>
                  <article><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong><p>Liquidity and price can change before wallet confirmation.</p></article>
                  <article><small>Current flags</small><strong>{market.riskFlags.length ? market.riskFlags.join(" · ") : "No ranking flags"}</strong><p>No flag is a safety guarantee. Your wallet remains the final authority.</p></article>
                </div>
              </section>
              <ExternalHolderIntelligence market={market} />
            </>
          )}

          {tab === "origin" && (
            <section className="universalInsightPanel" aria-labelledby="workspace-origin">
              <header><div><small>PROJECT PROVENANCE</small><h2 id="workspace-origin">{originLabel(market)}</h2></div><span>Not an endorsement</span></header>
              <p className="universalOriginDescription">{market.project ? externalProjectProvenanceDescription(market.project) : "RMT has not attributed this external token to a verified launchpad creator record."}</p>
              <dl className="universalOriginGrid">
                <div><dt>Token</dt><dd title={market.address}>{shortAddress(market.address)}</dd></div>
                <div><dt>Pool</dt><dd title={market.pairAddress}>{shortAddress(market.pairAddress)}</dd></div>
                <div><dt>Creator</dt><dd>{market.project?.creator ? shortAddress(market.project.creator) : "Not verified"}</dd></div>
                <div><dt>Venue</dt><dd>{market.dexId}</dd></div>
              </dl>
              {market.project?.description && <p className="universalProjectDescription">{market.project.description}</p>}
              {market.project && (
                <div className="universalSocials">
                  {market.project.socials.website && <a href={market.project.socials.website} target="_blank" rel="noopener noreferrer">Website ↗</a>}
                  {market.project.socials.x && <a href={market.project.socials.x} target="_blank" rel="noopener noreferrer">X ↗</a>}
                  {market.project.socials.telegram && <a href={market.project.socials.telegram} target="_blank" rel="noopener noreferrer">Telegram ↗</a>}
                  {market.project.socials.discord && <a href={market.project.socials.discord} target="_blank" rel="noopener noreferrer">Discord ↗</a>}
                </div>
              )}
            </section>
          )}
        </section>

        <button
          type="button"
          className={`universalTradeSheetBackdrop ${mobileTradeOpen ? "visible" : ""}`}
          aria-label="Close trade panel"
          tabIndex={mobileTradeOpen ? 0 : -1}
          onClick={closeMobileTrade}
        />
        <aside
          className={`universalTradeRail ${side} ${mobileTradeOpen ? "mobileOpen" : ""}`}
          ref={tradeRef}
          role={mobileTradeOpen ? "dialog" : undefined}
          aria-modal={mobileTradeOpen ? "true" : undefined}
          aria-labelledby="universal-trade-panel-title"
        >
          <header>
            <div><small>PLACE ORDER</small><h2 id="universal-trade-panel-title">{side === "buy" ? "Buy" : "Sell"} ${market.symbol.replaceAll("$", "")}</h2></div>
            <div className="universalTradeRailHeaderActions">
              <span>{tradeVenueStatus === "loading" ? "Checking route" : tradingMarket ? "Fresh quote" : "View only"}</span>
              <button type="button" className="universalTradeRailClose" aria-label="Close trade panel" onClick={closeMobileTrade}>×</button>
            </div>
          </header>
          <div className="universalTradeTabs" role="tablist" aria-label={`Trade side for ${market.name}`}>
            <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "active" : ""} onClick={() => setTradeSide("buy")}>Buy</button>
            <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "active" : ""} onClick={() => setTradeSide("sell")}>Sell</button>
          </div>
          {activeTradeVenue && (
            <div className={`universalRouteDecision ${tradeVenueSelectionMode}`} role="status">
              <span>
                <small>{tradeVenueSelectionMode === "automatic" ? "AUTOMATIC ROUTE" : "MANUAL ROUTE"}</small>
                <strong>{activeTradeVenue.venue === "sushi" ? "Sushi" : "Uniswap"}</strong>
              </span>
              <p>{routeDecision}</p>
              {tradeVenueSelectionMode === "manual" && <button type="button" onClick={resumeAutomaticRouting}>Use automatic</button>}
            </div>
          )}
          {tradeVenueOptions.length > 1 && (
            <ExternalRouteComparison
              market={market}
              venues={tradeVenueOptions}
              side={side}
              amount={tradeAmount}
              selectedVenue={selectedTradeVenue}
              onSelectVenue={selectTradeVenue}
              onHealthChange={setTradeVenueHealth}
            />
          )}
          {tradeVenueStatus === "loading" && <div className="universalTradeUnavailable"><strong>Verifying execution venues…</strong><p>Matching independent pool and onchain evidence for this token.</p></div>}
          {tradingMarket && activeTradeVenue?.venue === "sushi" && <ExternalSushiQuotePanel market={tradingMarket} side={side} amount={tradeAmount} onAmountChange={setTradeAmount} />}
          {tradingMarket && activeTradeVenue?.venue === "uniswap" && <ExternalUniswapTradePanel market={tradingMarket} side={side} amount={tradeAmount} onAmountChange={setTradeAmount} />}
          {tradeVenueStatus === "error" && !tradingMarket && (
            <div className="universalTradeUnavailable">
              <strong>Execution check unavailable</strong>
              <p>RMT could not complete route verification. No transaction can be prepared until the check succeeds.</p>
              <button type="button" onClick={retryTradeVenueDiscovery}>Retry route check</button>
            </div>
          )}
          {tradeVenueStatus === "ready" && !tradingMarket && (
            <div className="universalTradeUnavailable">
              <strong>View-only market</strong>
              <p>RMT found no independently verified in-site execution route for this token.</p>
              <button type="button" onClick={retryTradeVenueDiscovery}>Recheck routes</button>
            </div>
          )}
          <footer>
            <span>Non-custodial</span>
            {tradingMarket ? <><span>Fresh quote</span><span>Wallet signs</span></> : <span>Verification required</span>}
          </footer>
        </aside>
      </div>

      <nav className={`universalMobileTradeDock ${mobileTradeOpen ? "tradeOpen" : ""}`} aria-label="Mobile trade actions">
        {tradeVenueStatus === "loading" ? (
          <button type="button" className="routeStatus" disabled>Checking in-site routes…</button>
        ) : tradingMarket ? (
          <>
            <button type="button" className="buy" onClick={() => setTradeSide("buy", true)}>Buy</button>
            <button type="button" className="sell" onClick={() => setTradeSide("sell", true)}>Sell</button>
          </>
        ) : (
          <button type="button" className="routeStatus unavailable" onClick={retryTradeVenueDiscovery}>
            {tradeVenueStatus === "error" ? "Retry execution check" : "View only · recheck routes"}
          </button>
        )}
      </nav>
      <SiteFooter />
    </main>
  );
}
