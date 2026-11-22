import { configuredProductionDiscovery } from "../../../../../lib/server/production-discovery";
import { indexerOrigin } from "../../../../../lib/server/indexer-origin";
import { validMarket, marketIntervals } from "../../../../../lib/token-market";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params,
    args = new URL(request.url).searchParams;
  const interval = Number(args.get("interval") ?? 300),
    before = args.get("before");
  const unavailable = () =>
    Response.json({ status: "unavailable" }, { status: 503, headers });
  if (!configuredProductionDiscovery(request.headers))
    return Response.json({ status: "unavailable" }, { status: 404, headers });
  if (
    !/^0x[0-9a-f]{40}$/i.test(token) ||
    !marketIntervals.some((i) => i === interval) ||
    [...args.keys()].some(
      (k) => !["interval", "before"].includes(k) || args.getAll(k).length !== 1,
    ) ||
    (before !== null &&
      (!/^[1-9][0-9]{0,10}$/.test(before) || Number(before) % interval !== 0))
  )
    return Response.json({ status: "invalid" }, { status: 400, headers });
  const origin = indexerOrigin(process.env.RMT_LAUNCH_HISTORY_INDEXER_URL),
    credential = process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN;
  if (!origin || !credential || !/^[\x21-\x7e]{1,512}$/.test(credential))
    return unavailable();
  try {
    const url = new URL("/curve-market/" + token.toLowerCase(), origin);
    url.searchParams.set("interval", String(interval));
    if (before) url.searchParams.set("before", before);
    const response = await fetch(url, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: "Bearer " + credential,
        Accept: "application/json",
      },
    });
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      return unavailable();
    const reader = response.body.getReader(),
      bytes = new Uint8Array(131072);
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > bytes.length) return unavailable();
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const market = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
    );
    if (
      market.schemaVersion !== 1 ||
      market.chainId !== 4663 ||
      !validMarket(market, token, interval)
    )
      return unavailable();
    // Only the chart contract is public. A worker diagnostic added later must
    // not be forwarded by this authenticated server-to-server proxy.
    const { blockNumber, blockHash, timestamp } = market.checkpoint;
    const graduation = market.graduation;
    return Response.json({
      schemaVersion: 1, chainId: 4663, token: market.token, factory: market.factory,
      interval: market.interval, checkpoint: { blockNumber, blockHash, timestamp },
      soldWei: market.soldWei, backingWei: market.backingWei, phase: market.phase,
      graduation: graduation && { time: graduation.time, poolId: graduation.poolId, nativeUsedWei: graduation.nativeUsedWei },
      candles: market.candles.map(({ time, open, high, low, close, count, volumeWei }) =>
        ({ time, open, high, low, close, count, volumeWei })),
      earlier: market.earlier,
    }, { headers });
  } catch {
    return unavailable();
  }
}
