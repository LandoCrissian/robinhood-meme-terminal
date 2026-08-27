import http from "node:http";
import type { MarketplaceWorker } from "./worker.js";
export function createStatusServer(worker: MarketplaceWorker) {
  return http.createServer((request, response) => {
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
