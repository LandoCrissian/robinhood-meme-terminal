"use client";

import Link from "next/link";
import { formatEther } from "viem";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeReleaseBadge, isMainnetRelease } from "../lib/network";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import { ipfsToHttp } from "../lib/token-metadata";
import { MarketPanel } from "./market-panel";

const FIXED_SUPPLY = 1_000_000_000n * 10n ** 18n;

function displaySymbol(symbol: string) {
  return symbol.replace(/^\$+/, "");
}

function reserveLabel(reserveWei: string) {
  const value = Number(formatEther(BigInt(reserveWei)));
  if (value === 0) return "New";
  if (value < 0.001) return "<0.001 ETH";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ETH`;
}

function volumeLabel(volumeWei: string) {
  const value = Number(formatEther(BigInt(volumeWei)));
  if (value === 0) return "0 ETH";
  if (value < 0.001) return "<0.001 ETH";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ETH`;
}

function activityLabel(launch: LaunchFeedItem) {
  if (launch.tradeCount === 0) return "No recent trades";
  return `${launch.buyCount} buy${launch.buyCount === 1 ? "" : "s"} · ${launch.sellCount} sell${launch.sellCount === 1 ? "" : "s"}`;
}

function TokenArtwork({ launch, featured = false }: { launch: LaunchFeedItem; featured?: boolean }) {
  return (
    <div className={featured ? "coin hotArtwork" : "coin launchArtwork"}>
      {launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : launch.symbol.slice(0, 2)}
    </div>
  );
}

function QuickTradeDialog({ launch, side, onClose }: { launch: LaunchFeedItem; side: "buy" | "sell"; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return <>
    <button className="quickTradeBackdrop" type="button" aria-label="Close quick trade" onClick={onClose} />
    <section className="quickTradeDialog" role="dialog" aria-modal="true" aria-label={`${side === "buy" ? "Buy" : "Sell"} ${launch.name}`}>
      <header className="quickTradeHeader">
        <div className="quickTradeIdentity"><TokenArtwork launch={launch} featured /><span><small>QUICK TRADE · RMT V6</small><strong>{launch.name}</strong><em>${displaySymbol(launch.symbol)}</em></span></div>
        <div className="quickTradeHeaderActions"><Link href={`/token/${launch.token}?side=${side}#trade`}>Full page ↗</Link><button ref={closeButton} type="button" aria-label="Close quick trade" onClick={onClose}>×</button></div>
      </header>
      <div className="quickTradeBody">
        <MarketPanel key={`${launch.token}-${side}`} tokenAddress={launch.token} symbol={displaySymbol(launch.symbol)} totalSupply={FIXED_SUPPLY} creator={launch.creator} compact initialMode={side} />
      </div>
      <footer className="quickTradeFooter"><span>Live onchain quote</span><span>Wallet confirmation required</span><span>RMT never controls your funds</span></footer>
    </section>
  </>;
}

export function FreshLaunchFeed() {
  const [launches, setLaunches] = useState<LaunchFeedItem[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [message, setMessage] = useState("Synchronizing verified launches.");
  const [showAll, setShowAll] = useState(false);
  const [quickTrade, setQuickTrade] = useState<{ launch: LaunchFeedItem; side: "buy" | "sell" }>();
  const closeQuickTrade = useCallback(() => setQuickTrade(undefined), []);

  const refresh = useCallback(async () => {
    setStatus((current) => current === "live" ? "live" : "loading");
    try {
      const response = await fetch("/api/launches", { cache: "no-store" });
      const result = (await response.json()) as LaunchFeedResponse | { error?: string };
      if (!response.ok || !("launches" in result)) {
        throw new Error("error" in result && result.error ? result.error : "Launch data is temporarily unavailable.");
      }
      setLaunches(result.launches);
      setStatus("live");
      setMessage(result.launches.length === 0
        ? isMainnetRelease ? "Factory connected. No mainnet launches yet." : "Factory connected. No testnet launches yet."
        : `${result.launches.length} verified factory launch${result.launches.length === 1 ? "" : "es"}.`);
    } catch (error) {
      // Never leave launches from a previously active factory visible when the
      // registry changes or the current factory cannot be verified.
      setLaunches([]);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Launch data is temporarily unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const hot = useMemo(() => [...launches].sort((a, b) => {
    const volumeDifference = BigInt(b.volumeWei) - BigInt(a.volumeWei);
    if (volumeDifference !== 0n) return volumeDifference > 0n ? 1 : -1;
    if (a.tradeCount !== b.tradeCount) return b.tradeCount - a.tradeCount;
    const reserveDifference = BigInt(b.reserveWei) - BigInt(a.reserveWei);
    if (reserveDifference !== 0n) return reserveDifference > 0n ? 1 : -1;
    return BigInt(b.blockNumber) > BigInt(a.blockNumber) ? 1 : -1;
  }).slice(0, 3), [launches]);
  const moving = hot.some((launch) => launch.tradeCount > 0 || BigInt(launch.reserveWei) > 0n);
  const visibleLaunches = showAll ? launches : launches.slice(0, 6);

  return (
    <section className="feed panel" id="explore">
      <div className="sectionTitle feedHeading">
        <div><p className="eyebrow">LIVE DISCOVERY</p><h2>{moving ? "Hot now" : "New now"}</h2><p className="sectionCopy">{moving ? "Ranked by recent onchain volume, trade count, and curve reserve—never paid placement." : "The newest verified launches from the RMT factory."}</p></div>
        <span className={`badge ${status === "live" ? "liveBadge" : status === "error" ? "errorBadge" : "warning"}`}>
          {status === "live" ? activeReleaseBadge : status === "error" ? "DATA DELAYED" : "SYNCING"}
        </span>
      </div>

      {hot.length > 0 && <div className="hotGrid">{hot.map((launch, index) => (
        <article className="hotCard" key={`hot-${launch.transactionHash}-${launch.launchId}`}>
          <Link className="hotCardMain" href={`/token/${launch.token}`} aria-label={`Open ${launch.name}`}>
            <div className="hotRank">0{index + 1}</div>
            <TokenArtwork launch={launch} featured />
            <div className="hotIdentity"><strong>{launch.name}</strong><span>{"$" + displaySymbol(launch.symbol)}</span></div>
            <div className="hotSignal"><span><small>{launch.graduated ? "Curve complete" : "Recent volume"}</small><em>{activityLabel(launch)}</em></span><strong>{volumeLabel(launch.volumeWei)}</strong></div>
            <div className="miniProgress" aria-label={`${launch.progressBps / 100}% graduation progress`}><span style={{ width: `${launch.progressBps / 100}%` }} /></div>
          </Link>
          <div className="tokenCardActions"><button className="buyCardAction" type="button" aria-haspopup="dialog" aria-label={`Quick buy ${launch.name}`} onClick={() => setQuickTrade({ launch, side: "buy" })}>Buy</button><button className="sellCardAction" type="button" aria-haspopup="dialog" aria-label={`Quick sell ${launch.name}`} onClick={() => setQuickTrade({ launch, side: "sell" })}>Sell</button></div>
        </article>
      ))}</div>}

      <div className="latestHeader"><div><p className="eyebrow">JUST LAUNCHED</p><h3>Latest tokens</h3></div><Link href="/launch">Launch yours</Link></div>
      {launches.length === 0 ? <div className="emptyFeed"><strong>{status === "loading" ? "Reading Robinhood Chain…" : "No launches to display"}</strong><span>{message}</span>{status === "error" && <button onClick={() => void refresh()}>Retry</button>}</div> : visibleLaunches.map((launch) => (
        <article className="launchRowCard" key={`${launch.transactionHash}-${launch.launchId}`}>
          <Link className="launchRowMain" href={`/token/${launch.token}`} aria-label={`Open ${launch.name}`}>
            <TokenArtwork launch={launch} />
            <div className="identity"><strong>{launch.name}</strong><span>{"$" + displaySymbol(launch.symbol) + " • #" + launch.launchId}</span></div>
            <div className="launchMetrics"><span><small>Reserve</small><strong>{reserveLabel(launch.reserveWei)}</strong></span><span><small>Volume</small><strong>{volumeLabel(launch.volumeWei)}</strong></span><span><small>Graduation</small><strong>{launch.graduated ? "Complete" : `${launch.progressBps / 100}%`}</strong></span></div>
          </Link>
          <div className="launchActions"><button className="buyCardAction" type="button" aria-haspopup="dialog" aria-label={`Quick buy ${launch.name}`} onClick={() => setQuickTrade({ launch, side: "buy" })}>Buy</button><button className="sellCardAction" type="button" aria-haspopup="dialog" aria-label={`Quick sell ${launch.name}`} onClick={() => setQuickTrade({ launch, side: "sell" })}>Sell</button></div>
        </article>
      ))}
      {launches.length > 6 && <button className="showMore" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show fewer" : `View all ${launches.length}`}</button>}
      {launches.length > 0 && <p className="feedStatus">{message} Refreshes every 10 seconds.</p>}
      {quickTrade && <QuickTradeDialog launch={quickTrade.launch} side={quickTrade.side} onClose={closeQuickTrade} />}
    </section>
  );
}
