import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { NftIndexerWorker } from './worker.js';
import { NftProjectNotFoundError, readNftProjectOnchain } from './project-read.js';

export function isNftIndexerReadAuthorized(header: string | undefined, configured: string) {
  const supplied = header?.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/)?.[1] ?? '';
  if (configured.length < 32 || configured.length > 512 || !supplied) return false;
  return timingSafeEqual(createHash('sha256').update(configured).digest(), createHash('sha256').update(supplied).digest());
}

export function createNftIndexerServer(worker: NftIndexerWorker, pool?: Pool, readToken = '') {
  return createServer(async (request, response) => {
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
    const match = request.method === 'GET' && request.url?.match(/^\/internal\/v1\/projects\/([a-z0-9-]+)\/onchain$/);
    if (match && pool) {
      if (!isNftIndexerReadAuthorized(request.headers.authorization, readToken)) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      try {
        response.statusCode = 200;
        response.end(JSON.stringify(await readNftProjectOnchain(pool, match[1]!)));
      } catch (error) {
        response.statusCode = error instanceof NftProjectNotFoundError ? 404 : 503;
        response.end(JSON.stringify({ error: response.statusCode === 404 ? 'not found' : 'data unavailable' }));
      }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
}
