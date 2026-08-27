import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { MarketplaceWorker } from "./worker.js";
import { NftMarketplaceProjectNotFoundError, readNftProjectMarketplace } from "./project-read.js";

export function isMarketplaceReadAuthorized(header: string | undefined, configured: string) {
  const supplied = header?.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/)?.[1] ?? "";
  if (configured.length < 32 || configured.length > 512 || !supplied) return false;
  return timingSafeEqual(createHash("sha256").update(configured).digest(), createHash("sha256").update(supplied).digest());
}

export function createStatusServer(worker: MarketplaceWorker, pool: Pool, readToken: string, pollIntervalMs: number) {
  return http.createServer(async (request, response) => {
    const match = request.method === "GET" && request.url?.match(/^\/internal\/v1\/projects\/([a-z0-9-]+)\/marketplace$/);
    if (match) {
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      if (!isMarketplaceReadAuthorized(request.headers.authorization, readToken)) {
        response.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        response.writeHead(200).end(JSON.stringify(await readNftProjectMarketplace(pool, match[1]!, pollIntervalMs)));
      } catch (error) {
        const status = error instanceof NftMarketplaceProjectNotFoundError ? 404 : 503;
        response.writeHead(status).end(JSON.stringify({ error: status === 404 ? "not found" : "data unavailable" }));
      }
      return;
    }
    if (request.url !== "/health" && request.url !== "/status") {
      response.writeHead(404).end();
      return;
    }
    const status = worker.status;
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({
        service: "nft-marketplace-indexer",
        provider: "OPENSEA",
        servingProductionTraffic: false,
        publicDataApi: false,
        running: status.running,
        collectionCount: status.collectionCount,
        lastSuccessfulPoll: status.lastSuccessfulPoll,
        lastProviderError: status.lastProviderError,
        rateLimitState: status.rateLimitState,
        lowestNormalizedOpenSeaListings: status.lowestNormalizedListings,
        providerReportedFloors: status.providerReportedFloors,
      }),
    );
  });
}
