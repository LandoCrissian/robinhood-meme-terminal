import { getAddress, isAddress } from "viem";
import { isExternalPoolIdentity, normalizeExternalPoolIdentity } from "../external-ohlcv";
import { chartErrorFacts, type ChartReadDiagnostic, type ChartOperation } from "./chart-read-diagnostic";

const ROOT = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const MAX_BODY = 512 * 1024;
export type ProviderRead<T> = { data: T; observedAt: string; stale: boolean };
export class PresentationProviderError extends Error {
  constructor(public readonly code: "UNAVAILABLE" | "RATE_LIMITED" | "INVALID", public readonly status?: number) { super(code); }
}

// An expired platform-cache response is not evidence of a provider failure.
class ExpiredPlatformEvidenceError extends PresentationProviderError {
  constructor() { super("UNAVAILABLE"); }
}

/** Instance-local budget, bounded cache and single flight. A 429 pauses every new read,
 * including other tokens. One bounded cache-expiry bypass shares this single
 * flight, budget and deadline; existing public feed readers are unchanged. */
export function createGeckoPresentationReader(fetcher: typeof fetch = (...args) => fetch(...args), now = () => Date.now()) {
  const cache = new Map<string, { value: ProviderRead<unknown>; expires: number }>();
  const pending = new Map<string, Promise<ProviderRead<unknown>>>();
  const failures = new Map<string, number>();
  let started: number[] = [];
  let cooldownUntil = 0;
  async function read<T>(url: string, parse: (value: unknown) => T, ttl: number, staleAge = 15 * 60_000, diagnostic?: ChartReadDiagnostic): Promise<ProviderRead<T>> {
    const readStarted = diagnostic?.now() ?? 0;
    const target = new URL(url);
    if (target.origin !== "https://api.geckoterminal.com" || target.username || target.password || !target.pathname.startsWith("/api/v2/networks/robinhood/")) throw new PresentationProviderError("INVALID");
    const cached = cache.get(url);
    const cachedAge = cached ? now() - Date.parse(cached.value.observedAt) : undefined;
    diagnostic?.event("STALE_EVIDENCE_READ", readStarted, "OK", { reason: !cached ? "CACHE_MISS" : cached.expires > now() ? "CACHE_FRESH" : "CACHE_EXPIRED", ageMs: cachedAge, expiresInMs: cached ? cached.expires - now() : undefined, staleAvailable: Boolean(cached && cachedAge! <= staleAge) });
    const fallback = () => {
      const available = Boolean(cached && now() - Date.parse(cached.value.observedAt) <= staleAge);
      diagnostic?.event("STALE_EVIDENCE_READ", diagnostic.now(), available ? "OK" : "FAILED", { reason: "STALE_FALLBACK", staleAvailable: available, ageMs: cached ? now() - Date.parse(cached.value.observedAt) : undefined });
      if (available) return { ...cached!.value, stale: true } as ProviderRead<T>;
      throw new PresentationProviderError("UNAVAILABLE");
    };
    if (cached && cached.expires > now()) return cached.value as ProviderRead<T>;
    const active = pending.get(url);
    if (active) { diagnostic?.event("OTHER", readStarted, "SKIPPED", { reason: "PENDING_REUSE" }); return active as Promise<ProviderRead<T>>; }
    started = started.filter(time => now() - time < 60_000);
    if (now() < cooldownUntil) {
      diagnostic?.event("GLOBAL_COOLDOWN", readStarted, "FAILED", { reason: "COOLDOWN", remainingMs: cooldownUntil - now() });
      if (cached) return fallback();
      throw new PresentationProviderError("RATE_LIMITED", 429);
    }
    const blocked = (failures.get(url) ?? 0) > now() || started.length >= 24 || pending.size >= 4;
    diagnostic?.event("LOCAL_BUDGET", readStarted, blocked ? "FAILED" : "OK", { reason: blocked ? (failures.get(url) ?? 0) > now() ? "FAILURE_BACKOFF" : started.length >= 24 ? "START_BUDGET" : "CONCURRENCY" : undefined, starts: started.length, pending: pending.size });
    if (blocked) return fallback();
    const work = (async () => {
      started.push(now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_500);
      const fetchStarted = diagnostic?.now() ?? 0;
      let operation: ChartOperation = target.pathname.includes("/ohlcv/") ? "GECKO_OHLCV_FETCH" : target.pathname.includes("/tokens/") && target.pathname.endsWith("/pools") ? "GECKO_TOKEN_DISCOVERY" : "GECKO_POOL_READ";
      let stageStarted = fetchStarted;
      let reason: Parameters<ChartReadDiagnostic["event"]>[3] = { reason: "FETCH_REJECTED" };
      const attempt = async (freshRead = false): Promise<ProviderRead<T>> => {
        controller.signal.throwIfAborted();
        const options: RequestInit & { next?: { revalidate: number } } = { headers: { Accept: "application/json;version=20230203" }, redirect: "error", signal: controller.signal,
          ...(freshRead ? { cache: "no-store" as const } : { next: { revalidate: Math.max(1, Math.floor(ttl / 1000)) } }) };
        operation = target.pathname.includes("/ohlcv/") ? "GECKO_OHLCV_FETCH" : target.pathname.includes("/tokens/") && target.pathname.endsWith("/pools") ? "GECKO_TOKEN_DISCOVERY" : "GECKO_POOL_READ";
        stageStarted = diagnostic?.now() ?? 0; reason = { reason: "FETCH_REJECTED" };
        const response = await fetcher(url, options);
        diagnostic?.event(operation, stageStarted, "OK", { reason: "HTTP_RESPONSE", httpStatus: response.status, remainingMs: 3_500 - (diagnostic.now() - fetchStarted) });
        operation = "GECKO_HTTP_STATUS"; stageStarted = diagnostic?.now() ?? 0; reason = { httpStatus: response.status };
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - now()) / 1000 : 60;
          cooldownUntil = now() + Math.max(1_000, Math.min(300_000, Number.isFinite(seconds) ? seconds * 1000 : 60_000));
          throw new PresentationProviderError("RATE_LIMITED", 429);
        }
        if (!response.ok) throw new PresentationProviderError("UNAVAILABLE", response.status);
        diagnostic?.event(operation, stageStarted, "OK", reason);
        operation = "GECKO_PARSE"; stageStarted = diagnostic?.now() ?? 0; reason = { reason: "BODY" };
        if (Number(response.headers.get("content-length")) > MAX_BODY) { reason = { reason: "BODY_TOO_LARGE" }; throw new PresentationProviderError("INVALID"); }
        const reader = response.body?.getReader();
        if (!reader) { reason = { reason: "BODY_MISSING" }; throw new PresentationProviderError("INVALID"); }
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY) { reason = { reason: "BODY_TOO_LARGE" }; throw new PresentationProviderError("INVALID"); }
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        reason = { reason: "PAYLOAD" };
        const data = parse(JSON.parse(new TextDecoder().decode(bytes)));
        diagnostic?.event(operation, stageStarted, "OK", reason);
        operation = "STALE_EVIDENCE_READ"; stageStarted = diagnostic?.now() ?? 0;
        // Next's fetch cache can return an earlier HTTP response while it
        // revalidates. Preserve that response's date rather than renewing its
        // observation time on every cold process or cache hit.
        const responseDate = Date.parse(response.headers.get("date") ?? "");
        const observed = Number.isFinite(responseDate) ? responseDate : now();
        reason = { reason: observed > now() + 60_000 ? "HTTP_DATE_FUTURE" : now() - observed > staleAge ? "HTTP_DATE_TOO_OLD" : "HTTP_DATE_VALID", ageMs: now() - observed, observedAt: new Date(observed).toISOString(), observationSource: Number.isFinite(responseDate) ? "HTTP_DATE" : "LOCAL_TIME_FALLBACK" };
        if (observed > now() + 60_000) throw new PresentationProviderError("UNAVAILABLE");
        if (now() - observed > staleAge) {
          diagnostic?.event(operation, stageStarted, "SKIPPED", reason);
          if (cached && now() - Date.parse(cached.value.observedAt) <= staleAge) return fallback();
          // Next may serve expired HTTP-200 data during background revalidation.
          // One no-store read obtains current evidence without private Next
          // promises, cache polling, or a provider penalty for cache expiry.
          if (freshRead) throw new ExpiredPlatformEvidenceError();
          if (controller.signal.aborted) throw new ExpiredPlatformEvidenceError();
          if (now() < cooldownUntil) throw new PresentationProviderError("RATE_LIMITED", 429);
          started = started.filter(time => now() - time < 60_000);
          if (started.length >= 24) {
            diagnostic?.event("LOCAL_BUDGET", stageStarted, "FAILED", { reason: "START_BUDGET", starts: started.length, pending: pending.size });
            throw new ExpiredPlatformEvidenceError();
          }
          started.push(now());
          return attempt(true);
        }
        controller.signal.throwIfAborted();
        diagnostic?.event(operation, stageStarted, "OK", reason);
        const value = { data, observedAt: new Date(observed).toISOString(), stale: now() - observed > ttl };
        operation = "STALE_EVIDENCE_WRITE"; stageStarted = diagnostic?.now() ?? 0; reason = { observedAt: value.observedAt, stale: value.stale };
        cache.delete(url); cache.set(url, { value, expires: now() + ttl });
        if (cache.size > 96) cache.delete(cache.keys().next().value!);
        failures.delete(url);
        diagnostic?.event(operation, stageStarted, "OK", reason);
        return value;
      };
      try { return await attempt();
      } catch (error) {
        diagnostic?.event(controller.signal.aborted && !(error instanceof ExpiredPlatformEvidenceError) ? "GECKO_TIMEOUT" : operation, stageStarted, "FAILED", { ...reason, ...chartErrorFacts(error), remainingMs: 3_500 - ((diagnostic?.now() ?? fetchStarted) - fetchStarted) });
        if (!(error instanceof ExpiredPlatformEvidenceError)) {
          failures.set(url, now() + 15_000);
          if (failures.size > 96) failures.delete(failures.keys().next().value!);
        }
        if (cached && now() - Date.parse(cached.value.observedAt) <= staleAge) return fallback();
        throw error instanceof PresentationProviderError ? error : new PresentationProviderError("UNAVAILABLE");
      } finally { clearTimeout(timer); }
    })();
    pending.set(url, work);
    try { return await work; } finally { pending.delete(url); }
  }
  return { read };
}
export const geckoPresentationReader = createGeckoPresentationReader();
export const geckoTokenUrl = (token: string, resource: "pools" | "info") => `${ROOT}/tokens/${getAddress(token).toLowerCase()}/${resource}${resource === "pools" ? "?include=base_token,quote_token,dex&page=1" : ""}`;

type ObjectValue = Record<string, any>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PresentationProviderError("INVALID");
  return value as ObjectValue;
}
function signedNumeric(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim() || value.length > 64)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function numeric(value: unknown) { const number = signedNumeric(value); return number !== null && number >= 0 ? number : null; }
function count(value: unknown) { const number = numeric(value); return number !== null && Number.isSafeInteger(number) ? number : null; }
function text(value: unknown, max = 500) { return typeof value === "string" && value.length <= max ? value.trim() || null : null; }
function addressFromId(value: unknown) {
  const id = text(value);
  return id?.startsWith("robinhood_") && isAddress(id.slice(10), { strict: false }) ? getAddress(id.slice(10)).toLowerCase() : null;
}
export type ChartMarket = { pool: string; token: string; priceUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; createdAt: string | null; dex: string | null; priceChange24h: number | null; buys24h: number | null; sells24h: number | null };
export function parseTokenPools(value: unknown, token: string): ChartMarket[] {
  const payload = object(value);
  if (!Array.isArray(payload.data) || payload.data.length > 20) throw new PresentationProviderError("INVALID");
  const exact = getAddress(token).toLowerCase();
  return payload.data.flatMap((record: unknown) => {
    const row = object(record); const attrs = object(row.attributes); const relationships = object(row.relationships);
    const base = addressFromId(relationships.base_token?.data?.id); const quote = addressFromId(relationships.quote_token?.data?.id);
    const pool = text(attrs.address);
    if (!pool || !isExternalPoolIdentity(pool) || row.id !== `robinhood_${pool.toLowerCase()}` || !base || !quote || (base !== exact && quote !== exact)) return [];
    const created = text(attrs.pool_created_at);
    const change = attrs.price_change_percentage?.h24;
    // Provider pool movement is expressed for its base token. Do not invert or
    // invent movement/trade-side counts when the selected token is the quote.
    const baseSide = base === exact;
    return [{ token: exact, pool: normalizeExternalPoolIdentity(pool), priceUsd: numeric(baseSide ? attrs.base_token_price_usd : attrs.quote_token_price_usd), liquidityUsd: numeric(attrs.reserve_in_usd), volume24hUsd: numeric(attrs.volume_usd?.h24), createdAt: created && Number.isFinite(Date.parse(created)) ? created : null, dex: text(relationships.dex?.data?.id), priceChange24h: baseSide ? signedNumeric(change) : null, buys24h: baseSide ? count(attrs.transactions?.h24?.buys) : null, sells24h: baseSide ? count(attrs.transactions?.h24?.sells) : null }];
  }).sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) || (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) || a.pool.localeCompare(b.pool));
}
export type TokenVisual = { name: string | null; symbol: string | null; image: string | null; description: string | null; websites: string[]; twitter: string | null; telegram: string | null; provenance: "GECKOTERMINAL_TOKEN_INFO" };
export function parseTokenVisual(value: unknown, token: string): TokenVisual {
  const data = object(object(value).data); const attrs = object(data.attributes);
  if (data.id !== `robinhood_${getAddress(token).toLowerCase()}` || typeof attrs.address !== "string" || attrs.address.toLowerCase() !== token.toLowerCase()) throw new PresentationProviderError("INVALID");
  return { name: text(attrs.name, 160), symbol: text(attrs.symbol, 40), image: text(attrs.image?.large) ?? text(attrs.image_url), description: text(attrs.description, 4_000), websites: Array.isArray(attrs.websites) ? attrs.websites.slice(0, 5).map((item: unknown) => text(item)).filter((item: string | null): item is string => item !== null) : [], twitter: text(attrs.twitter_handle, 80), telegram: text(attrs.telegram_handle, 80), provenance: "GECKOTERMINAL_TOKEN_INFO" };
}
