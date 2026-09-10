type Job = { cursor: string | null; generation: number; key: string };
type Active = Job & { controller: AbortController; timer: ReturnType<typeof setTimeout> };

// One queue per mounted directory. Membership is bounded by its loaded page
// window, not by the four-request concurrency limit. No autonomous retries.
export function createDirectoryEnrichmentQueue(
  run: (cursor: string | null, signal: AbortSignal, generation: number) => Promise<void>
) {
  let generation = 0;
  let disposed = false;
  const pending = new Map<string, Job>();
  const active = new Map<string, Active>();
  const seen = new Set<string>();

  function clear() {
    pending.clear();
    seen.clear();
    const obsolete = [...active.values()];
    active.clear();
    for (const job of obsolete) { clearTimeout(job.timer); job.controller.abort(); }
  }

  function drain() {
    if (disposed) return;
    while (active.size < 4 && pending.size) {
      const job = pending.values().next().value!;
      pending.delete(job.key);
      if (job.generation !== generation) continue;
      const controller = new AbortController();
      const entry: Active = { ...job, controller, timer: setTimeout(() => controller.abort(), 60_000) };
      active.set(job.key, entry);
      let onAbort: () => void;
      const cancelled = new Promise<void>(resolve => {
        onAbort = resolve;
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      const request = Promise.resolve().then(() => {
        if (!controller.signal.aborted) return run(job.cursor, controller.signal, job.generation);
      });
      void Promise.race([request, cancelled]).catch(() => {
        // Failure ends this attempt; a later ordinary refresh may retry it.
      }).finally(() => {
        clearTimeout(entry.timer);
        controller.signal.removeEventListener("abort", onAbort);
        if (active.get(job.key) !== entry) return;
        active.delete(job.key);
        if (!disposed && job.generation === generation) drain();
      });
    }
  }

  return {
    beginGeneration(next: number) {
      if (disposed || next === generation) return;
      generation = next;
      clear();
    },
    enqueue(cursor: string | null, expectedGeneration: number, loadedPageCount: number) {
      if (disposed || expectedGeneration !== generation) return false;
      const key = JSON.stringify([expectedGeneration, cursor]);
      if (seen.has(key)) return false;
      // Only callers' supported loaded pages can allocate scheduling state.
      if (!Number.isSafeInteger(loadedPageCount) || seen.size >= loadedPageCount) return false;
      seen.add(key);
      pending.set(key, { cursor, generation, key });
      drain();
      return true;
    },
    dispose() { disposed = true; clear(); }
  };
}
