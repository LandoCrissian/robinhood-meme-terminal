"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ExternalMarket, ExternalMarketResponse } from "../lib/external-market";
import { ipfsToHttp } from "../lib/token-metadata";
import {
  createWatchlistAlert,
  readWatchlistAlerts,
  removeWatchlistAlert,
  replaceWatchlistAlerts,
  WATCHLIST_ALERT_EVENT,
  watchlistAlertMatches,
  watchlistAlertMetricLabel,
  type WatchlistAlert,
  type WatchlistAlertDirection,
  type WatchlistAlertMetric
} from "../lib/watchlist-alerts";
import {
  readWatchlist,
  removeFromWatchlist,
  watchlistEntryHref,
  WATCHLIST_EVENT,
  type WatchlistEntry
} from "../lib/watchlist";

const MARKET_REFRESH_MS = 30_000;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function money(value: number, precise = false) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (precise && value < 0.01) {
    return `$${value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value < 10 ? 4 : 2
  }).format(value);
}

function alertSentence(alert: WatchlistAlert) {
  return `${watchlistAlertMetricLabel(alert.metric)} ${alert.direction} ${money(alert.threshold, alert.metric === "priceUsd")}`;
}

export function WatchlistPanel() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [alerts, setAlerts] = useState<WatchlistAlert[]>([]);
  const [markets, setMarkets] = useState<ExternalMarket[]>([]);
  const [marketStatus, setMarketStatus] = useState<"loading" | "live" | "stale">("loading");
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [metric, setMetric] = useState<WatchlistAlertMetric>("priceUsd");
  const [direction, setDirection] = useState<WatchlistAlertDirection>("above");
  const [threshold, setThreshold] = useState("");
  const [formMessage, setFormMessage] = useState("");

  useEffect(() => {
    const syncEntries = () => setEntries(readWatchlist());
    const syncAlerts = () => setAlerts(readWatchlistAlerts());
    syncEntries();
    syncAlerts();
    window.addEventListener(WATCHLIST_EVENT, syncEntries);
    window.addEventListener(WATCHLIST_ALERT_EVENT, syncAlerts);
    window.addEventListener("storage", syncEntries);
    window.addEventListener("storage", syncAlerts);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, syncEntries);
      window.removeEventListener(WATCHLIST_ALERT_EVENT, syncAlerts);
      window.removeEventListener("storage", syncEntries);
      window.removeEventListener("storage", syncAlerts);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/markets/external", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("market request failed");
        const payload = await response.json() as ExternalMarketResponse;
        if (!active || !Array.isArray(payload.markets)) return;
        setMarkets(payload.markets);
        setMarketStatus(payload.stale ? "stale" : "live");
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) setMarketStatus("stale");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), MARKET_REFRESH_MS);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  const marketByAddress = useMemo(
    () => new Map(markets.map((market) => [market.address.toLowerCase(), market])),
    [markets]
  );

  function openAlertEditor(entry: WatchlistEntry) {
    const market = marketByAddress.get(entry.address);
    setEditingAddress(entry.address);
    setMetric("priceUsd");
    setDirection("above");
    setThreshold(market?.priceUsd ? String(Number((market.priceUsd * 1.1).toPrecision(6))) : "");
    setFormMessage("");
  }

  function saveAlert(entry: WatchlistEntry) {
    const numericThreshold = Number(threshold);
    if (!Number.isFinite(numericThreshold) || numericThreshold <= 0) {
      setFormMessage("Enter a value greater than zero.");
      return;
    }
    if (!createWatchlistAlert({ address: entry.address, metric, direction, threshold: numericThreshold })) {
      setFormMessage("This alert could not be saved.");
      return;
    }
    setEditingAddress(null);
    setFormMessage("");
  }

  function removeEntry(entry: WatchlistEntry) {
    removeFromWatchlist(entry.address);
    replaceWatchlistAlerts(alerts.filter((alert) => alert.address !== entry.address));
  }

  if (entries.length === 0) {
    return (
      <section className="panel watchlistPanel" aria-labelledby="watchlist-title">
        <div className="emptyFeed">
          <strong id="watchlist-title">Your watchlist is ready</strong>
          <span>Save a verified RMT token to keep it close on this device.</span>
          <Link href="/">Find a token</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="panel watchlistPanel watchlistMonitor" aria-labelledby="watchlist-title">
      <div className="feedHeading watchlistHeading">
        <div>
          <p className="eyebrow">YOUR MARKET MONITOR</p>
          <h2 id="watchlist-title">Watchlist alerts</h2>
          <p>Track live price, liquidity, and volume conditions while this page is open.</p>
        </div>
        <div className="watchlistHeadingStatus">
          <span className={`watchlistLiveStatus ${marketStatus}`}>{marketStatus === "live" ? "● LIVE" : marketStatus === "loading" ? "SYNCING" : "STALE"}</span>
          <span className="watchlistCount">{entries.length} WATCHED</span>
        </div>
      </div>
      <div className="watchlistAlertDisclosure">
        In-app monitoring only. Rules stay on this device and do not send background, email, or push notifications.
      </div>
      <div className="watchlistGrid">
        {entries.slice(0, 8).map((entry) => {
          const market = marketByAddress.get(entry.address);
          const entryAlerts = alerts.filter((alert) => alert.address === entry.address);
          const matchedAlerts = market
            ? entryAlerts.filter((alert) => watchlistAlertMatches(alert, market))
            : [];
          return (
            <article className={`watchlistCard ${matchedAlerts.length > 0 ? "hasTriggeredAlert" : ""}`} key={entry.address}>
              <div className="watchlistAssetRow">
                <Link href={watchlistEntryHref(entry)} className="watchlistAssetLink">
                  <span className="coin watchlistArtwork">
                    {entry.image ? <img src={ipfsToHttp(entry.image)} alt="" loading="lazy" /> : entry.symbol.slice(0, 2)}
                  </span>
                  <span className="watchlistIdentity">
                    <strong>{entry.name}</strong>
                    <small>${entry.symbol} · {shortAddress(entry.address)}</small>
                  </span>
                </Link>
                <div className="watchlistMarketSnapshot" aria-label={`${entry.name} market snapshot`}>
                  <span><small>Price</small><strong>{market ? money(market.priceUsd, true) : "—"}</strong></span>
                  <span><small>Liquidity</small><strong>{market ? money(market.liquidityUsd) : "—"}</strong></span>
                  <span><small>24h volume</small><strong>{market ? money(market.volume24h) : "—"}</strong></span>
                </div>
                <div className="watchlistActions">
                  <button type="button" className="watchlistAlertButton" onClick={() => openAlertEditor(entry)}>+ Alert</button>
                  <button type="button" onClick={() => removeEntry(entry)} aria-label={`Remove ${entry.name} from watchlist`}>Remove</button>
                </div>
              </div>
              {entryAlerts.length > 0 && (
                <div className="watchlistRules" aria-label={`${entry.name} alert rules`}>
                  {entryAlerts.map((alert) => {
                    const matched = matchedAlerts.some((candidate) => candidate.id === alert.id);
                    return (
                      <span className={matched ? "matched" : ""} key={alert.id}>
                        <b>{matched ? "Condition met" : "Watching"}</b>
                        {alertSentence(alert)}
                        <button type="button" onClick={() => removeWatchlistAlert(alert.id)} aria-label={`Delete ${alertSentence(alert)}`}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              {!market && marketStatus !== "loading" && (
                <p className="watchlistUnavailable">Live metrics are not available in the current qualified market feed.</p>
              )}
              {editingAddress === entry.address && (
                <div className="watchlistAlertEditor">
                  <label>
                    <span>Metric</span>
                    <select value={metric} onChange={(event) => setMetric(event.target.value as WatchlistAlertMetric)}>
                      <option value="priceUsd">Price</option>
                      <option value="liquidityUsd">Liquidity</option>
                      <option value="volume24h">24h volume</option>
                    </select>
                  </label>
                  <label>
                    <span>Condition</span>
                    <select value={direction} onChange={(event) => setDirection(event.target.value as WatchlistAlertDirection)}>
                      <option value="above">At or above</option>
                      <option value="below">At or below</option>
                    </select>
                  </label>
                  <label className="watchlistThreshold">
                    <span>USD value</span>
                    <input
                      inputMode="decimal"
                      min="0"
                      type="number"
                      value={threshold}
                      onChange={(event) => setThreshold(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <div className="watchlistEditorActions">
                    <button type="button" onClick={() => saveAlert(entry)}>Save alert</button>
                    <button type="button" onClick={() => setEditingAddress(null)}>Cancel</button>
                  </div>
                  {formMessage && <small role="alert">{formMessage}</small>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {entries.length > 8 && <p className="watchlistOverflow">Showing 8 of {entries.length} watched tokens.</p>}
    </section>
  );
}
