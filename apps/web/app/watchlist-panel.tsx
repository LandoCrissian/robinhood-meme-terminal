"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExternalMarket, ExternalMarketResponse } from "../lib/external-market";
import { summarizeExternalSellPressure, type ExternalPoolTradesPayload, type ExternalSellPressure } from "../lib/external-trades";
import { ipfsToHttp } from "../lib/token-metadata";
import { recordWatchlistAlertEvent } from "../lib/watchlist-alert-events";
import {
  createWatchlistAlert,
  marketWatchlistAlertSnapshot,
  readWatchlistAlerts,
  removeWatchlistAlert,
  replaceWatchlistAlerts,
  WATCHLIST_ALERT_EVENT,
  watchlistAlertMatches,
  watchlistAlertMetricLabel,
  watchlistAlertStoredValue,
  watchlistAlertThresholdLabel,
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
import { useLocalWatchlistAlertState } from "./use-local-watchlist-alert-state";
import { WatchlistAlertHistory } from "./watchlist-alert-history";

const MARKET_REFRESH_MS = 30_000;
const TRADE_TAPE_REFRESH_MS = 15_000;

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
  return `${watchlistAlertMetricLabel(alert.metric)} ${alert.direction === "above" ? "at or above" : "at or below"} ${watchlistAlertThresholdLabel(alert)}`;
}

function defaultAlert(metric: WatchlistAlertMetric, market?: ExternalMarket) {
  if (metric === "priceUsd") return { direction: "above" as const, value: market?.priceUsd ? Number((market.priceUsd * 1.1).toPrecision(6)) : 0 };
  if (metric === "liquidityUsd") return { direction: "below" as const, value: market?.liquidityUsd ? Math.round(market.liquidityUsd * 0.9) : 0 };
  if (metric === "volume24h") return { direction: "above" as const, value: market?.volume24h ? Math.round(market.volume24h * 1.25) : 0 };
  if (metric === "runnerPace") return { direction: "above" as const, value: 1.5 };
  if (metric === "liquidityDropBps") return { direction: "above" as const, value: 10 };
  if (metric === "largeSellLiquidityBps") return { direction: "above" as const, value: 1 };
  return { direction: "above" as const, value: 3 };
}

export function WatchlistPanel() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [alerts, setAlerts] = useState<WatchlistAlert[]>([]);
  const [markets, setMarkets] = useState<ExternalMarket[]>([]);
  const [previousMarkets, setPreviousMarkets] = useState<ExternalMarket[]>([]);
  const [tradePressure, setTradePressure] = useState<Record<string, ExternalSellPressure>>({});
  const [marketStatus, setMarketStatus] = useState<"loading" | "live" | "stale">("loading");
  const alertSyncState = useLocalWatchlistAlertState();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [metric, setMetric] = useState<WatchlistAlertMetric>("priceUsd");
  const [direction, setDirection] = useState<WatchlistAlertDirection>("above");
  const [threshold, setThreshold] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const latestMarketsRef = useRef<ExternalMarket[]>([]);
  const alertMatchStateRef = useRef(new Map<string, boolean>());
  const notifiedAlertAtRef = useRef(new Map<string, number>());

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
    if (typeof Notification !== "undefined") setNotificationPermission(Notification.permission);
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
        setPreviousMarkets(latestMarketsRef.current);
        latestMarketsRef.current = payload.markets;
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
  const previousMarketByAddress = useMemo(
    () => new Map(previousMarkets.map((market) => [market.address.toLowerCase(), market])),
    [previousMarkets]
  );
  const tradeTapeMarkets = useMemo(() => {
    const monitored = new Set(
      alerts
        .filter((alert) => alert.enabled && (alert.metric === "largeSellLiquidityBps" || alert.metric === "netSellLiquidityBps"))
        .map((alert) => alert.address)
    );
    return entries
      .slice(0, 8)
      .flatMap((entry) => {
        const market = marketByAddress.get(entry.address);
        return market && monitored.has(entry.address) ? [market] : [];
      });
  }, [alerts, entries, marketByAddress]);

  useEffect(() => {
    if (tradeTapeMarkets.length === 0) {
      setTradePressure({});
      return;
    }
    let active = true;
    const load = async () => {
      const results = await Promise.all(tradeTapeMarkets.map(async (market) => {
        const query = new URLSearchParams({ token: market.address, pair: market.pairAddress });
        try {
          const response = await fetch(`/api/markets/external-trades?${query}`, { cache: "no-store" });
          const payload = await response.json() as ExternalPoolTradesPayload | { error?: string };
          if (
            !response.ok
            || !("trades" in payload)
            || payload.token.toLowerCase() !== market.address.toLowerCase()
            || payload.pair.toLowerCase() !== market.pairAddress.toLowerCase()
          ) return null;
          return [market.address.toLowerCase(), summarizeExternalSellPressure(payload.trades, market.liquidityUsd)] as const;
        } catch {
          return null;
        }
      }));
      if (!active) return;
      setTradePressure(Object.fromEntries(results.filter((result): result is NonNullable<typeof result> => Boolean(result))));
    };
    void load();
    const timer = window.setInterval(() => void load(), TRADE_TAPE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [tradeTapeMarkets]);

  const alertEvaluations = useMemo(() => entries.slice(0, 8).flatMap((entry) => {
    const market = marketByAddress.get(entry.address);
    if (!market) return [];
    const snapshot = marketWatchlistAlertSnapshot(
      market,
      previousMarketByAddress.get(entry.address),
      tradePressure[entry.address]
    );
    return alerts
      .filter((alert) => alert.address === entry.address)
      .map((alert) => ({
        alert,
        entry,
        matched: watchlistAlertMatches(alert, snapshot),
        observedValue: snapshot[alert.metric]
      }));
  }), [alerts, entries, marketByAddress, previousMarketByAddress, tradePressure]);

  useEffect(() => {
    const now = Date.now();
    const newlyMatched = alertEvaluations.filter((evaluation) => (
      evaluation.matched
      && alertMatchStateRef.current.get(evaluation.alert.id) === false
      && now - (notifiedAlertAtRef.current.get(evaluation.alert.id) ?? 0) >= 5 * 60_000
    ));
    for (const evaluation of alertEvaluations) {
      alertMatchStateRef.current.set(evaluation.alert.id, evaluation.matched);
    }
    if (newlyMatched.length === 0) return;
    for (const evaluation of newlyMatched) {
      notifiedAlertAtRef.current.set(evaluation.alert.id, now);
      if (typeof evaluation.observedValue === "number" && Number.isFinite(evaluation.observedValue)) {
        recordWatchlistAlertEvent({
          alert: evaluation.alert,
          name: evaluation.entry.name,
          symbol: evaluation.entry.symbol,
          observedValue: evaluation.observedValue,
          triggeredAt: now
        });
      }
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([150, 70, 150]);
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const evaluation of newlyMatched.slice(0, 3)) {
      new Notification(`RMT Alert · $${evaluation.entry.symbol}`, {
        body: alertSentence(evaluation.alert),
        tag: `rmt-watchlist:${evaluation.alert.id}`
      });
    }
  }, [alertEvaluations]);

  function openAlertEditor(entry: WatchlistEntry) {
    const market = marketByAddress.get(entry.address);
    const next = defaultAlert("priceUsd", market);
    setEditingAddress(entry.address);
    setMetric("priceUsd");
    setDirection(next.direction);
    setThreshold(next.value ? String(next.value) : "");
    setFormMessage("");
  }

  function changeMetric(entry: WatchlistEntry, nextMetric: WatchlistAlertMetric) {
    const next = defaultAlert(nextMetric, marketByAddress.get(entry.address));
    setMetric(nextMetric);
    setDirection(next.direction);
    setThreshold(next.value ? String(next.value) : "");
  }

  function saveAlert(entry: WatchlistEntry) {
    const displayedThreshold = Number(threshold);
    const numericThreshold = watchlistAlertStoredValue(metric, displayedThreshold);
    if (!Number.isFinite(displayedThreshold) || displayedThreshold <= 0 || !Number.isFinite(numericThreshold)) {
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

  function savePreset(entry: WatchlistEntry, presetMetric: WatchlistAlertMetric, displayedThreshold: number) {
    const preset = defaultAlert(presetMetric, marketByAddress.get(entry.address));
    const saved = createWatchlistAlert({
      address: entry.address,
      metric: presetMetric,
      direction: preset.direction,
      threshold: watchlistAlertStoredValue(presetMetric, displayedThreshold)
    });
    setFormMessage(saved ? "Alert armed." : "This alert could not be saved.");
    if (saved) setEditingAddress(null);
  }

  async function enableBrowserAlerts() {
    if (typeof Notification === "undefined") {
      setFormMessage("This browser does not support system notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setFormMessage(permission === "granted"
      ? "Browser alerts enabled while RMT is open."
      : "Browser alerts were not enabled. In-app monitoring remains active.");
  }

  function removeEntry(entry: WatchlistEntry) {
    removeFromWatchlist(entry.address);
    replaceWatchlistAlerts(alerts.filter((alert) => alert.address !== entry.address));
  }

  if (entries.length === 0) {
    return (
      <section className="panel watchlistPanel" aria-labelledby="watchlist-title">
        <WatchlistAlertHistory />
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
          <button type="button" className="watchlistNotifyButton" onClick={() => void enableBrowserAlerts()}>
            {notificationPermission === "granted" ? "Alerts on" : "Enable alerts"}
          </button>
          <span className={`watchlistCloudStatus ${alertSyncState}`}>{alertSyncState === "synced" ? "ACCOUNT SYNC" : alertSyncState === "syncing" ? "SYNCING" : alertSyncState === "error" ? "LOCAL ONLY" : "DEVICE"}</span>
          <span className={`watchlistLiveStatus ${marketStatus}`}>{marketStatus === "live" ? "● LIVE" : marketStatus === "loading" ? "SYNCING" : "STALE"}</span>
          <span className="watchlistCount">{entries.length} WATCHED</span>
        </div>
      </div>
      <div className="watchlistAlertDisclosure">
        Signed-in rules follow your RMT account when cloud access is available. Market and browser alerts monitor only while RMT is open; no rule can trade or sign for you.
      </div>
      {formMessage && <div className="watchlistStatusMessage" role="status">{formMessage}</div>}
      <WatchlistAlertHistory />
      <div className="watchlistGrid">
        {entries.slice(0, 8).map((entry) => {
          const market = marketByAddress.get(entry.address);
          const entryAlerts = alerts.filter((alert) => alert.address === entry.address);
          const matchedAlerts = alertEvaluations
            .filter((evaluation) => evaluation.entry.address === entry.address && evaluation.matched)
            .map((evaluation) => evaluation.alert);
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
                    <select value={metric} onChange={(event) => changeMetric(entry, event.target.value as WatchlistAlertMetric)}>
                      <option value="priceUsd">Price</option>
                      <option value="liquidityUsd">Liquidity</option>
                      <option value="volume24h">24h volume</option>
                      <option value="runnerPace">Runner pace</option>
                      <option value="liquidityDropBps">Liquidity drop</option>
                      <option value="largeSellLiquidityBps">Largest confirmed sell</option>
                      <option value="netSellLiquidityBps">5m net sell flow</option>
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
                    <span>{metric === "runnerPace" ? "Pace multiple" : metric.endsWith("Bps") ? "Percent of liquidity" : "USD value"}</span>
                    <input
                      inputMode="decimal"
                      min="0"
                      step={metric === "runnerPace" || metric.endsWith("Bps") ? "0.1" : "any"}
                      type="number"
                      value={threshold}
                      onChange={(event) => setThreshold(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <div className="watchlistAlertPresets" aria-label="Quick alert presets">
                    <button type="button" onClick={() => savePreset(entry, "largeSellLiquidityBps", 1)}>Large sell · 1%</button>
                    <button type="button" onClick={() => savePreset(entry, "netSellLiquidityBps", 3)}>Net sells · 3%</button>
                    <button type="button" onClick={() => savePreset(entry, "liquidityDropBps", 10)}>Liquidity drop · 10%</button>
                    <button type="button" onClick={() => savePreset(entry, "runnerPace", 1.5)}>Runner pace · 1.5×</button>
                  </div>
                  <div className="watchlistEditorActions">
                    <button type="button" onClick={() => saveAlert(entry)}>Save alert</button>
                    <button type="button" onClick={() => setEditingAddress(null)}>Cancel</button>
                  </div>
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
