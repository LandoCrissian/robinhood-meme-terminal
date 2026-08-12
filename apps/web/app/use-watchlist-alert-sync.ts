"use client";

import { useEffect, useState } from "react";
import { getFirebaseClient } from "../lib/firebase-client";
import {
  normalizeWatchlistAlertListSnapshot,
  readWatchlistAlertSnapshot,
  replaceWatchlistAlerts,
  resolveWatchlistAlertSnapshot,
  WATCHLIST_ALERT_EVENT
} from "../lib/watchlist-alerts";
import { useProfile } from "./profile-provider";
import type { WatchlistAlertSyncState } from "./use-local-watchlist-alert-state";

export function useWatchlistAlertSync() {
  const { user, syncState: profileSyncState } = useProfile();
  const [state, setState] = useState<WatchlistAlertSyncState>("local");

  useEffect(() => {
    if (!user) {
      setState("local");
      return;
    }
    if (profileSyncState !== "synced") {
      setState(profileSyncState === "error" ? "error" : "syncing");
      return;
    }
    let active = true;
    let ready = false;
    let applyingRemote = false;
    let writeTimer: number | undefined;
    let unsubscribe: (() => void) | undefined;

    const applySnapshot = (alerts: ReturnType<typeof readWatchlistAlertSnapshot>["alerts"], updatedAt: number) => {
      applyingRemote = true;
      replaceWatchlistAlerts(alerts, { emit: false, updatedAt });
      window.dispatchEvent(new Event(WATCHLIST_ALERT_EVENT));
      applyingRemote = false;
    };

    const writeSnapshot = async () => {
      const client = await getFirebaseClient();
      if (!client || !active) return;
      const snapshot = readWatchlistAlertSnapshot();
      const reference = client.firestoreApi.doc(client.db, "users", user.uid, "settings", "watchlistAlerts");
      await client.firestoreApi.setDoc(reference, {
        schemaVersion: 1,
        alerts: snapshot.alerts,
        updatedAt: snapshot.updatedAt,
        writtenAt: client.firestoreApi.serverTimestamp()
      });
      if (active) setState("synced");
    };

    const localChanged = () => {
      if (!ready || applyingRemote) return;
      window.clearTimeout(writeTimer);
      setState("syncing");
      writeTimer = window.setTimeout(() => {
        void writeSnapshot().catch(() => active && setState("error"));
      }, 350);
    };

    setState("syncing");
    void getFirebaseClient().then(async (client) => {
      if (!client || !active) throw new Error("Alert sync unavailable.");
      const reference = client.firestoreApi.doc(client.db, "users", user.uid, "settings", "watchlistAlerts");
      const remoteDocument = await client.firestoreApi.getDoc(reference);
      if (!active) return;
      const local = readWatchlistAlertSnapshot();
      const remote = remoteDocument.exists()
        ? normalizeWatchlistAlertListSnapshot(remoteDocument.data())
        : null;
      if (remoteDocument.exists() && !remote) throw new Error("Cloud alert settings were malformed.");
      const resolved = resolveWatchlistAlertSnapshot(local, remote);
      if (resolved.updatedAt !== local.updatedAt || resolved.alerts !== local.alerts) {
        applySnapshot(resolved.alerts, resolved.updatedAt);
      }
      if (!remote || resolved.updatedAt > remote.updatedAt) {
        await client.firestoreApi.setDoc(reference, {
          schemaVersion: 1,
          alerts: resolved.alerts,
          updatedAt: resolved.updatedAt,
          writtenAt: client.firestoreApi.serverTimestamp()
        });
      }
      if (!active) return;
      ready = true;
      window.addEventListener(WATCHLIST_ALERT_EVENT, localChanged);
      unsubscribe = client.firestoreApi.onSnapshot(reference, (snapshot) => {
        if (!snapshot.exists() || !active) return;
        const remoteSnapshot = normalizeWatchlistAlertListSnapshot(snapshot.data());
        const current = readWatchlistAlertSnapshot();
        if (!remoteSnapshot) {
          setState("error");
          return;
        }
        if (remoteSnapshot.updatedAt > current.updatedAt) {
          applySnapshot(remoteSnapshot.alerts, remoteSnapshot.updatedAt);
        }
        setState("synced");
      }, () => setState("error"));
      setState("synced");
    }).catch(() => {
      if (active) setState("error");
    });

    return () => {
      active = false;
      ready = false;
      window.clearTimeout(writeTimer);
      window.removeEventListener(WATCHLIST_ALERT_EVENT, localChanged);
      unsubscribe?.();
    };
  }, [profileSyncState, user]);

  return state;
}
