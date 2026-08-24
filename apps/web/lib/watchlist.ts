import { activeChain } from "./network";

export type WatchlistEntry = {
  address: string;
  name: string;
  symbol: string;
  image?: string;
  launchId?: string;
  addedAt: number;
};

export type WatchlistSnapshot = {
  entries: WatchlistEntry[];
  updatedAt: number;
};

export const WATCHLIST_EVENT = "rmt:watchlist-changed";
export const MAXIMUM_WATCHLIST_ENTRIES = 50;
const STORAGE_KEY = `rmt-watchlist-v6:${activeChain.id}`;
const STORAGE_VERSION = 2;

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function cleanImage(value: unknown) {
  const image = cleanText(value, 512);
  return image.startsWith("https://") || image.startsWith("ipfs://") ? image : undefined;
}

export function nextWatchlistTimestamp(previous = 0) {
  return Math.max(Date.now(), cleanTimestamp(previous) + 1);
}

export function normalizeWatchlistEntry(value: unknown): WatchlistEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<WatchlistEntry>;
  const address = typeof entry.address === "string" ? entry.address.toLowerCase() : "";
  const name = cleanText(entry.name, 80);
  const symbol = cleanText(entry.symbol, 20);
  const launchId = cleanText(entry.launchId, 78);
  const addedAt = cleanTimestamp(entry.addedAt);
  if (!/^0x[0-9a-f]{40}$/.test(address) || !name || !symbol || addedAt <= 0) return null;
  return {
    address,
    name,
    symbol,
    addedAt,
    ...(cleanImage(entry.image) ? { image: cleanImage(entry.image) } : {}),
    ...(launchId && /^\d+$/.test(launchId) ? { launchId } : {})
  };
}

export function normalizeWatchlist(value: unknown) {
  if (!Array.isArray(value)) return [] as WatchlistEntry[];
  const unique = new Map<string, WatchlistEntry>();
  for (const candidate of value) {
    const entry = normalizeWatchlistEntry(candidate);
    if (!entry) continue;
    const current = unique.get(entry.address);
    if (!current || entry.addedAt > current.addedAt) unique.set(entry.address, entry);
  }
  return [...unique.values()]
    .sort((left, right) => right.addedAt - left.addedAt)
    .slice(0, MAXIMUM_WATCHLIST_ENTRIES);
}

export function readWatchlistSnapshot(): WatchlistSnapshot {
  if (typeof window === "undefined") return { entries: [], updatedAt: 0 };
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "entries" in parsed) {
      const stored = parsed as { entries?: unknown; updatedAt?: unknown };
      return {
        entries: normalizeWatchlist(stored.entries),
        updatedAt: cleanTimestamp(stored.updatedAt)
      };
    }
    const entries = normalizeWatchlist(parsed);
    return { entries, updatedAt: entries.reduce((latest, entry) => Math.max(latest, entry.addedAt), 0) };
  } catch {
    return { entries: [], updatedAt: 0 };
  }
}

export function readWatchlist() {
  return readWatchlistSnapshot().entries;
}

export function replaceWatchlist(
  entries: WatchlistEntry[],
  options: { emit?: boolean; updatedAt?: number } = {}
) {
  if (typeof window === "undefined") return false;
  try {
    const previous = readWatchlistSnapshot();
    const normalized = normalizeWatchlist(entries);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      entries: normalized,
      updatedAt: options.updatedAt === undefined
        ? nextWatchlistTimestamp(previous.updatedAt)
        : cleanTimestamp(options.updatedAt)
    }));
    if (options.emit !== false) window.dispatchEvent(new Event(WATCHLIST_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function isWatched(address: string) {
  const key = address.toLowerCase();
  return readWatchlist().some((entry) => entry.address === key);
}

export function watchlistEntryHref(entry: WatchlistEntry) {
  return `/?market=${entry.address}`;
}

export function addToWatchlist(entry: WatchlistEntry) {
  const normalized = normalizeWatchlistEntry(entry);
  if (!normalized) return false;
  const remaining = readWatchlist().filter((current) => current.address !== normalized.address);
  return replaceWatchlist([normalized, ...remaining]);
}

export function removeFromWatchlist(address: string) {
  const key = address.toLowerCase();
  return replaceWatchlist(readWatchlist().filter((entry) => entry.address !== key));
}
