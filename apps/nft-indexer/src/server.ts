import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { NftIndexerWorker } from './worker.js';
import {
  NftProjectNotFoundError,
  NftProjectReadInputError,
  readNftProjectInventory,
  readNftProjectItem,
  readNftProjectOnchain,
  type NftInventoryRpc,
} from './project-read.js';

export function isNftIndexerReadAuthorized(header: string | undefined, configured: string) {
  const supplied = header?.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/)?.[1] ?? '';
  if (configured.length < 32 || configured.length > 512 || !supplied) return false;
  return timingSafeEqual(createHash('sha256').update(configured).digest(), createHash('sha256').update(supplied).digest());
}

export function createNftIndexerServer(
  worker: NftIndexerWorker,
  pool?: Pool,
  readToken = '',
  inventoryRpc?: NftInventoryRpc,
  pollIntervalMs = 5_000,
) {
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
    const parsed = request.method === 'GET' && request.url ? new URL(request.url, 'http://nft-indexer.internal') : null;
    const inventoryMatch = parsed?.pathname.match(/^\/internal\/v1\/projects\/([a-z0-9-]+)\/inventory$/);
    const itemMatch = parsed?.pathname.match(/^\/internal\/v1\/projects\/([a-z0-9-]+)\/items\/([^/]+)$/);
    if ((inventoryMatch || itemMatch) && pool && inventoryRpc) {
      if (!isNftIndexerReadAuthorized(request.headers.authorization, readToken)) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      try {
        const result = inventoryMatch
          ? await readNftProjectInventory({
              pool,
              rpc: inventoryRpc,
              projectId: inventoryMatch[1]!,
              afterTokenId: parsed?.searchParams.get('afterTokenId') ?? undefined,
              limit: parsed?.searchParams.has('limit') ? Number(parsed.searchParams.get('limit')) : undefined,
              pollIntervalMs,
            })
          : await readNftProjectItem({
              pool,
              rpc: inventoryRpc,
              projectId: itemMatch![1]!,
              tokenId: decodeURIComponent(itemMatch![2]!),
              pollIntervalMs,
            });
        response.statusCode = 200;
        response.end(JSON.stringify(result));
      } catch (error) {
        response.statusCode = error instanceof NftProjectNotFoundError ? 404 : error instanceof NftProjectReadInputError ? 400 : 503;
        response.end(JSON.stringify({ error: response.statusCode === 404 ? 'not found' : response.statusCode === 400 ? 'invalid request' : 'data unavailable' }));
      }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
}
