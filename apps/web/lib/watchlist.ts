export type WatchlistEntry = {
  address: string;
  name: string;
  symbol: string;
  image?: string;
  addedAt: number;
};

export const WATCHLIST_EVENT = "rmt:watchlist-changed";
const STORAGE_KEY = "rmt-watchlist-v1";
const MAXIMUM_ENTRIES = 50;

function validEntry(value: unknown): value is WatchlistEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<WatchlistEntry>;
  return typeof entry.address === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(entry.address)
    && typeof entry.name === "string"
    && typeof entry.symbol === "string"
    && typeof entry.addedAt === "number";
}

export function readWatchlist() {
  if (typeof window === "undefined") return [] as WatchlistEntry[];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter(validEntry).slice(0, MAXIMUM_ENTRIES)
      : [];
  } catch {
    return [];
  }
}

function writeWatchlist(entries: WatchlistEntry[]) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAXIMUM_ENTRIES)));
    window.dispatchEvent(new Event(WATCHLIST_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function isWatched(address: string) {
  const key = address.toLowerCase();
  return readWatchlist().some((entry) => entry.address.toLowerCase() === key);
}

export function addToWatchlist(entry: WatchlistEntry) {
  const key = entry.address.toLowerCase();
  const remaining = readWatchlist().filter((current) => current.address.toLowerCase() !== key);
  writeWatchlist([{ ...entry, address: entry.address }, ...remaining]);
}

export function removeFromWatchlist(address: string) {
  const key = address.toLowerCase();
  writeWatchlist(readWatchlist().filter((entry) => entry.address.toLowerCase() !== key));
}
