"use client";

import { useEffect, useRef } from "react";
import { visibilityRefreshDelay } from "../../lib/vnext/client-refresh-policy";

export type VisibilityRefreshOptions = {
  enabled?: boolean;
  immediate?: boolean;
  refreshKey?: string;
};

/**
 * Runs a background read only while the terminal is visible. Returning to a
 * hidden tab triggers a refresh only when the previous snapshot is stale.
 */
export function useVisibilityRefresh(
  task: () => void | Promise<void>,
  intervalMs: number,
  { enabled = true, immediate = true, refreshKey = "default" }: VisibilityRefreshOptions = {}
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

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      if (!active || document.visibilityState === "hidden") return;
      timer = window.setTimeout(run, visibilityRefreshDelay(lastStartedAt.current, intervalMs));
    };
    const run = () => {
      clearTimer();
      if (!active || document.visibilityState === "hidden" || running) return;
      running = true;
      lastStartedAt.current = Date.now();
      void Promise.resolve()
        .then(() => taskRef.current())
        .catch(() => undefined)
        .finally(() => {
          running = false;
          schedule();
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearTimer();
      else schedule();
    };

    lastStartedAt.current = immediate ? null : Date.now();
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      active = false;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, immediate, intervalMs, refreshKey]);
}
