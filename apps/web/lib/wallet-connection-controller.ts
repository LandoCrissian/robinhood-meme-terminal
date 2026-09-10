/** RMT_EXECUTION_HOT_PATH_DECOUPLING_V1: connection only, never transaction authority. */
export type WalletConnectionState = "IDLE" | "CONNECTING" | "CONNECTED" | "SLOW" | "FAILED";
export type WalletConnectionSnapshot = {
  state: WalletConnectionState;
  walletKey: string | null;
  connectorUid: string | null;
  error: string;
};
type Clock = { now: () => number; set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
const clock: Clock = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) };
export const idleWalletConnection: WalletConnectionSnapshot = { state: "IDLE", walletKey: null, connectorUid: null, error: "" };
type Attempt = { key: string | null; abort: AbortController };
export type ConnectionScope = {
  check: () => void;
  step: <T>(work: () => Promise<T>) => Promise<T>;
  activate: <T>(work: () => Promise<T>) => Promise<T>;
};

export class WalletConnectionController {
  private snapshot = idleWalletConnection;
  private listeners = new Set<() => void>();
  private attempt: Attempt | null = null;
  private timers: unknown[] = [];
  // Keep the lock until the actual mutation settles, even after UI timeout/cancel.
  private activationTail: Promise<unknown> = Promise.resolve();
  constructor(private timer: Clock = clock, private slowMs = 8_000, private failMs = 30_000) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: WalletConnectionSnapshot) { this.snapshot = snapshot; this.listeners.forEach(fn => fn()); }
  private clearTimers() { this.timers.forEach(id => this.timer.clear(id)); this.timers = []; }
  cancel = () => {
    this.clearTimers();
    this.attempt?.abort.abort();
    this.attempt = null;
    this.publish(idleWalletConnection);
  };
  dispose = () => { this.cancel(); this.listeners.clear(); };
  fail = (error = "Wallet connection did not complete. Retry or choose another wallet.") => {
    const snapshot = this.snapshot;
    this.clearTimers();
    this.attempt?.abort.abort();
    this.attempt = null;
    this.publish({ ...snapshot, state: "FAILED", connectorUid: null, error });
  };
  begin(walletKey: string | null = null): ConnectionScope {
    this.cancel();
    const attempt: Attempt = { key: walletKey, abort: new AbortController() };
    const deadline = this.timer.now() + this.failMs;
    this.attempt = attempt;
    this.publish({ state: "CONNECTING", walletKey, connectorUid: null, error: "" });
    const check = () => {
      if (this.attempt !== attempt || attempt.abort.signal.aborted) throw new Error("Wallet selection expired or changed.");
      // Background tabs can delay timer delivery. A late result still cannot commit.
      if (this.timer.now() >= deadline) {
        this.fail("Wallet connection timed out. Retry or choose another wallet.");
        throw new Error("Wallet selection expired.");
      }
    };
    const step = async <T>(work: () => Promise<T>): Promise<T> => {
      check();
      return new Promise<T>((resolve, reject) => {
        const cancelled = () => reject(new Error("Wallet selection expired or changed."));
        attempt.abort.signal.addEventListener("abort", cancelled, { once: true });
        Promise.resolve().then(() => { check(); return work(); }).then(value => {
          check(); resolve(value);
        }).catch(reject).finally(() => attempt.abort.signal.removeEventListener("abort", cancelled));
      });
    };
    this.timers = [
      this.timer.set(() => { if (this.attempt === attempt) this.publish({ ...this.snapshot, state: "SLOW" }); }, this.slowMs),
      this.timer.set(() => { if (this.attempt === attempt) this.fail("Wallet connection timed out. Retry or choose another wallet."); }, this.failMs)
    ];
    return { check, step, activate: <T>(work: () => Promise<T>) => step(() => {
      const mutation = this.activationTail.then(() => { check(); return work(); });
      this.activationTail = mutation.catch(() => undefined);
      return mutation;
    }) };
  }
  async select(walletKey: string, work: (scope: ConnectionScope) => Promise<string>, commit: () => void) {
    const scope = this.begin(walletKey);
    try {
      const connectorUid = await scope.step(() => work(scope));
      scope.check();
      commit();
      scope.check();
      this.clearTimers();
      this.publish({ state: "CONNECTED", walletKey, connectorUid, error: "" });
    } catch {
      try { scope.check(); } catch { return; }
      this.fail();
    }
  }
}

type Provider = { request: (args: { method: string }) => Promise<unknown> };
export type ConnectionWallet = { address: string; getEthereumProvider: () => Promise<Provider>; loginOrLink: () => Promise<unknown> };

/** The wallet is supplied by an explicit UI selection, never a global SDK event. */
export async function activateSelectedWallet(scope: ConnectionScope, wallet: ConnectionWallet, deps: {
  stillSelected: () => boolean;
  currentProvider?: () => Promise<Provider>;
  needsLogin: () => boolean;
  activate: (provider: Provider, check: () => void) => Promise<string>;
}) {
  const check = () => { scope.check(); if (!deps.stillSelected()) throw new Error("Wallet binding changed."); };
  check();
  const provider = await scope.step(() => wallet.getEthereumProvider());
  check();
  const validate = async () => {
    check();
    const current = await scope.step(() => deps.currentProvider ? deps.currentProvider() : wallet.getEthereumProvider());
    check();
    if (current !== provider) throw new Error("Wallet provider changed.");
    const accounts = await scope.step(() => provider.request({ method: "eth_accounts" }));
    check();
    if (!Array.isArray(accounts) || !accounts.some(account => typeof account === "string" && account.toLowerCase() === wallet.address.toLowerCase())) {
      throw new Error("Selected wallet account is unavailable.");
    }
  };
  await validate();
  check();
  if (deps.needsLogin()) {
    await scope.step(() => wallet.loginOrLink());
    check();
    await validate();
    check();
  }
  const uid = await scope.activate(async () => { check(); return deps.activate(provider, check); });
  check();
  await validate();
  check();
  return uid;
}
