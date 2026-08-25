import { getAddress, isAddress } from "viem";
import {
  externalChartRefreshMs,
  externalOhlcvRequestUrl,
  isExternalChartRange,
  parseExternalOhlcvList,
  type ExternalChartRange
} from "../../../../lib/external-ohlcv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GeckoTerminalResponse = {
  data?: {
    attributes?: {
      ohlcv_list?: unknown;
    };
  };
  meta?: {
    base?: { address?: unknown };
    quote?: { address?: unknown };
  };
};

function metadataAddress(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

async function fetchOhlcv(pair: string, range: ExternalChartRange, tokenSide: "base" | "quote") {
  const request = externalOhlcvRequestUrl(pair, range, tokenSide);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(request.url, {
      headers: { Accept: "application/json" },
      next: { revalidate: request.revalidate },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OHLCV provider returned ${response.status}.`);
    const payload = await response.json() as GeckoTerminalResponse;
    const candles = parseExternalOhlcvList(payload.data?.attributes?.ohlcv_list);
    return {
      candles,
      base: metadataAddress(payload.meta?.base?.address),
      quote: metadataAddress(payload.meta?.quote?.address)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const pair = url.searchParams.get("pair") ?? "";
  const range = url.searchParams.get("range") ?? "";
  if (!isAddress(token) || !isAddress(pair) || !isExternalChartRange(range)) {
    return Response.json(
      { error: "Invalid external chart request." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const canonicalToken = getAddress(token);
    const canonicalPair = getAddress(pair);
    const result = await Promise.any([
      fetchOhlcv(canonicalPair, range, "base").then((candidate) => {
        if (candidate.base?.toLowerCase() !== canonicalToken.toLowerCase()) {
          throw new Error("Token is not the base side.");
        }
        return candidate;
      }),
      fetchOhlcv(canonicalPair, range, "quote").then((candidate) => {
        if (candidate.quote?.toLowerCase() !== canonicalToken.toLowerCase()) {
          throw new Error("Token is not the quote side.");
        }
        return candidate;
      })
    ]).catch(() => null);
    if (!result) throw new Error("The chart provider returned a different token pair.");
    if (result.candles.length < 2) throw new Error("Price history is not available for this range.");
    const refreshMs = externalChartRefreshMs(range);

    return Response.json(
      {
        token: canonicalToken,
        pair: canonicalPair,
        range,
        candles: result.candles,
        source: "GeckoTerminal",
        updatedAt: new Date().toISOString(),
        lastTradeAt: null,
        refreshMs
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${Math.max(1, Math.floor(refreshMs / 1_000))}, stale-while-revalidate=30`
        }
      }
    );
  } catch {
    return Response.json(
      { error: "Live price history is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } }
    );
  }
}
