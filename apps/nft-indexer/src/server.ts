import { createServer } from 'node:http';
import type { NftIndexerWorker } from './worker.js';

export function createNftIndexerServer(worker: NftIndexerWorker) {
  return createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'GET' && (request.url === '/health' || request.url === '/status')) {
      response.statusCode = worker.status.lastError ? 503 : 200;
      response.end(JSON.stringify({
        service: 'nft-indexer',
        servingProductionTraffic: false,
        publicDataApi: false,
        ...worker.status
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
}
