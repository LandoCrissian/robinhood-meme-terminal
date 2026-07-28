"use client";

import Link from "next/link";
import { formatEther } from "viem";
import { useEffect, useState } from "react";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import { OFFICIAL_RMT_V6_TOKEN } from "../lib/project-page";
import { ipfsToHttp } from "../lib/token-metadata";

const REFRESH_MS = 30_000;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ethLabel(value: string) {
  const eth = Number(formatEther(BigInt(value)));
  if (eth === 0) return "0 ETH";
  if (eth < 0.001) return "<0.001 ETH";
  return `${eth.toLocaleString(undefined, { maximumFractionDigits: 3 })} ETH`;
}

export function OfficialRmtMarket() {
  const [launch, setLaunch] = useState<LaunchFeedItem | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      try {
        const response = await fetch("/api/launches", { cache: "no-store" });
        if (!response.ok) throw new Error("Launch index unavailable");
        const payload = await response.json() as LaunchFeedResponse;
        const official = payload.launches.find(
          (candidate) => candidate.token.toLowerCase() === OFFICIAL_RMT_V6_TOKEN.toLowerCase()
            && candidate.launchId === "0"
            && candidate.officialMigration === true
        );
        if (!active) return;
        setLaunch(official ?? null);
        setUnavailable(!official);
      } catch {
        if (!active) return;
        setUnavailable(true);
      } finally {
        if (active) timer = setTimeout(refresh, REFRESH_MS);
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const marketHref = `/project/${OFFICIAL_RMT_V6_TOKEN}?launch=0#trade`;
  const progress = launch ? Math.min(100, launch.progressBps / 100) : 0;

  return (
    <section className="officialRmtMarket" aria-labelledby="official-rmt-market-title">
      <div className="officialRmtIdentity">
        <div className="officialRmtArtwork">
          {launch?.image
            ? <img src={ipfsToHttp(launch.image)} alt="" />
            : <img src="/brand/rmt-master-logo.png" alt="" />}
        </div>
        <div>
          <p className="eyebrow">RMT NATIVE · FACTORY VERIFIED</p>
          <h2 id="official-rmt-market-title">Robinhood Meme Terminal <span>$RMT</span></h2>
          <p>The existing RMT token trades on its original V6 bonding curve. It has not graduated into a Sushi or Uniswap pool.</p>
        </div>
      </div>

      <div className="officialRmtStatus">
        <span className={launch?.graduated ? "graduated" : "curve"}>
          {unavailable ? "Index unavailable" : launch?.graduated ? "Graduated" : launch ? "Pre-graduation" : "Verifying market"}
        </span>
        <small>New V6 launches paused · existing market remains open</small>
      </div>

      <dl className="officialRmtMetrics">
        <div><dt>Curve progress</dt><dd>{launch ? `${progress.toFixed(progress < 1 ? 2 : 1)}%` : "—"}</dd></div>
        <div><dt>Retained reserve</dt><dd>{launch ? ethLabel(launch.reserveWei) : "—"}</dd></div>
        <div><dt>Trades indexed</dt><dd>{launch ? launch.tradeCount.toLocaleString() : "—"}</dd></div>
        <div><dt>Market</dt><dd title={launch?.market}>{launch ? shortAddress(launch.market) : "Verifying…"}</dd></div>
      </dl>

      <div className="officialRmtProgress" aria-label={`RMT curve progress ${progress.toFixed(2)} percent`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="officialRmtActions">
        <Link href={marketHref}>Open native RMT market</Link>
        <Link href={`/project/${OFFICIAL_RMT_V6_TOKEN}?launch=0`}>View project</Link>
      </div>
    </section>
  );
}
