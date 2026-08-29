import { getAddress, isAddress } from "viem";
import {
  externalChartRefreshMs,
  externalOhlcvRequestUrl,
  hasCatastrophicOhlcvPriceMismatch,
  isExternalPoolIdentity,
  isExternalChartRange,
  normalizeExternalPoolIdentity,
  parseExternalOhlcvList,
  type ExternalChartRange
} from "../../../../lib/external-ohlcv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GeckoTerminalResponse = {
  data?: {
    id?: unknown;
    attributes?: {
      ohlcv_list?: unknown;
    };
  };
  meta?: {
    base?: { address?: unknown };
    quote?: { address?: unknown };
  };
};

type OhlcvResult = {
  candles: ReturnType<typeof parseExternalOhlcvList>;
  base: string | null;
  quote: string | null;
};

type CachedPayload = {
  token: string;
  pair: string;
  range: ExternalChartRange;
  candles: OhlcvResult["candles"];
  source: "GeckoTerminal";
  updatedAt: string;
  lastTradeAt: null;
  refreshMs: number;
};

const responseCache = new Map<string, { payload: CachedPayload; expiresAt: number }>();
const inFlight = new Map<string, Promise<CachedPayload>>();
const LAST_KNOWN_MAX_AGE_MS = 15 * 60_000;

function metadataAddress(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

async function fetchOhlcv(pair: string, range: ExternalChartRange, token: string) {
  const request = externalOhlcvRequestUrl(pair, range, token);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(request.url, {
      headers: { Accept: "application/json;version=20230203" },
      next: { revalidate: request.revalidate },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OHLCV provider returned ${response.status}.`);
    const payload = await response.json() as GeckoTerminalResponse;
    const candles = parseExternalOhlcvList(payload.data?.attributes?.ohlcv_list);
    const result = {
      candles,
      base: metadataAddress(payload.meta?.base?.address),
      quote: metadataAddress(payload.meta?.quote?.address)
    };
    if (![result.base, result.quote].some((address) => address?.toLowerCase() === token.toLowerCase())) {
      throw new Error("The requested token is absent from OHLCV metadata.");
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadPayload(token: string, pair: string, range: ExternalChartRange, referencePrice: number | null) {
  const cacheKey = `${token.toLowerCase()}:${pair}:${range}`;
  const refreshMs = externalChartRefreshMs(range);
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const result = await fetchOhlcv(pair, range, token);
    if (result.candles.length < 2) throw new Error("Price history is not available for this range.");
    if (hasCatastrophicOhlcvPriceMismatch(result.candles, referencePrice)) {
      throw new Error("OHLCV price magnitude contradicts the selected token market.");
    }
    const payload: CachedPayload = {
      token,
      pair,
      range,
      candles: result.candles,
      source: "GeckoTerminal",
      updatedAt: new Date().toISOString(),
      lastTradeAt: null,
      refreshMs
    };
    responseCache.set(cacheKey, { payload, expiresAt: Date.now() + refreshMs });
    if (responseCache.size > 96) responseCache.delete(responseCache.keys().next().value!);
    return payload;
  })();
  inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(cacheKey);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const pair = url.searchParams.get("pair") ?? "";
  const range = url.searchParams.get("range") ?? "";
  const referencePriceRaw = url.searchParams.get("referencePrice");
  const referencePrice = referencePriceRaw === null ? null : Number(referencePriceRaw);
  if (!isAddress(token) || !isExternalPoolIdentity(pair) || !isExternalChartRange(range)) {
    return Response.json(
      { error: "Invalid external chart request." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (referencePriceRaw !== null && (!Number.isFinite(referencePrice) || referencePrice! <= 0)) {
    return Response.json({ error: "Invalid chart reference price." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const canonicalToken = getAddress(token);
  const canonicalPair = normalizeExternalPoolIdentity(pair);
  const cacheKey = `${canonicalToken.toLowerCase()}:${canonicalPair}:${range}`;
  try {
    const payload = await loadPayload(canonicalToken, canonicalPair, range, referencePrice);
    if (hasCatastrophicOhlcvPriceMismatch(payload.candles, referencePrice)) {
      throw new Error("OHLCV price magnitude contradicts the selected token market.");
    }

    return Response.json(payload,
      {
        headers: {
          "Cache-Control": `public, s-maxage=${Math.max(1, Math.floor(payload.refreshMs / 1_000))}, stale-while-revalidate=30`
        }
      }
    );
  } catch {
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - Date.parse(cached.payload.updatedAt) <= LAST_KNOWN_MAX_AGE_MS
      && !hasCatastrophicOhlcvPriceMismatch(cached.payload.candles, referencePrice)) {
      return Response.json({ ...cached.payload, stale: true }, {
        headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=60" }
      });
    }
    return Response.json(
      { error: "Price history is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } }
    );
  }
}
