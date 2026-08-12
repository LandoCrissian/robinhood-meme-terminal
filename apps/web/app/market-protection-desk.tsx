"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExternalMarket } from "../lib/external-market";
import type { ExternalSellPressure } from "../lib/external-trades";
import { recordWatchlistAlertEvent } from "../lib/watchlist-alert-events";
import {
  MARKET_PROTECTION_PRESETS,
  marketProtectionAlertInput,
  type MarketProtectionPresetId
} from "../lib/market-protection";
import {
  createWatchlistAlert,
  marketWatchlistAlertSnapshot,
  readWatchlistAlerts,
  removeWatchlistAlert,
  WATCHLIST_ALERT_EVENT,
  watchlistAlertMatches,
  watchlistAlertThresholdLabel,
  type WatchlistAlert
} from "../lib/watchlist-alerts";
import { addToWatchlist } from "../lib/watchlist";
import { useLocalWatchlistAlertState } from "./use-local-watchlist-alert-state";

function ruleLabel(alert: WatchlistAlert) {
  const preset = MARKET_PROTECTION_PRESETS.find((candidate) => candidate.metric === alert.metric);
  return `${preset?.label ?? "Market alert"} · ${watchlistAlertThresholdLabel(alert)}`;
}

export function MarketProtectionDesk({
  market,
  sellPressure
}: {
  market: ExternalMarket;
  sellPressure?: ExternalSellPressure;
}) {
  const [alerts, setAlerts] = useState<WatchlistAlert[]>([]);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [message, setMessage] = useState("");
  const alertSyncState = useLocalWatchlistAlertState();
  const previousMarketRef = useRef<ExternalMarket | undefined>(undefined);
  const alertMatchStateRef = useRef(new Map<string, boolean>());

  useEffect(() => {
    const sync = () => setAlerts(readWatchlistAlerts().filter((alert) => alert.address === market.address.toLowerCase()));
    sync();
    window.addEventListener(WATCHLIST_ALERT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WATCHLIST_ALERT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [market.address]);

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  const snapshot = useMemo(() => marketWatchlistAlertSnapshot(
    market,
    previousMarketRef.current,
    sellPressure
  ), [market, sellPressure]);

  const matchedAlerts = useMemo(
    () => alerts.filter((alert) => watchlistAlertMatches(alert, snapshot)),
    [alerts, snapshot]
  );

  useEffect(() => {
    previousMarketRef.current = market;
  }, [market]);

  useEffect(() => {
    const newlyMatched = alerts.filter((alert) => (
      watchlistAlertMatches(alert, snapshot)
      && alertMatchStateRef.current.get(alert.id) === false
    ));
    for (const alert of alerts) {
      alertMatchStateRef.current.set(alert.id, watchlistAlertMatches(alert, snapshot));
    }
    if (newlyMatched.length === 0) return;
    const triggeredAt = Date.now();
    for (const alert of newlyMatched) {
      const observedValue = snapshot[alert.metric];
      if (typeof observedValue === "number" && Number.isFinite(observedValue)) {
        recordWatchlistAlertEvent({
          alert,
          name: market.name,
          symbol: market.symbol,
          observedValue,
          triggeredAt
        });
      }
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([150, 70, 150]);
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const alert of newlyMatched.slice(0, 3)) {
      new Notification(`RMT Alert · $${market.symbol.replace(/^\$+/, "")}`, {
        body: ruleLabel(alert),
        tag: `rmt-watchlist:${alert.id}`
      });
    }
  }, [alerts, market.name, market.symbol, snapshot]);

  function armPreset(id: MarketProtectionPresetId) {
    const input = marketProtectionAlertInput(id, market.address);
    if (!input) return;
    const watched = addToWatchlist({
      address: market.address,
      name: market.name,
      symbol: market.symbol.replace(/^\$+/, ""),
      image: market.project?.imageUri ?? market.imageUri ?? undefined,
      addedAt: Date.now()
    });
    if (alerts.some((alert) => (
      alert.metric === input.metric
      && alert.direction === input.direction
      && alert.threshold === input.threshold
    ))) {
      setMessage(watched ? "This rule is already armed. The market remains on your watchlist." : "This rule is already armed.");
      return;
    }
    const saved = createWatchlistAlert(input);
    setMessage(saved && watched
      ? `${MARKET_PROTECTION_PRESETS.find((preset) => preset.id === id)?.label ?? "Alert"} armed. The market is also saved to your watchlist.`
      : saved
        ? "Alert armed, but RMT could not update the watchlist record on this device."
        : "RMT could not save this rule on the device.");
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setMessage("This browser does not support system notifications. In-page monitoring remains active.");
      return;
    }
    const next = await Notification.requestPermission();
    setPermission(next);
    setMessage(next === "granted"
      ? "Browser alerts enabled while RMT is open."
      : "Browser alerts were not enabled. In-page monitoring remains active.");
  }

  return (
    <section className={`marketProtectionDesk ${matchedAlerts.length > 0 ? "triggered" : ""}`} aria-labelledby="market-protection-heading">
      <header>
        <div>
          <small>PROTECTION DESK · USER CONTROLLED</small>
          <h3 id="market-protection-heading">Market alerts</h3>
        </div>
        <div className="marketProtectionStatus">
          <span>{matchedAlerts.length > 0 ? `${matchedAlerts.length} TRIGGERED` : alerts.length > 0 ? `${alerts.length} ARMED` : "NOT ARMED"}</span>
          <span>{alertSyncState === "synced" ? "ACCOUNT SYNC" : alertSyncState === "syncing" ? "SYNCING" : alertSyncState === "error" ? "LOCAL ONLY" : "DEVICE"}</span>
        </div>
      </header>
      <p>Watch exact-pool sell pressure, liquidity changes, and qualified acceleration. Alerts never submit a trade.</p>
      <div className="marketProtectionPresets" aria-label="One-click market alert presets">
        {MARKET_PROTECTION_PRESETS.map((preset) => (
          <button type="button" onClick={() => armPreset(preset.id)} key={preset.id}>
            <strong>{preset.label}</strong>
            <span>{preset.detail}</span>
          </button>
        ))}
      </div>
      {alerts.length > 0 && (
        <div className="marketProtectionRules" aria-label="Armed market alerts">
          {alerts.map((alert) => {
            const matched = matchedAlerts.some((candidate) => candidate.id === alert.id);
            return (
              <span className={matched ? "matched" : ""} key={alert.id}>
                <b>{matched ? "TRIGGERED" : "ARMED"}</b>
                {ruleLabel(alert)}
                <button type="button" onClick={() => removeWatchlistAlert(alert.id)} aria-label={`Remove ${ruleLabel(alert)}`}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <footer>
        <button type="button" onClick={() => void enableNotifications()}>{permission === "granted" ? "Browser alerts on" : "Enable browser alerts"}</button>
        <Link href="/watchlist">Manage all alerts</Link>
      </footer>
      {message && <div className="marketProtectionMessage" role="status">{message}</div>}
      <small className="marketProtectionDisclosure">Monitoring runs only while RMT is open in this release. A triggered Position Guard or alert can prepare a review, but your selected wallet still controls every signature.</small>
    </section>
  );
}
