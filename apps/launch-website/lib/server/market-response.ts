import { checkpointFresh, validMarket, validMarketAbsence } from "../token-market";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import { indexerOrigin } from "./indexer-origin";

export const marketHeaders = {
  "Cache-Control": "private, no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function readMarketResponse(token: string, interval: number, before: string | null) {
  const headers = marketHeaders;
  const unavailable = () => Response.json({ status: "unavailable" }, { status: 503, headers });
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
      (response.status !== 200 && response.status !== 404) ||
      !response.body ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
    ) {
      await response.body?.cancel();
      return unavailable();
    }
    const reader = response.body.getReader(),
      bytes = new Uint8Array(response.status === 404 ? 4096 : 131072);
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
    if (response.status === 404) {
      if (!validMarketAbsence(market, token)) return unavailable();
      const d = market.deployment, p = market.checkpoint;
      if (d.registry.toLowerCase() !== curveProductionPins.registry[0].toLowerCase()
          || d.blockNumber !== String(curveProductionDeployment.blockNumber)
          || d.blockHash.toLowerCase() !== curveProductionDeployment.blockHash) return unavailable();
      return Response.json({ schemaVersion: 1, chainId: 4663, status: "not_found", token: market.token,
        deployment: { factory: d.factory, registry: d.registry, blockNumber: d.blockNumber, blockHash: d.blockHash },
        checkpoint: { blockNumber: p.blockNumber, blockHash: p.blockHash, timestamp: p.timestamp,
          confirmations: p.confirmations, finality: p.finality, l1Finality: p.l1Finality },
      }, { status: 404, headers });
    }
    if (
      market.schemaVersion !== 1 ||
      market.chainId !== 4663 ||
      (market.status !== undefined && market.status !== "ready") ||
      !validMarket(market, token, interval) || !checkpointFresh(market)
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
