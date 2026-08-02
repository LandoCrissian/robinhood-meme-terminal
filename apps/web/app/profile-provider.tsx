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
  profileIdentityChanged,
  profileIdentityEditState,
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
import { useRmtIdentity } from "./rmt-identity";

type SyncState = "local" | "syncing" | "synced" | "error";
type FirebaseClient = NonNullable<Awaited<ReturnType<typeof getFirebaseClient>>>;

type ProfileContextValue = {
  accountAuthenticated: boolean;
  accountReady: boolean;
  configured: boolean;
  loading: boolean;
  profile: RmtProfile;
  profileAuthMessage: string;
  identityUpdatedAt: number;
  user: User | null;
  syncState: SyncState;
  retrySync: () => Promise<void>;
  saveProfile: (profile: RmtProfile) => Promise<void>;
  signInProfile: () => void;
  signOutProfile: () => Promise<void>;
};

type CloudWrite = {
  cleanupLegacy?: boolean;
  completeDocument?: boolean;
  existingSlotIds?: Set<string>;
  profile: LocalProfileSnapshot;
  rewriteWatchlist: boolean;
  identityChanged?: boolean;
  userId: string;
  watchlist: WatchlistSnapshot;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

function userDocumentData(
  client: FirebaseClient,
  profile: LocalProfileSnapshot,
  watchlist: WatchlistSnapshot,
  identityChanged = false
) {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profile: profile.profile,
    profileUpdatedAt: profile.updatedAt,
    identityUpdatedAt: identityChanged
      ? client.firestoreApi.serverTimestamp()
      : profile.identityUpdatedAt > 0
      ? client.firestoreApi.Timestamp.fromMillis(profile.identityUpdatedAt)
      : 0,
    watchlistCount: watchlist.entries.length,
    watchlistUpdatedAt: watchlist.updatedAt,
    updatedAt: client.firestoreApi.serverTimestamp()
  };
}

async function writeCloudState(client: FirebaseClient, write: CloudWrite) {
  const batch = client.firestoreApi.writeBatch(client.db);
  const userReference = client.firestoreApi.doc(client.db, "users", write.userId);
  const data: Record<string, unknown> = write.completeDocument
    ? userDocumentData(client, write.profile, write.watchlist, write.identityChanged)
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
          ...(write.identityChanged
            ? { identityUpdatedAt: client.firestoreApi.serverTimestamp() }
            : { identityUpdatedAt: write.profile.identityUpdatedAt > 0
                ? client.firestoreApi.Timestamp.fromMillis(write.profile.identityUpdatedAt)
                : 0 }),
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

function slotDocuments(snapshot: { docs: Array<{ data: () => unknown; id: string }> }) {
  return snapshot.docs.map((document) => ({
    id: document.id,
    data: document.data() as Record<string, unknown>
  }));
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const accountIdentity = useRmtIdentity();
  const [profile, setProfile] = useState<RmtProfile>(DEFAULT_PROFILE);
  const [identityUpdatedAt, setIdentityUpdatedAt] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>(firebaseConfigured ? "syncing" : "local");
  const [cloudReady, setCloudReady] = useState(false);
  const [profileAuthMessage, setProfileAuthMessage] = useState("");
  const activeUserRef = useRef<User | null>(null);
  const cleanupLegacyRef = useRef(false);
  const firebaseClientRef = useRef<FirebaseClient | null>(null);
  const generationRef = useRef(0);
  const remoteSlotIdsRef = useRef(new Set<string>());
  const suppressWatchlistSyncRef = useRef(false);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingIdentityWriteRef = useRef(false);

  const applyProfile = useCallback((snapshot: LocalProfileSnapshot) => {
    setProfile(snapshot.profile);
    setIdentityUpdatedAt(snapshot.identityUpdatedAt);
    writeLocalProfile(snapshot.profile, snapshot.updatedAt, snapshot.identityUpdatedAt);
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

  const syncCurrentState = useCallback(async (
    rewriteWatchlist: boolean,
    completeDocument = false,
    identityChanged = false
  ) => {
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
        identityChanged,
        userId: currentUser.uid,
        watchlist: currentWatchlist
      });
      if (identityChanged) pendingIdentityWriteRef.current = false;
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
    setIdentityUpdatedAt(local.identityUpdatedAt);
    document.body.dataset.terminalDensity = local.profile.density;

    if (!firebaseConfigured || !accountIdentity.enabled || !accountIdentity.ready) {
      setLoading(false);
      return;
    }

    let unsubscribeAuth: (() => void) | undefined;
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribeWatchlist: (() => void) | undefined;
    let cancelled = false;

    void getFirebaseClient().then(async (client) => {
      if (cancelled || !client) {
        if (!cancelled) {
          setSyncState("local");
          setLoading(false);
        }
        return;
      }
      firebaseClientRef.current = client;

      unsubscribeAuth = client.authApi.onAuthStateChanged(client.auth, async (nextUser) => {
        let profileUser: User | null = null;
        if (
          nextUser
          && !nextUser.isAnonymous
          && accountIdentity.authenticated
          && accountIdentity.userId
        ) {
          try {
            const token = await nextUser.getIdTokenResult();
            if (token.claims.rmt_privy_uid === accountIdentity.userId) profileUser = nextUser;
          } catch {
            profileUser = null;
          }
        }
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        unsubscribeProfile?.();
        unsubscribeWatchlist?.();
        unsubscribeProfile = undefined;
        unsubscribeWatchlist = undefined;
        remoteSlotIdsRef.current = new Set();
        activeUserRef.current = profileUser;
        setUser(profileUser);
        setCloudReady(false);

        if (!profileUser) {
          setSyncState("local");
          setLoading(false);
          return;
        }

        setSyncState("syncing");
        setLoading(true);
        try {
          const userReference = client.firestoreApi.doc(client.db, "users", profileUser.uid);
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
            identityChanged: Boolean(
              remoteState.profile
              && profileIdentityChanged(remoteState.profile, nextProfile.profile)
            ),
            userId: profileUser.uid,
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
      firebaseClientRef.current = null;
    };
  }, [
    accountIdentity.authenticated,
    accountIdentity.enabled,
    accountIdentity.ready,
    accountIdentity.userId,
    applyProfile,
    applyWatchlist
  ]);

  useEffect(() => {
    if (!firebaseConfigured || !accountIdentity.enabled || !accountIdentity.ready) return;
    let cancelled = false;

    const synchronizeIdentity = async () => {
      const client = firebaseClientRef.current ?? await getFirebaseClient();
      if (!client || cancelled) return;
      firebaseClientRef.current = client;

      if (!accountIdentity.authenticated) {
        if (client.auth.currentUser) await client.authApi.signOut(client.auth);
        if (!cancelled) {
          setProfileAuthMessage("");
          setSyncState("local");
        }
        return;
      }
      if (!accountIdentity.identityToken || !accountIdentity.userId) {
        setSyncState("syncing");
        return;
      }

      const currentUser = client.auth.currentUser;
      if (currentUser) {
        try {
          const currentToken = await currentUser.getIdTokenResult();
          if (currentToken.claims.rmt_privy_uid === accountIdentity.userId) {
            setProfileAuthMessage("");
            return;
          }
        } catch {
          await client.authApi.signOut(client.auth);
        }
      }

      setProfileAuthMessage("Securing your RMT account across devices…");
      setSyncState("syncing");
      const response = await fetch("/api/auth/firebase-session", {
        method: "POST",
        headers: { "privy-id-token": accountIdentity.identityToken }
      });
      const result = await response.json().catch(() => ({})) as { error?: string; firebaseToken?: string };
      if (!response.ok || !result.firebaseToken) {
        throw new Error(result.error || "RMT account sync could not be verified.");
      }
      if (cancelled) return;
      await client.authApi.signInWithCustomToken(client.auth, result.firebaseToken);
      if (!cancelled) setProfileAuthMessage("");
    };

    void synchronizeIdentity().catch((error) => {
      if (cancelled) return;
      setSyncState("error");
      setProfileAuthMessage(error instanceof Error
        ? error.message
        : "RMT account sync could not be verified. Your local profile remains available.");
    });
    return () => {
      cancelled = true;
    };
  }, [
    accountIdentity.authenticated,
    accountIdentity.enabled,
    accountIdentity.identityToken,
    accountIdentity.ready,
    accountIdentity.userId
  ]);

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
    const previous = readLocalProfileSnapshot();
    const normalized = normalizeProfile(next);
    const identityChanged = profileIdentityChanged(previous.profile, normalized);
    if (identityChanged && !profileIdentityEditState(previous.identityUpdatedAt).canEdit) {
      throw new Error("Identity details are in their protection period. Terminal preferences can still be changed.");
    }
    const updatedAt = nextProfileTimestamp(previous.updatedAt);
    const nextIdentityUpdatedAt = identityChanged ? Date.now() : previous.identityUpdatedAt;
    setProfile(normalized);
    setIdentityUpdatedAt(nextIdentityUpdatedAt);
    writeLocalProfile(normalized, updatedAt, nextIdentityUpdatedAt);
    document.body.dataset.terminalDensity = normalized.density;

    if (!firebaseConfigured || !activeUserRef.current || !cloudReady) {
      setSyncState("local");
      return;
    }
    try {
      if (identityChanged) pendingIdentityWriteRef.current = true;
      await syncCurrentState(false, false, identityChanged);
    } catch {
      setSyncState("error");
      throw new Error("Profile is saved here, but cloud confirmation is pending. Use Retry sync before changing it again.");
    }
  }, [cloudReady, syncCurrentState]);

  const retrySync = useCallback(async () => {
    if (!activeUserRef.current) return;
    const currentWatchlist = readWatchlistSnapshot();
    if (currentWatchlist.updatedAt === 0) {
      replaceWatchlist(currentWatchlist.entries, { emit: false, updatedAt: nextWatchlistTimestamp() });
    }
    await syncCurrentState(true, true, pendingIdentityWriteRef.current);
  }, [syncCurrentState]);

  const signInProfile = useCallback(() => {
    if (!accountIdentity.enabled) {
      setProfileAuthMessage("RMT account sign-in is not configured yet.");
      return;
    }
    setProfileAuthMessage("");
    setSyncState("syncing");
    accountIdentity.login();
  }, [accountIdentity]);

  const signOutProfile = useCallback(async () => {
    const client = await getFirebaseClient();
    const signOuts: Promise<unknown>[] = [];
    if (client?.auth.currentUser) signOuts.push(client.authApi.signOut(client.auth));
    if (accountIdentity.enabled && accountIdentity.authenticated) signOuts.push(accountIdentity.logout());
    const results = await Promise.allSettled(signOuts);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }, [accountIdentity]);

  const value = useMemo<ProfileContextValue>(() => ({
    accountAuthenticated: accountIdentity.authenticated,
    accountReady: accountIdentity.ready,
    configured: firebaseConfigured && accountIdentity.enabled,
    loading,
    profile,
    profileAuthMessage,
    identityUpdatedAt,
    retrySync,
    user,
    syncState,
    saveProfile,
    signInProfile,
    signOutProfile
  }), [
    accountIdentity.authenticated,
    accountIdentity.enabled,
    accountIdentity.ready,
    identityUpdatedAt,
    loading,
    profile,
    profileAuthMessage,
    retrySync,
    saveProfile,
    signInProfile,
    signOutProfile,
    syncState,
    user
  ]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside ProfileProvider");
  return value;
}
