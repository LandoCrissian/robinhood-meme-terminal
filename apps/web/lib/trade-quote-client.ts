import { quoteRequestKey, SHARED_QUOTE_CACHE_MS } from "./trade-speed";

export type TradeQuoteResponse = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
};

type QuoteEntry = {
  createdAt: number;
  promise: Promise<TradeQuoteResponse>;
};

const quoteRequests = new Map<string, QuoteEntry>();

export type TradeQuoteRequestOptions = {
  identityScope?: string;
  identityToken?: string | null;
  now?: number;
};

export function clearTradeQuoteCache() {
  quoteRequests.clear();
}

export function requestTradeQuote(
  endpoint: string,
  body: Record<string, string | number>,
  options: TradeQuoteRequestOptions = {}
) {
  const now = options.now ?? Date.now();
  const key = `${options.identityScope ?? "anonymous"}:${quoteRequestKey(endpoint, body)}`;
  const existing = quoteRequests.get(key);
  if (existing && now - existing.createdAt <= SHARED_QUOTE_CACHE_MS) return existing.promise;

  const promise = fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.identityToken ? { "privy-id-token": options.identityToken } : {})
    },
    body: JSON.stringify(body)
  }).then(async (response) => ({
    ok: response.ok,
    status: response.status,
    payload: await response.json() as Record<string, unknown>
  }));
  quoteRequests.set(key, { createdAt: now, promise });
  void promise.catch(() => {
    if (quoteRequests.get(key)?.promise === promise) quoteRequests.delete(key);
  });
  return promise;
}
