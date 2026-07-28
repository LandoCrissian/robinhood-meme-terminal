"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { addToWatchlist, isWatched, removeFromWatchlist, WATCHLIST_EVENT } from "../lib/watchlist";

type WatchlistButtonProps = {
  address: Address;
  name: string;
  symbol: string;
  image?: string;
  launchId?: string;
  compactLabel?: boolean;
};

export function WatchlistButton({ address, name, symbol, image, launchId, compactLabel = false }: WatchlistButtonProps) {
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    const sync = () => setWatched(isWatched(address));
    sync();
    window.addEventListener(WATCHLIST_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [address]);

  function toggle() {
    if (watched) {
      removeFromWatchlist(address);
    } else {
      addToWatchlist({
        address,
        name,
        symbol: symbol.replace(/^\$+/, ""),
        image,
        ...(launchId ? { launchId } : {}),
        addedAt: Date.now()
      });
    }
  }

  return (
    <button className={`watchTokenButton${watched ? " active" : ""}`} type="button" aria-pressed={watched} onClick={toggle}>
      <span aria-hidden="true">{watched ? "★" : "☆"}</span>
      {compactLabel ? watched ? "Saved" : "Watch" : watched ? "Watching" : "Watch token"}
    </button>
  );
}
