"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ipfsToHttp } from "../lib/token-metadata";
import { readWatchlist, removeFromWatchlist, WATCHLIST_EVENT, type WatchlistEntry } from "../lib/watchlist";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WatchlistPanel() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);

  useEffect(() => {
    const sync = () => setEntries(readWatchlist());
    sync();
    window.addEventListener(WATCHLIST_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <section className="panel watchlistPanel" aria-labelledby="watchlist-title">
      <div className="feedHeading watchlistHeading">
        <div>
          <p className="eyebrow">YOUR WATCHLIST</p>
          <h2 id="watchlist-title">Saved tokens</h2>
          <p>Private to this device. No account or wallet signature required.</p>
        </div>
        <span className="watchlistCount">{entries.length} WATCHED</span>
      </div>
      <div className="terminalListHeader watchlistListHeader" aria-hidden="true">
        <span>Asset</span><span>Contract</span><span>Market</span><span>Manage</span>
      </div>
      <div className="watchlistGrid">
        {entries.slice(0, 8).map((entry) => (
          <article className="watchlistCard" key={entry.address.toLowerCase()}>
            <Link href={`/token/${entry.address}${entry.launchId ? `?launch=${entry.launchId}` : ""}`}>
              <span className="coin watchlistArtwork">
                {entry.image ? <img src={ipfsToHttp(entry.image)} alt="" loading="lazy" /> : entry.symbol.slice(0, 2)}
              </span>
              <span className="watchlistIdentity">
                <strong>{entry.name}</strong>
                <small>${entry.symbol}</small>
              </span>
              <span className="watchlistContract">{shortAddress(entry.address)}</span>
              <span className="watchlistOpen">Open →</span>
            </Link>
            <button type="button" onClick={() => removeFromWatchlist(entry.address)} aria-label={`Remove ${entry.name} from watchlist`}>Remove</button>
          </article>
        ))}
      </div>
      {entries.length > 8 && <p className="watchlistOverflow">Showing 8 of {entries.length} watched tokens.</p>}
    </section>
  );
}
