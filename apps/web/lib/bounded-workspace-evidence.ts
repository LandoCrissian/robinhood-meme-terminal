/** A read-only evidence deadline covers headers, body, validation and late results. */
export function loadBoundedWorkspaceEvidence<T>({ read, ready, unavailable, timeoutMs = 15_000 }: {
  read: (signal: AbortSignal) => Promise<T>;
  ready: (value: T) => void;
  unavailable: () => void;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  let active = true;
  const timeout = setTimeout(() => {
    if (!active) return;
    active = false;
    controller.abort();
    unavailable();
  }, timeoutMs);
  void Promise.resolve().then(() => read(controller.signal)).then((value) => {
    if (!active) return;
    active = false;
    clearTimeout(timeout);
    ready(value);
  }, () => {
    if (!active) return;
    active = false;
    clearTimeout(timeout);
    unavailable();
  });
  return () => {
    active = false;
    clearTimeout(timeout);
    controller.abort();
  };
}
