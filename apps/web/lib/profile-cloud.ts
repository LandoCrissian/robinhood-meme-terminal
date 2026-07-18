import {
  DEFAULT_PROFILE,
  nextProfileTimestamp,
  normalizeProfile,
  type LocalProfileSnapshot,
  type RmtProfile
} from "./profile";
import {
  MAXIMUM_WATCHLIST_ENTRIES,
  nextWatchlistTimestamp,
  normalizeWatchlist,
  normalizeWatchlistEntry,
  type WatchlistEntry,
  type WatchlistSnapshot
} from "./watchlist";

export const PROFILE_SCHEMA_VERSION = 1;

export type CloudUserState = {
  profile: RmtProfile | null;
  profileUpdatedAt: number;
  watchlistCount: number;
  watchlistUpdatedAt: number;
  legacyWatchlist: WatchlistEntry[];
};

export type CloudWatchlistSlot = {
  id: string;
  data: Record<string, unknown>;
};

function cleanInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function legacyTimestamp(value: unknown) {
  if (!value || typeof value !== "object" || !("toMillis" in value)) return 0;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return 0;
  try {
    return cleanInteger(toMillis.call(value));
  } catch {
    return 0;
  }
}

export function parseCloudUserState(value: unknown): CloudUserState {
  if (!value || typeof value !== "object") {
    return { profile: null, profileUpdatedAt: 0, watchlistCount: 0, watchlistUpdatedAt: 0, legacyWatchlist: [] };
  }
  const data = value as Record<string, unknown>;
  const fallbackTimestamp = legacyTimestamp(data.updatedAt);
  const legacyWatchlist = normalizeWatchlist(data.watchlist);
  const profile = data.profile && typeof data.profile === "object" ? normalizeProfile(data.profile) : null;
  return {
    profile,
    profileUpdatedAt: cleanInteger(data.profileUpdatedAt) || fallbackTimestamp,
    watchlistCount: Math.min(
      MAXIMUM_WATCHLIST_ENTRIES,
      cleanInteger(data.watchlistCount) || legacyWatchlist.length
    ),
    watchlistUpdatedAt: cleanInteger(data.watchlistUpdatedAt) || fallbackTimestamp,
    legacyWatchlist
  };
}

export function resolveProfileSnapshot(
  local: LocalProfileSnapshot,
  remote: Pick<CloudUserState, "profile" | "profileUpdatedAt">
): LocalProfileSnapshot {
  const remoteWins = Boolean(remote.profile) && remote.profileUpdatedAt >= local.updatedAt;
  const profile = remoteWins ? remote.profile ?? DEFAULT_PROFILE : local.profile;
  let updatedAt = remoteWins ? remote.profileUpdatedAt : local.updatedAt;

  if (updatedAt === 0) updatedAt = nextProfileTimestamp();
  return { profile, updatedAt };
}

export function mergeWatchlists(left: WatchlistEntry[], right: WatchlistEntry[]) {
  return normalizeWatchlist([...left, ...right]);
}

export function resolveWatchlistSnapshot(
  local: WatchlistSnapshot,
  remote: WatchlistSnapshot | null
): WatchlistSnapshot {
  if (!remote) {
    return {
      entries: local.entries,
      updatedAt: local.updatedAt || nextWatchlistTimestamp()
    };
  }
  if (remote.updatedAt > local.updatedAt || (remote.updatedAt === local.updatedAt && remote.updatedAt > 0)) {
    return remote;
  }
  if (local.updatedAt > remote.updatedAt) return local;
  return {
    entries: mergeWatchlists(local.entries, remote.entries),
    updatedAt: nextWatchlistTimestamp()
  };
}

export function parseCloudWatchlist(
  slots: CloudWatchlistSlot[],
  state: Pick<CloudUserState, "legacyWatchlist" | "watchlistCount" | "watchlistUpdatedAt">
): WatchlistSnapshot | null {
  if (slots.length === 0 && state.legacyWatchlist.length > 0) {
    return { entries: state.legacyWatchlist, updatedAt: state.watchlistUpdatedAt };
  }

  const entries: WatchlistEntry[] = [];
  for (const slot of slots) {
    if (!/^(0[0-9]|[1-4][0-9])$/.test(slot.id)) return null;
    if (cleanInteger(slot.data.listUpdatedAt) !== state.watchlistUpdatedAt) return null;
    const entry = normalizeWatchlistEntry(slot.data);
    if (!entry) return null;
    entries.push(entry);
  }
  const normalized = normalizeWatchlist(entries);
  if (normalized.length !== state.watchlistCount || slots.length !== state.watchlistCount) return null;
  return { entries: normalized, updatedAt: state.watchlistUpdatedAt };
}

export function watchlistSlots(entries: WatchlistEntry[], listUpdatedAt: number) {
  return normalizeWatchlist(entries).map((entry, index) => ({
    id: index.toString().padStart(2, "0"),
    data: {
      address: entry.address,
      name: entry.name,
      symbol: entry.symbol,
      addedAt: entry.addedAt,
      listUpdatedAt,
      ...(entry.image ? { image: entry.image } : {}),
      ...(entry.launchId ? { launchId: entry.launchId } : {})
    }
  }));
}
