import { getAddress, isAddress } from "viem";
import {
  externalTradesRequestUrl,
  parseExternalPoolTrades,
  type ExternalPoolTradesPayload
} from "../../../../lib/external-trades";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const pair = url.searchParams.get("pair") ?? "";
  if (!isAddress(token) || !isAddress(pair)) {
    return Response.json({ error: "Invalid trade tape request." }, { status: 400 });
  }

  try {
    const response = await fetch(externalTradesRequestUrl(pair, token), {
      headers: { Accept: "application/json" },
      next: { revalidate: 4 },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error("Trade source unavailable.");
    const trades = parseExternalPoolTrades(await response.json(), token, 20);
    const payload: ExternalPoolTradesPayload = {
      token: getAddress(token),
      pair: getAddress(pair),
      source: "GeckoTerminal",
      updatedAt: new Date().toISOString(),
      trades
    };
    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=4, stale-while-revalidate=12",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return Response.json(
      { error: "Live trade tape is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } }
    );
  }
}
