// Owns read-only preparation, never wallet or transaction authority.
export const VERIFIED_REQUEST_REFRESH_MARGIN_MS = 5_000;
export function verifiedRequestRefreshDelay(expiresAtMs: number, nowMs: number) {
  return Math.max(0, expiresAtMs - nowMs - VERIFIED_REQUEST_REFRESH_MARGIN_MS);
}
export function isVerifiedRequestFresh(expiresAtMs: number, nowMs: number) {
  return Number.isFinite(expiresAtMs) && expiresAtMs - nowMs > VERIFIED_REQUEST_REFRESH_MARGIN_MS;
}
export function waitForVerifiedRequestRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Preparation superseded")); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("Preparation superseded")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export class VerifiedRequestRefresh<T> {
  private active?: { key: string; controller: AbortController; handoff: boolean; done: Promise<void> };
  invalidate() { const active = this.active; this.active = undefined; active?.controller.abort(); }
  get running() { return this.active !== undefined; }
  run(options: {
    key: string; handoff: boolean;
    prepare: (context: { current: () => boolean; signal: AbortSignal }) => Promise<T>;
    ready: (value: T, handoff: boolean) => void;
    failed: (cause: unknown) => void;
  }): Promise<void> {
    if (this.active?.key === options.key) {
      this.active.handoff ||= options.handoff;
      return this.active.done;
    }
    this.invalidate();
    const active = { key: options.key, controller: new AbortController(), handoff: options.handoff, done: Promise.resolve() };
    this.active = active;
    const current = () => this.active === active && !active.controller.signal.aborted;
    active.done = Promise.resolve().then(() => options.prepare({ current, signal: active.controller.signal })).then(
      value => { if (!current()) return; this.active = undefined; options.ready(value, active.handoff); },
      cause => { if (!current()) return; this.active = undefined; options.failed(cause); }
    );
    return active.done;
  }
}
