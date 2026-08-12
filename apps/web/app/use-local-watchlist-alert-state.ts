export type WatchlistAlertSyncState = "local" | "syncing" | "synced" | "error";

export function useLocalWatchlistAlertState(): WatchlistAlertSyncState {
  return "local";
}
