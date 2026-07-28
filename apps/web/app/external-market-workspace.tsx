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
import { ExternalMarketChart } from "./external-market-chart";
import { ExternalHolderIntelligence, ExternalTradeTape, ExternalWalletPosition } from "./external-market-live";
import { ExternalSushiQuotePanel } from "./external-sushi-quote-panel";
import { ExternalUniswapTradePanel } from "./external-uniswap-trade-panel";
import { SiteFooter } from "./site-footer";
import { WatchlistButton } from "./watchlist-button";

type WorkspaceTab = "activity" | "safety" | "origin";
type TradeSide = "buy" | "sell";

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
  const [market, setMarket] = useState<ExternalMarket>();
  const [status, setStatus] = useState<"loading" | "ready" | "stale" | "error">("loading");
  const [side, setSide] = useState<TradeSide>(initialSide);
  const [tab, setTab] = useState<WorkspaceTab>("activity");
  const [range, setRange] = useState<ExternalChartRange>("24H");
  const [chart, setChart] = useState<ExternalOhlcvPayload>();
  const [chartStatus, setChartStatus] = useState<"loading" | "ready" | "error">("loading");
  const [chartError, setChartError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const tradeRef = useRef<HTMLElement>(null);

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
    if (!market) return;
    const controller = new AbortController();
    setChartStatus("loading");
    setChartError(undefined);
    const query = new URLSearchParams({
      token: market.address,
      pair: market.pairAddress,
      range
    });
    void fetch(`/api/markets/ohlcv?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ExternalOhlcvPayload | { error?: string };
        if (!response.ok || !("candles" in payload)) {
          throw new Error("error" in payload ? payload.error : "Price history unavailable.");
        }
        if (
          payload.token.toLowerCase() !== market.address.toLowerCase()
          || payload.pair.toLowerCase() !== market.pairAddress.toLowerCase()
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
  }, [market, range]);

  const setTradeSide = (next: TradeSide, focus = false) => {
    setSide(next);
    const url = new URL(window.location.href);
    url.searchParams.set("side", next);
    window.history.replaceState(window.history.state, "", url);
    if (focus) window.requestAnimationFrame(() => tradeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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

  if (!tokenAddress) {
    return <main className="universalMarketPage"><Link href="/">← Terminal</Link><section className="universalWorkspaceState"><h1>Invalid market address</h1><p>Open a qualified market from RMT Terminal.</p></section></main>;
  }
  if (!market && status === "loading") {
    return <main className="universalMarketPage"><Link href="/">← Terminal</Link><section className="universalWorkspaceState"><p className="eyebrow">UNIVERSAL TOKEN WORKSPACE</p><h1>Opening live market…</h1><p>Matching token, pool, venue, and origin evidence.</p></section></main>;
  }
  if (!market) {
    return <main className="universalMarketPage"><Link href="/">← Terminal</Link><section className="universalWorkspaceState"><p className="eyebrow">MARKET UNAVAILABLE</p><h1>This market is not in RMT’s qualified index</h1><p>RMT hides execution when the current token and pool cannot be matched to a live indexed market.</p><button type="button" onClick={() => void refreshMarket()}>Retry verification</button></section></main>;
  }

  const venue = venueKind(market);
  const valuation = market.marketCapUsd > 0 ? market.marketCapUsd : market.fdvUsd;
  const oneHourTrades = market.buys1h + market.sells1h;
  const buyPressure = oneHourTrades > 0 ? Math.round(market.buyPressureBps / 100) : 0;

  return (
    <main className="universalMarketPage">
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

        <aside className={`universalTradeRail ${side}`} ref={tradeRef} aria-label={`Trade ${market.name}`}>
          <header><div><small>PLACE ORDER</small><h2>{side === "buy" ? "Buy" : "Sell"} ${market.symbol.replaceAll("$", "")}</h2></div><span>Fresh quote</span></header>
          <div className="universalTradeTabs" role="tablist" aria-label={`Trade side for ${market.name}`}>
            <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "active" : ""} onClick={() => setTradeSide("buy")}>Buy</button>
            <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "active" : ""} onClick={() => setTradeSide("sell")}>Sell</button>
          </div>
          {venue === "sushi" && <ExternalSushiQuotePanel market={market} side={side} />}
          {venue === "uniswap" && <ExternalUniswapTradePanel market={market} side={side} />}
          {!venue && <div className="universalTradeUnavailable"><strong>Read-only market</strong><p>RMT does not have a verified in-site execution route for this venue.</p></div>}
          <footer><span>Non-custodial</span><span>Fresh quote</span><span>Wallet signs</span></footer>
        </aside>
      </div>

      <nav className="universalMobileTradeDock" aria-label="Mobile trade actions">
        <button type="button" className="buy" onClick={() => setTradeSide("buy", true)}>Buy</button>
        <button type="button" className="sell" onClick={() => setTradeSide("sell", true)}>Sell</button>
      </nav>
      <SiteFooter />
    </main>
  );
}
