import { getAddress, isAddress } from "viem";
import { isExternalPoolIdentity, normalizeExternalPoolIdentity } from "../external-ohlcv";

const ROOT = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const MAX_BODY = 512 * 1024;
export type ProviderRead<T> = { data: T; observedAt: string; stale: boolean };
export class PresentationProviderError extends Error {
  constructor(public readonly code: "UNAVAILABLE" | "RATE_LIMITED" | "INVALID", public readonly status?: number) { super(code); }
}

/** Instance-local budget, bounded cache and single flight. A 429 pauses every new read,
 * including other tokens. No retry loop; existing public feed readers are unchanged. */
export function createGeckoPresentationReader(fetcher: typeof fetch = (...args) => fetch(...args), now = () => Date.now()) {
  const cache = new Map<string, { value: ProviderRead<unknown>; expires: number }>();
  const pending = new Map<string, Promise<ProviderRead<unknown>>>();
  const failures = new Map<string, number>();
  let started: number[] = [];
  let cooldownUntil = 0;
  async function read<T>(url: string, parse: (value: unknown) => T, ttl: number, staleAge = 15 * 60_000): Promise<ProviderRead<T>> {
    const target = new URL(url);
    if (target.origin !== "https://api.geckoterminal.com" || target.username || target.password || !target.pathname.startsWith("/api/v2/networks/robinhood/")) throw new PresentationProviderError("INVALID");
    const cached = cache.get(url);
    const fallback = () => {
      if (cached && now() - Date.parse(cached.value.observedAt) <= staleAge) return { ...cached.value, stale: true } as ProviderRead<T>;
      throw new PresentationProviderError("UNAVAILABLE");
    };
    if (cached && cached.expires > now()) return cached.value as ProviderRead<T>;
    const active = pending.get(url);
    if (active) return active as Promise<ProviderRead<T>>;
    started = started.filter(time => now() - time < 60_000);
    if (now() < cooldownUntil) {
      if (cached) return fallback();
      throw new PresentationProviderError("RATE_LIMITED", 429);
    }
    if ((failures.get(url) ?? 0) > now() || started.length >= 24 || pending.size >= 4) return fallback();
    const work = (async () => {
      started.push(now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_500);
      try {
        const options: RequestInit & { next: { revalidate: number } } = { headers: { Accept: "application/json;version=20230203" }, redirect: "error", next: { revalidate: Math.max(1, Math.floor(ttl / 1000)) }, signal: controller.signal };
        const response = await fetcher(url, options);
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - now()) / 1000 : 60;
          cooldownUntil = now() + Math.max(1_000, Math.min(300_000, Number.isFinite(seconds) ? seconds * 1000 : 60_000));
          throw new PresentationProviderError("RATE_LIMITED", 429);
        }
        if (!response.ok) throw new PresentationProviderError("UNAVAILABLE", response.status);
        if (Number(response.headers.get("content-length")) > MAX_BODY) throw new PresentationProviderError("INVALID");
        const reader = response.body?.getReader();
        if (!reader) throw new PresentationProviderError("INVALID");
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY) throw new PresentationProviderError("INVALID");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const data = parse(JSON.parse(new TextDecoder().decode(bytes)));
        const value = { data, observedAt: new Date(now()).toISOString(), stale: false };
        cache.delete(url); cache.set(url, { value, expires: now() + ttl });
        if (cache.size > 96) cache.delete(cache.keys().next().value!);
        failures.delete(url);
        return value;
      } catch (error) {
        failures.set(url, now() + 15_000);
        if (failures.size > 96) failures.delete(failures.keys().next().value!);
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
function numeric(value: unknown) { const number = value === null || value === undefined || value === "" ? NaN : Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
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
    return [{ token: exact, pool: normalizeExternalPoolIdentity(pool), priceUsd: numeric(baseSide ? attrs.base_token_price_usd : attrs.quote_token_price_usd), liquidityUsd: numeric(attrs.reserve_in_usd), volume24hUsd: numeric(attrs.volume_usd?.h24), createdAt: created && Number.isFinite(Date.parse(created)) ? created : null, dex: text(relationships.dex?.data?.id), priceChange24h: baseSide && change !== null && change !== undefined && change !== "" && Number.isFinite(Number(change)) ? Number(change) : null, buys24h: baseSide ? count(attrs.transactions?.h24?.buys) : null, sells24h: baseSide ? count(attrs.transactions?.h24?.sells) : null }];
  }).sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) || (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) || a.pool.localeCompare(b.pool));
}
export type TokenVisual = { name: string | null; symbol: string | null; image: string | null; description: string | null; websites: string[]; twitter: string | null; telegram: string | null; provenance: "GECKOTERMINAL_TOKEN_INFO" };
export function parseTokenVisual(value: unknown, token: string): TokenVisual {
  const data = object(object(value).data); const attrs = object(data.attributes);
  if (data.id !== `robinhood_${getAddress(token).toLowerCase()}` || typeof attrs.address !== "string" || attrs.address.toLowerCase() !== token.toLowerCase()) throw new PresentationProviderError("INVALID");
  return { name: text(attrs.name, 160), symbol: text(attrs.symbol, 40), image: text(attrs.image?.large) ?? text(attrs.image_url), description: text(attrs.description, 4_000), websites: Array.isArray(attrs.websites) ? attrs.websites.slice(0, 5).map((item: unknown) => text(item)).filter((item: string | null): item is string => item !== null) : [], twitter: text(attrs.twitter_handle, 80), telegram: text(attrs.telegram_handle, 80), provenance: "GECKOTERMINAL_TOKEN_INFO" };
}
