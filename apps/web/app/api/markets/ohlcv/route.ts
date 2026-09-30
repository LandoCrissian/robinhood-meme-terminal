import { getAddress, isAddress } from "viem";
import { isExternalChartRange, isExternalPoolIdentity, normalizeExternalPoolIdentity } from "../../../../lib/external-ohlcv";
import { tokenChartReader } from "../../../../lib/server/token-chart-market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token") ?? "";
  const pair = params.get("pair");
  const range = params.get("range") ?? "";
  const rawPrice = params.get("referencePrice");
  const reference = rawPrice === null ? null : Number(rawPrice);
  if (!isAddress(token, { strict: false }) || (pair !== null && !isExternalPoolIdentity(pair)) || !isExternalChartRange(range)
    || (rawPrice !== null && (!Number.isFinite(reference) || reference! <= 0))) {
    return Response.json({ error: "Invalid external chart request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const payload = await tokenChartReader.chart(getAddress(token), pair ? normalizeExternalPoolIdentity(pair) : null, range, reference);
    return Response.json(payload, { headers: { "Cache-Control": `public, s-maxage=${payload.stale ? 5 : Math.max(1, Math.floor(payload.refreshMs / 1000))}, stale-while-revalidate=30` } });
  } catch {
    return Response.json({ error: "Price history is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } });
  }
}
