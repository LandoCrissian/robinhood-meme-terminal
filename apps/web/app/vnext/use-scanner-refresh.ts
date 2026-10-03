"use client";
import { useVisibilityRefresh } from "./use-visibility-refresh";

/** Shared server snapshots, never browser RPC polling or execution reads. */
export function useScannerRefresh(task: () => Promise<boolean | void>, intervalMs: number, options: { enabled?: boolean; immediate?: boolean; refreshKey?: string } = {}) {
  useVisibilityRefresh(task, intervalMs, { ...options, scanner: true });
}
