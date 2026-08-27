export const EXTERNAL_BROAD_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";
export const EXTERNAL_CONTRACT_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=90";
export const EXTERNAL_CONTRACT_RESOLVER_CACHE_CONTROL = "public, s-maxage=20, stale-while-revalidate=60";
export const EXTERNAL_BROAD_REFRESH_KEY = "broad";
export const EXTERNAL_BROAD_MAX_IN_FLIGHT = 1;

export class BoundedInFlightCoalescer<T> {
  readonly #maximumEntries: number;
  readonly #inFlight = new Map<string, Promise<T>>();

  constructor(maximumEntries: number) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error("The in-flight coalescer requires a positive bounded capacity.");
    }
    this.#maximumEntries = maximumEntries;
  }

  get size() {
    return this.#inFlight.size;
  }

  run(key: string, refresh: () => Promise<T>): Promise<T> {
    const existing = this.#inFlight.get(key);
    if (existing) return existing;

    // A different key may still run, but it cannot grow the coalescing map past
    // its explicit bound. The current route intentionally has one broad key.
    if (this.#inFlight.size >= this.#maximumEntries) return refresh();

    const pending = Promise.resolve().then(refresh);
    this.#inFlight.set(key, pending);
    const cleanup = () => {
      if (this.#inFlight.get(key) === pending) this.#inFlight.delete(key);
    };
    pending.then(cleanup, cleanup);
    return pending;
  }
}
