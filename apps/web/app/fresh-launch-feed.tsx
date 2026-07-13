"use client";

import Link from "next/link";
import { formatEther } from "viem";
import { useCallback, useEffect, useMemo, useState } from "react";
import { activeReleaseBadge, isMainnetRelease } from "../lib/network";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import { ipfsToHttp } from "../lib/token-metadata";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function reserveLabel(reserveWei: string) {
  const value = Number(formatEther(BigInt(reserveWei)));
  if (value === 0) return "New";
  if (value < 0.001) return "<0.001 ETH";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ETH`;
}

function TokenArtwork({ launch, featured = false }: { launch: LaunchFeedItem; featured?: boolean }) {
  return (
    <div className={featured ? "coin hotArtwork" : "coin launchArtwork"}>
      {launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : launch.symbol.slice(0, 2)}
    </div>
  );
}

export function FreshLaunchFeed() {
  const [launches, setLaunches] = useState<LaunchFeedItem[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [message, setMessage] = useState("Synchronizing verified launches.");
  const [showAll, setShowAll] = useState(false);

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
    if (a.graduated !== b.graduated) return a.graduated ? -1 : 1;
    const reserveDifference = BigInt(b.reserveWei) - BigInt(a.reserveWei);
    if (reserveDifference !== 0n) return reserveDifference > 0n ? 1 : -1;
    return BigInt(b.blockNumber) > BigInt(a.blockNumber) ? 1 : -1;
  }).slice(0, 3), [launches]);
  const moving = hot.some((launch) => BigInt(launch.reserveWei) > 0n);
  const visibleLaunches = showAll ? launches : launches.slice(0, 6);

  return (
    <section className="feed panel" id="explore">
      <div className="sectionTitle feedHeading">
        <div><p className="eyebrow">LIVE DISCOVERY</p><h2>{moving ? "Hot now" : "New now"}</h2><p className="sectionCopy">{moving ? "Ranked by live curve reserve—not paid placement." : "The newest verified launches from the RMT factory."}</p></div>
        <span className={`badge ${status === "live" ? "liveBadge" : status === "error" ? "errorBadge" : "warning"}`}>
          {status === "live" ? activeReleaseBadge : status === "error" ? "DATA DELAYED" : "SYNCING"}
        </span>
      </div>

      {hot.length > 0 && <div className="hotGrid">{hot.map((launch, index) => (
        <Link className="hotCard" href={`/token/${launch.token}`} key={`hot-${launch.transactionHash}-${launch.launchId}`}>
          <div className="hotRank">0{index + 1}</div>
          <TokenArtwork launch={launch} featured />
          <div className="hotIdentity"><strong>{launch.name}</strong><span>$${launch.symbol}</span></div>
          <div className="hotSignal"><small>{launch.graduated ? "Status" : "Curve reserve"}</small><strong>{launch.graduated ? "Graduated" : reserveLabel(launch.reserveWei)}</strong></div>
          <div className="miniProgress" aria-label={`${launch.progressBps / 100}% graduation progress`}><span style={{ width: `${launch.progressBps / 100}%` }} /></div>
        </Link>
      ))}</div>}

      <div className="latestHeader"><div><p className="eyebrow">JUST LAUNCHED</p><h3>Latest tokens</h3></div><a href="#launch">Launch yours</a></div>
      {launches.length === 0 ? <div className="emptyFeed"><strong>{status === "loading" ? "Reading Robinhood Chain…" : "No launches to display"}</strong><span>{message}</span>{status === "error" && <button onClick={() => void refresh()}>Retry</button>}</div> : visibleLaunches.map((launch) => (
        <Link className="launchRow" href={`/token/${launch.token}`} key={`${launch.transactionHash}-${launch.launchId}`}>
          <article>
            <TokenArtwork launch={launch} />
            <div className="identity"><strong>{launch.name}</strong><span>$${launch.symbol} • #{launch.launchId}</span></div>
            <div><small>Curve reserve</small><strong>{reserveLabel(launch.reserveWei)}</strong></div>
            <div><small>Graduation</small><strong>{launch.graduated ? "Complete" : `${launch.progressBps / 100}%`}</strong></div>
            <div><small>Creator</small><strong title={launch.creator}>{shortAddress(launch.creator)}</strong></div>
          </article>
        </Link>
      ))}
      {launches.length > 6 && <button className="showMore" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show fewer" : `View all ${launches.length}`}</button>}
      {launches.length > 0 && <p className="feedStatus">{message} Refreshes every 10 seconds.</p>}
    </section>
  );
}
