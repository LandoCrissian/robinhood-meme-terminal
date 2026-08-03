"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearWatchlistAlertEvents,
  readWatchlistAlertEvents,
  removeWatchlistAlertEvent,
  WATCHLIST_ALERT_HISTORY_EVENT,
  type WatchlistAlertEvent
} from "../lib/watchlist-alert-events";
import {
  watchlistAlertMetricLabel,
  watchlistAlertThresholdLabel
} from "../lib/watchlist-alerts";

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function observedValue(event: WatchlistAlertEvent) {
  return watchlistAlertThresholdLabel({ metric: event.metric, threshold: event.observedValue });
}

export function WatchlistAlertHistory() {
  const [events, setEvents] = useState<WatchlistAlertEvent[]>([]);

  useEffect(() => {
    const sync = () => setEvents(readWatchlistAlertEvents());
    sync();
    window.addEventListener(WATCHLIST_ALERT_HISTORY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WATCHLIST_ALERT_HISTORY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (events.length === 0) return null;

  return (
    <section className="watchlistAlertHistory" aria-labelledby="watchlist-alert-history-heading">
      <header>
        <div>
          <small>PROTECTION INBOX · THIS DEVICE</small>
          <h3 id="watchlist-alert-history-heading">Recent alert activity</h3>
        </div>
        <button type="button" onClick={clearWatchlistAlertEvents}>Clear history</button>
      </header>
      <div className="watchlistAlertHistoryList">
        {events.slice(0, 10).map((event) => (
          <article key={event.id}>
            <Link href={`/market/${event.address}`}>
              <span><b>TRIGGERED</b><strong>${event.symbol} · {event.name}</strong></span>
              <span>{watchlistAlertMetricLabel(event.metric)} {event.direction === "above" ? "reached" : "fell to"} {watchlistAlertThresholdLabel(event)}</span>
              <span><small>Observed</small><strong>{observedValue(event)}</strong></span>
              <time dateTime={new Date(event.triggeredAt).toISOString()}>{relativeTime(event.triggeredAt)}</time>
            </Link>
            <button type="button" onClick={() => removeWatchlistAlertEvent(event.id)} aria-label={`Dismiss ${event.symbol} alert event`}>×</button>
          </article>
        ))}
      </div>
      <footer>Recorded only when an armed rule changes from clear to triggered while RMT is open. History does not prove execution or investment performance.</footer>
    </section>
  );
}
