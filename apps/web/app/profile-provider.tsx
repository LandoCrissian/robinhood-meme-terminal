"use client";

import type { User } from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { firebaseConfigured, getFirebaseClient } from "../lib/firebase-client";
import {
  PROFILE_SCHEMA_VERSION,
  parseCloudUserState,
  parseCloudWatchlist,
  resolveProfileSnapshot,
  resolveWatchlistSnapshot,
  watchlistSlots,
  type CloudUserState,
  type CloudWatchlistSlot
} from "../lib/profile-cloud";
import {
  DEFAULT_PROFILE,
  nextProfileTimestamp,
  normalizeProfile,
  readLocalProfileSnapshot,
  writeLocalProfile,
  type LocalProfileSnapshot,
  type RmtProfile
} from "../lib/profile";
import {
  nextWatchlistTimestamp,
  readWatchlistSnapshot,
  replaceWatchlist,
  WATCHLIST_EVENT,
  type WatchlistSnapshot
} from "../lib/watchlist";

type SyncState = "local" | "syncing" | "synced" | "error";
type FirebaseClient = NonNullable<Awaited<ReturnType<typeof getFirebaseClient>>>;

type ProfileContextValue = {
  configured: boolean;
  loading: boolean;
  profile: RmtProfile;
  user: User | null;
  syncState: SyncState;
  retrySync: () => Promise<void>;
  saveProfile: (profile: RmtProfile) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutProfile: () => Promise<void>;
};

type CloudWrite = {
  cleanupLegacy?: boolean;
  completeDocument?: boolean;
  existingSlotIds?: Set<string>;
  profile: LocalProfileSnapshot;
  rewriteWatchlist: boolean;
  userId: string;
  watchlist: WatchlistSnapshot;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

function userDocumentData(client: FirebaseClient, profile: LocalProfileSnapshot, watchlist: WatchlistSnapshot) {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profile: profile.profile,
    profileUpdatedAt: profile.updatedAt,
    watchlistCount: watchlist.entries.length,
    watchlistUpdatedAt: watchlist.updatedAt,
    updatedAt: client.firestoreApi.serverTimestamp()
  };
}

async function writeCloudState(client: FirebaseClient, write: CloudWrite) {
  const batch = client.firestoreApi.writeBatch(client.db);
  const userReference = client.firestoreApi.doc(client.db, "users", write.userId);
  const data: Record<string, unknown> = write.completeDocument
    ? userDocumentData(client, write.profile, write.watchlist)
    : write.rewriteWatchlist
      ? {
          schemaVersion: PROFILE_SCHEMA_VERSION,
          watchlistCount: write.watchlist.entries.length,
          watchlistUpdatedAt: write.watchlist.updatedAt,
          updatedAt: client.firestoreApi.serverTimestamp()
        }
      : {
          schemaVersion: PROFILE_SCHEMA_VERSION,
          profile: write.profile.profile,
          profileUpdatedAt: write.profile.updatedAt,
          updatedAt: client.firestoreApi.serverTimestamp()
        };
  if (write.cleanupLegacy) {
    data.email = client.firestoreApi.deleteField();
    data.watchlist = client.firestoreApi.deleteField();
  }
  batch.set(userReference, data, { merge: true });

  if (write.rewriteWatchlist) {
    const slots = watchlistSlots(write.watchlist.entries, write.watchlist.updatedAt);
    const desiredIds = new Set(slots.map((slot) => slot.id));
    for (const slot of slots) {
      batch.set(client.firestoreApi.doc(userReference, "watchlist", slot.id), slot.data);
    }
    for (const slotId of write.existingSlotIds ?? []) {
      if (!desiredIds.has(slotId)) batch.delete(client.firestoreApi.doc(userReference, "watchlist", slotId));
    }
  }

  await batch.commit();
}

function friendlyAuthError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Google sign-in was closed. Your local profile is unchanged.";
  }
  if (code === "auth/popup-blocked") {
    return "Your browser blocked Google sign-in. Allow popups for RMT and try again.";
  }
  if (code === "auth/network-request-failed") {
    return "Google sign-in could not reach Firebase. Check your connection and try again.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This RMT domain is not authorized for profile sign-in yet.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is not enabled in the RMT Firebase project yet.";
  }
  return "Google sign-in did not finish. Your local profile is unchanged.";
}

function slotDocuments(snapshot: { docs: Array<{ data: () => unknown; id: string }> }) {
  return snapshot.docs.map((document) => ({
    id: document.id,
    data: document.data() as Record<string, unknown>
  }));
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<RmtProfile>(DEFAULT_PROFILE);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>(firebaseConfigured ? "syncing" : "local");
  const [cloudReady, setCloudReady] = useState(false);
  const activeUserRef = useRef<User | null>(null);
  const cleanupLegacyRef = useRef(false);
  const generationRef = useRef(0);
  const remoteSlotIdsRef = useRef(new Set<string>());
  const suppressWatchlistSyncRef = useRef(false);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const applyProfile = useCallback((snapshot: LocalProfileSnapshot) => {
    setProfile(snapshot.profile);
    writeLocalProfile(snapshot.profile, snapshot.updatedAt);
    document.body.dataset.terminalDensity = snapshot.profile.density;
  }, []);

  const applyWatchlist = useCallback((snapshot: WatchlistSnapshot) => {
    suppressWatchlistSyncRef.current = true;
    replaceWatchlist(snapshot.entries, { updatedAt: snapshot.updatedAt });
    suppressWatchlistSyncRef.current = false;
  }, []);

  const queueWrite = useCallback((task: () => Promise<void>) => {
    const queued = writeQueueRef.current.catch(() => undefined).then(task);
    writeQueueRef.current = queued;
    return queued;
  }, []);

  const syncCurrentState = useCallback(async (rewriteWatchlist: boolean, completeDocument = false) => {
    const currentUser = activeUserRef.current;
    if (!currentUser) return;
    const generation = generationRef.current;
    setSyncState("syncing");
    await queueWrite(async () => {
      const client = await getFirebaseClient();
      if (!client || generationRef.current !== generation || activeUserRef.current?.uid !== currentUser.uid) return;
      const currentProfile = readLocalProfileSnapshot();
      const currentWatchlist = readWatchlistSnapshot();
      await writeCloudState(client, {
        cleanupLegacy: cleanupLegacyRef.current,
        completeDocument: completeDocument || cleanupLegacyRef.current,
        existingSlotIds: remoteSlotIdsRef.current,
        profile: currentProfile,
        rewriteWatchlist,
        userId: currentUser.uid,
        watchlist: currentWatchlist
      });
      cleanupLegacyRef.current = false;
      if (rewriteWatchlist) {
        remoteSlotIdsRef.current = new Set(watchlistSlots(currentWatchlist.entries, currentWatchlist.updatedAt).map((slot) => slot.id));
      }
      if (generationRef.current === generation && activeUserRef.current?.uid === currentUser.uid) setSyncState("synced");
    });
  }, [queueWrite]);

  useEffect(() => {
    const local = readLocalProfileSnapshot();
    setProfile(local.profile);
    document.body.dataset.terminalDensity = local.profile.density;

    if (!firebaseConfigured) {
      setLoading(false);
      return;
    }

    let unsubscribeAuth: (() => void) | undefined;
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribeWatchlist: (() => void) | undefined;
    let cancelled = false;

    void getFirebaseClient().then((client) => {
      if (cancelled || !client) {
        if (!cancelled) {
          setSyncState("local");
          setLoading(false);
        }
        return;
      }

      unsubscribeAuth = client.authApi.onAuthStateChanged(client.auth, async (nextUser) => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        unsubscribeProfile?.();
        unsubscribeWatchlist?.();
        unsubscribeProfile = undefined;
        unsubscribeWatchlist = undefined;
        remoteSlotIdsRef.current = new Set();
        activeUserRef.current = nextUser;
        setUser(nextUser);
        setCloudReady(false);

        if (!nextUser) {
          setSyncState("local");
          setLoading(false);
          return;
        }

        setSyncState("syncing");
        setLoading(true);
        try {
          const userReference = client.firestoreApi.doc(client.db, "users", nextUser.uid);
          const watchlistReference = client.firestoreApi.collection(userReference, "watchlist");
          const [userSnapshot, watchlistSnapshot] = await Promise.all([
            client.firestoreApi.getDoc(userReference),
            client.firestoreApi.getDocs(watchlistReference)
          ]);
          if (cancelled || generationRef.current !== generation) return;

          const rawUserData = userSnapshot.data() as Record<string, unknown> | undefined;
          const remoteState = parseCloudUserState(rawUserData);
          const initialSlots = slotDocuments(watchlistSnapshot);
          remoteSlotIdsRef.current = new Set(initialSlots.map((slot) => slot.id));
          cleanupLegacyRef.current = Boolean(rawUserData && ("email" in rawUserData || "watchlist" in rawUserData));
          const remoteWatchlist = userSnapshot.exists()
            ? parseCloudWatchlist(initialSlots, remoteState)
            : null;
          if (userSnapshot.exists() && !remoteWatchlist) throw new Error("Cloud watchlist state is incomplete.");

          const nextProfile = resolveProfileSnapshot(readLocalProfileSnapshot(), remoteState);
          const nextWatchlist = resolveWatchlistSnapshot(readWatchlistSnapshot(), remoteWatchlist);
          applyProfile(nextProfile);
          applyWatchlist(nextWatchlist);

          await writeCloudState(client, {
            cleanupLegacy: cleanupLegacyRef.current,
            completeDocument: true,
            existingSlotIds: remoteSlotIdsRef.current,
            profile: nextProfile,
            rewriteWatchlist: true,
            userId: nextUser.uid,
            watchlist: nextWatchlist
          });
          if (cancelled || generationRef.current !== generation) return;
          cleanupLegacyRef.current = false;
          remoteSlotIdsRef.current = new Set(watchlistSlots(nextWatchlist.entries, nextWatchlist.updatedAt).map((slot) => slot.id));

          let liveUserState: CloudUserState | null = null;
          let liveSlots: CloudWatchlistSlot[] | null = null;
          const applyLiveState = () => {
            if (!liveUserState || !liveSlots || generationRef.current !== generation) return;
            const remoteProfile = resolveProfileSnapshot(readLocalProfileSnapshot(), liveUserState);
            const localProfile = readLocalProfileSnapshot();
            if (liveUserState.profile && liveUserState.profileUpdatedAt > localProfile.updatedAt) applyProfile(remoteProfile);

            const remoteList = parseCloudWatchlist(liveSlots, liveUserState);
            const localList = readWatchlistSnapshot();
            if (remoteList && remoteList.updatedAt > localList.updatedAt) applyWatchlist(remoteList);
          };

          unsubscribeProfile = client.firestoreApi.onSnapshot(userReference, (snapshot) => {
            if (!snapshot.exists()) return;
            liveUserState = parseCloudUserState(snapshot.data());
            applyLiveState();
          }, () => setSyncState("error"));
          unsubscribeWatchlist = client.firestoreApi.onSnapshot(watchlistReference, (snapshot) => {
            liveSlots = slotDocuments(snapshot);
            remoteSlotIdsRef.current = new Set(liveSlots.map((slot) => slot.id));
            applyLiveState();
          }, () => setSyncState("error"));

          setCloudReady(true);
          setSyncState("synced");
        } catch {
          if (generationRef.current === generation) setSyncState("error");
        } finally {
          if (generationRef.current === generation) setLoading(false);
        }
      });
    }).catch(() => {
      setSyncState("error");
      setLoading(false);
    });

    return () => {
      cancelled = true;
      generationRef.current += 1;
      unsubscribeAuth?.();
      unsubscribeProfile?.();
      unsubscribeWatchlist?.();
    };
  }, [applyProfile, applyWatchlist]);

  useEffect(() => {
    if (!user || !cloudReady) return;
    let timer: number | undefined;
    const sync = () => {
      if (suppressWatchlistSyncRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void syncCurrentState(true).catch(() => setSyncState("error"));
      }, 350);
    };
    window.addEventListener(WATCHLIST_EVENT, sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(WATCHLIST_EVENT, sync);
    };
  }, [cloudReady, syncCurrentState, user]);

  const saveProfile = useCallback(async (next: RmtProfile) => {
    const normalized = normalizeProfile(next);
    const updatedAt = nextProfileTimestamp(readLocalProfileSnapshot().updatedAt);
    setProfile(normalized);
    writeLocalProfile(normalized, updatedAt);
    document.body.dataset.terminalDensity = normalized.density;

    if (!firebaseConfigured || !activeUserRef.current || !cloudReady) {
      setSyncState("local");
      return;
    }
    try {
      await syncCurrentState(false);
    } catch {
      setSyncState("error");
      throw new Error("Profile sync failed. Your changes are still saved on this device.");
    }
  }, [cloudReady, syncCurrentState]);

  const retrySync = useCallback(async () => {
    if (!activeUserRef.current) return;
    const currentWatchlist = readWatchlistSnapshot();
    if (currentWatchlist.updatedAt === 0) {
      replaceWatchlist(currentWatchlist.entries, { emit: false, updatedAt: nextWatchlistTimestamp() });
    }
    await syncCurrentState(true, true);
  }, [syncCurrentState]);

  const signInWithGoogle = useCallback(async () => {
    const client = await getFirebaseClient();
    if (!client) throw new Error("Firebase profile sync is not configured yet.");
    const provider = new client.authApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    setSyncState("syncing");
    try {
      await client.authApi.signInWithPopup(client.auth, provider);
    } catch (error) {
      setSyncState("local");
      throw new Error(friendlyAuthError(error));
    }
  }, []);

  const signOutProfile = useCallback(async () => {
    const client = await getFirebaseClient();
    if (!client) return;
    await client.authApi.signOut(client.auth);
  }, []);

  const value = useMemo<ProfileContextValue>(() => ({
    configured: firebaseConfigured,
    loading,
    profile,
    retrySync,
    user,
    syncState,
    saveProfile,
    signInWithGoogle,
    signOutProfile
  }), [loading, profile, retrySync, saveProfile, signInWithGoogle, signOutProfile, syncState, user]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside ProfileProvider");
  return value;
}
