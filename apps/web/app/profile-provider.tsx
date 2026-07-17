"use client";

import type { User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { firebaseConfigured, getFirebaseClient } from "../lib/firebase-client";
import { DEFAULT_PROFILE, normalizeProfile, readLocalProfile, writeLocalProfile, type RmtProfile } from "../lib/profile";
import { readWatchlist, replaceWatchlist, WATCHLIST_EVENT, type WatchlistEntry } from "../lib/watchlist";

type SyncState = "local" | "syncing" | "synced" | "error";

type ProfileContextValue = {
  configured: boolean;
  loading: boolean;
  profile: RmtProfile;
  user: User | null;
  syncState: SyncState;
  saveProfile: (profile: RmtProfile) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutProfile: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

function mergeWatchlists(local: WatchlistEntry[], remote: WatchlistEntry[]) {
  const unique = new Map<string, WatchlistEntry>();
  for (const entry of [...local, ...remote]) {
    if (!entry || typeof entry.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(entry.address)) continue;
    const key = entry.address.toLowerCase();
    const current = unique.get(key);
    if (!current || entry.addedAt > current.addedAt) unique.set(key, entry);
  }
  return [...unique.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, 50);
}

function firestoreWatchlist(entries: WatchlistEntry[]) {
  return entries.map((entry) => ({
    address: entry.address,
    name: entry.name,
    symbol: entry.symbol,
    addedAt: entry.addedAt,
    ...(entry.image ? { image: entry.image } : {}),
    ...(entry.launchId ? { launchId: entry.launchId } : {})
  }));
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<RmtProfile>(DEFAULT_PROFILE);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>(firebaseConfigured ? "syncing" : "local");

  useEffect(() => {
    const local = readLocalProfile();
    setProfile(local);
    document.body.dataset.terminalDensity = local.density;

    if (!firebaseConfigured) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void getFirebaseClient().then((client) => {
      if (cancelled) return;
      if (!client) {
        setSyncState("local");
        setLoading(false);
        return;
      }
      void client.authApi.getRedirectResult(client.auth).catch(() => setSyncState("error"));
      unsubscribe = client.authApi.onAuthStateChanged(client.auth, async (nextUser) => {
        setUser(nextUser);
        if (!nextUser) {
          setSyncState("local");
          setLoading(false);
          return;
        }

        setSyncState("syncing");
        try {
          const reference = client.firestoreApi.doc(client.db, "users", nextUser.uid);
          const snapshot = await client.firestoreApi.getDoc(reference);
          const data = snapshot.data();
          const remoteProfile = data?.profile ? normalizeProfile(data.profile) : null;
          const nextProfile = remoteProfile ?? normalizeProfile({
            ...local,
            displayName: local.displayName === DEFAULT_PROFILE.displayName && nextUser.displayName
              ? nextUser.displayName
              : local.displayName
          });
          const remoteWatchlist = Array.isArray(data?.watchlist) ? data.watchlist as WatchlistEntry[] : [];
          const mergedWatchlist = mergeWatchlists(readWatchlist(), remoteWatchlist);

          setProfile(nextProfile);
          writeLocalProfile(nextProfile);
          document.body.dataset.terminalDensity = nextProfile.density;
          replaceWatchlist(mergedWatchlist);
          await client.firestoreApi.setDoc(reference, {
            profile: nextProfile,
            watchlist: firestoreWatchlist(mergedWatchlist),
            email: nextUser.email ?? null,
            updatedAt: client.firestoreApi.serverTimestamp()
          }, { merge: true });
          setSyncState("synced");
        } catch {
          setSyncState("error");
        } finally {
          setLoading(false);
        }
      });
    }).catch(() => {
      setSyncState("error");
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let timer: number | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setSyncState("syncing");
        void getFirebaseClient().then((client) => {
          if (!client) throw new Error("Firebase is not configured.");
          return client.firestoreApi.setDoc(client.firestoreApi.doc(client.db, "users", user.uid), {
            watchlist: firestoreWatchlist(readWatchlist()),
            updatedAt: client.firestoreApi.serverTimestamp()
          }, { merge: true });
        }).then(() => setSyncState("synced")).catch(() => setSyncState("error"));
      }, 250);
    };
    window.addEventListener(WATCHLIST_EVENT, sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(WATCHLIST_EVENT, sync);
    };
  }, [user]);

  const saveProfile = useCallback(async (next: RmtProfile) => {
    const normalized = normalizeProfile(next);
    setProfile(normalized);
    writeLocalProfile(normalized);
    document.body.dataset.terminalDensity = normalized.density;

    if (!firebaseConfigured || !user) {
      setSyncState("local");
      return;
    }
    setSyncState("syncing");
    try {
      const client = await getFirebaseClient();
      if (!client) {
        setSyncState("local");
        return;
      }
      await client.firestoreApi.setDoc(client.firestoreApi.doc(client.db, "users", user.uid), {
        profile: normalized,
        updatedAt: client.firestoreApi.serverTimestamp()
      }, { merge: true });
      setSyncState("synced");
    } catch {
      setSyncState("error");
      throw new Error("Profile sync failed. Your changes are still saved on this device.");
    }
  }, [user]);

  const signInWithGoogle = useCallback(async () => {
    const client = await getFirebaseClient();
    if (!client) return;
    const provider = new client.authApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    setSyncState("syncing");
    if (window.matchMedia("(max-width: 760px)").matches) {
      await client.authApi.signInWithRedirect(client.auth, provider);
      return;
    }
    await client.authApi.signInWithPopup(client.auth, provider);
  }, []);

  const signOutProfile = useCallback(async () => {
    const client = await getFirebaseClient();
    if (client) await client.authApi.signOut(client.auth);
  }, []);

  const value = useMemo<ProfileContextValue>(() => ({
    configured: firebaseConfigured,
    loading,
    profile,
    user,
    syncState,
    saveProfile,
    signInWithGoogle,
    signOutProfile
  }), [loading, profile, saveProfile, signInWithGoogle, signOutProfile, syncState, user]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside ProfileProvider");
  return value;
}
