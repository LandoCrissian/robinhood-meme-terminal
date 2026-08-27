export type OpenSeaPage = {
  entries: unknown[];
  next: string | null;
  raw: unknown;
};
export type RateLimitState = {
  remaining: string | null;
  reset: string | null;
  retryAfter: string | null;
};
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ClientOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  pageSize: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
export class OpenSeaClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #pageSize: number;
  readonly #fetch: FetchLike;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  rateLimitState: RateLimitState = {
    remaining: null,
    reset: null,
    retryAfter: null,
  };
  constructor(options: ClientOptions) {
    if (!options.apiKey.trim()) throw new Error("OpenSea API key is required.");
    this.#baseUrl = options.baseUrl;
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs;
    this.#pageSize = options.pageSize;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
  }
  async get(
    path: string,
    query: Record<string, string | undefined> = {},
  ): Promise<unknown> {
    const url = new URL(path, this.#baseUrl);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "GET",
          headers: { accept: "application/json", "x-api-key": this.#apiKey },
          signal: controller.signal,
        });
      } catch (error) {
        if (attempt === 2)
          throw new Error(
            `OpenSea GET ${url.pathname} failed after bounded retries.`,
            { cause: error },
          );
        await this.#sleep(250 * 2 ** attempt);
        continue;
      } finally {
        clearTimeout(timer);
      }
      this.rateLimitState = {
        remaining: response.headers.get("x-ratelimit-remaining"),
        reset: response.headers.get("x-ratelimit-reset"),
        retryAfter: response.headers.get("retry-after"),
      };
      if (response.ok) return response.json();
      const transient = [408, 429, 500, 502, 503, 504].includes(
        response.status,
      );
      if (!transient || attempt === 2)
        throw new Error(
          `OpenSea GET ${url.pathname} failed with HTTP ${response.status}.`,
        );
      await this.#sleep(this.retryDelay(response, attempt));
    }
    throw new Error("OpenSea retry loop exhausted.");
  }
  private retryDelay(response: Response, attempt: number) {
    const value = response.headers.get("retry-after");
    if (value) {
      const seconds = Number(value);
      if (Number.isFinite(seconds))
        return Math.min(30000, Math.max(0, seconds * 1000));
      const date = Date.parse(value);
      if (Number.isFinite(date))
        return Math.min(30000, Math.max(0, date - this.#now()));
    }
    return 250 * 2 ** attempt;
  }
  chains() {
    return this.get("/api/v2/chains");
  }
  contract(chain: string, address: string) {
    return this.get(
      `/api/v2/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(address)}`,
    );
  }
  collection(slug: string) {
    return this.get(`/api/v2/collections/${encodeURIComponent(slug)}`);
  }
  stats(slug: string) {
    return this.get(`/api/v2/collections/${encodeURIComponent(slug)}/stats`);
  }
  listings(slug: string, next?: string) {
    return this.get(
      `/api/v2/listings/collection/${encodeURIComponent(slug)}/all`,
      { limit: String(this.#pageSize), next },
    );
  }
  offers(slug: string, next?: string) {
    return this.get(
      `/api/v2/offers/collection/${encodeURIComponent(slug)}/all`,
      { limit: String(this.#pageSize), next },
    );
  }
  events(slug: string, next?: string) {
    return this.get(`/api/v2/events/collection/${encodeURIComponent(slug)}`, {
      event_type: "sale",
      limit: String(this.#pageSize),
      next,
    });
  }
  order(chain: string, protocolAddress: string, orderHash: string) {
    return this.get(
      `/api/v2/orders/chain/${encodeURIComponent(chain)}/protocol/${encodeURIComponent(protocolAddress)}/${encodeURIComponent(orderHash)}`,
    );
  }
}
export function page(raw: unknown, key: string): OpenSeaPage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("OpenSea page must be an object.");
  const value = (raw as Record<string, unknown>)[key];
  if (!Array.isArray(value)) throw new Error(`OpenSea page is missing ${key}.`);
  const next = (raw as Record<string, unknown>).next;
  if (next !== undefined && next !== null && typeof next !== "string")
    throw new Error("OpenSea next cursor must be an opaque string or null.");
  return {
    entries: value,
    next: typeof next === "string" && next.length ? next : null,
    raw,
  };
}
