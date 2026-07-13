"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import { ipfsToHttp } from "../lib/token-metadata";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function FreshLaunchFeed() {
  const [launches, setLaunches] = useState<LaunchFeedItem[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [message, setMessage] = useState("Synchronizing verified launches.");

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
        ? "Factory connected. No testnet launches yet."
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

  return (
    <section className="feed panel">
      <div className="sectionTitle">
        <div><p className="eyebrow">DISCOVERY TERMINAL</p><h2>Fresh launches</h2></div>
        <span className={`badge ${status === "live" ? "liveBadge" : status === "error" ? "errorBadge" : "warning"}`}>
          {status === "live" ? "LIVE TESTNET" : status === "error" ? "DATA DELAYED" : "SYNCING"}
        </span>
      </div>
      <div className="filters"><button className="active">Fresh</button><button disabled>Trending</button><button disabled>Community-heavy</button><button disabled>Low creator concentration</button></div>
      {launches.length === 0 ? <div className="emptyFeed"><strong>{status === "loading" ? "Reading Robinhood Chain…" : "No launches to display"}</strong><span>{message}</span>{status === "error" && <button onClick={() => void refresh()}>Retry</button>}</div> : launches.map((launch) => (
        <Link className="launchRow" href={`/token/${launch.token}`} key={`${launch.transactionHash}-${launch.launchId}`}>
          <article>
            <div className="coin launchArtwork">{launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : launch.symbol.slice(0, 2)}</div>
            <div className="identity"><strong>{launch.name}</strong><span>${launch.symbol} • #{launch.launchId}</span></div>
            <div><small>Fixed supply</small><strong>1,000,000,000</strong></div>
            <div><small>Community share</small><strong>{launch.communityBps / 100}%</strong></div>
            <div><small>Creator</small><strong title={launch.creator}>{shortAddress(launch.creator)}</strong></div>
          </article>
        </Link>
      ))}
      {launches.length > 0 && <p className="feedStatus">{message} Refreshes every 10 seconds.</p>}
    </section>
  );
}
