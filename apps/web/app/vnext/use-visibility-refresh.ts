"use client";

import { useEffect, useRef } from "react";
import { visibilityRefreshDelay } from "../../lib/vnext/client-refresh-policy";

export type VisibilityRefreshOptions = {
  enabled?: boolean;
  immediate?: boolean;
  refreshKey?: string;
  scanner?: boolean;
};

/**
 * Runs a background read only while the terminal is visible. Returning to a
 * hidden tab triggers a refresh only when the previous snapshot is stale.
 */
export function useVisibilityRefresh(
  task: () => void | boolean | Promise<void | boolean>,
  intervalMs: number,
  { enabled = true, immediate = true, refreshKey = "default", scanner = false }: VisibilityRefreshOptions = {}
) {
  const taskRef = useRef(task);
  const lastStartedAt = useRef<number | null>(null);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    let timer: number | undefined;
    let failures = 0;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      if (!active || document.visibilityState === "hidden" || (scanner && !navigator.onLine)) return;
      const cadence = scanner ? Math.min(300_000, intervalMs * 2 ** failures) : intervalMs;
      timer = window.setTimeout(run, visibilityRefreshDelay(lastStartedAt.current, cadence));
    };
    const run = () => {
      clearTimer();
      if (!active || document.visibilityState === "hidden" || running || (scanner && !navigator.onLine)) return;
      running = true;
      lastStartedAt.current = Date.now();
      void Promise.resolve()
        .then(() => taskRef.current())
        .then(result => { failures = result === false ? Math.min(4, failures + 1) : 0; })
        .catch(() => { failures = Math.min(4, failures + 1); })
        .finally(() => {
          running = false;
          schedule();
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearTimer();
      else if (scanner) resume();
      else schedule();
    };
    const resume = () => {
      clearTimer();
      if (!active || running || document.visibilityState === "hidden" || !navigator.onLine) return;
      // Coalesce focus/visibility/reconnect and prevent rapid event bursts.
      timer = window.setTimeout(run, visibilityRefreshDelay(lastStartedAt.current, 10_000));
    };

    lastStartedAt.current = immediate ? null : Date.now();
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (scanner) { window.addEventListener("focus", resume); window.addEventListener("online", resume); window.addEventListener("offline", clearTimer); }
    schedule();
    return () => {
      active = false;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (scanner) { window.removeEventListener("focus", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", clearTimer); }
    };
  }, [enabled, immediate, intervalMs, refreshKey, scanner]);
}
