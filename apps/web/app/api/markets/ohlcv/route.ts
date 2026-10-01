import { getAddress, isAddress } from "viem";
import { isExternalChartRange, isExternalPoolIdentity, normalizeExternalPoolIdentity } from "../../../../lib/external-ohlcv";
import { tokenChartReader } from "../../../../lib/server/token-chart-market";
import { createChartReadDiagnostic, chartErrorFacts } from "../../../../lib/server/chart-read-diagnostic";

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
  const diagnostic = createChartReadDiagnostic(token, range, pair);
  let status = 200;
  let failure: unknown;
  let serializingSince: number | null = null;
  try {
    const payload = await tokenChartReader.chart(getAddress(token), pair ? normalizeExternalPoolIdentity(pair) : null, range, reference, diagnostic);
    serializingSince = diagnostic.now();
    const response = Response.json(payload, { headers: { "Cache-Control": `public, s-maxage=${payload.stale ? 5 : Math.max(1, Math.floor(payload.refreshMs / 1000))}, stale-while-revalidate=30` } });
    diagnostic.event("RESPONSE_SERIALIZATION", serializingSince, "OK");
    return response;
  } catch (error) {
    status = 503; failure = error;
    if (serializingSince !== null) diagnostic.event("RESPONSE_SERIALIZATION", serializingSince, "FAILED", chartErrorFacts(error));
    return Response.json({ error: "Price history is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } });
  } finally {
    // Vercel associates this bounded line with the request. No incoming headers,
    // credential-bearing URLs, provider bodies, raw messages or stacks are logged.
    if (status >= 500) {
      try { console.info(JSON.stringify(diagnostic.summary(status, failure))); } catch { /* Diagnostics cannot change the response. */ }
    }
  }
}
