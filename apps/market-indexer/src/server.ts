import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { MarketIndexerConfig } from "./config.js";
import {
  MARKET_INDEXER_ACTIVATION_LOCKED,
  MARKET_INDEXER_CHAIN_ID,
  MARKET_SOURCE_MANIFEST_HASH,
  marketSources
} from "./sources.js";
import type { MarketIndexerWorker } from "./worker.js";

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function bearer(request: IncomingMessage, expected: string) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice(7));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export function createMarketIndexerServer(
  pool: Pool,
  config: MarketIndexerConfig,
  worker: MarketIndexerWorker
) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://market-indexer.internal");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          ok: worker.status.lastError === null,
          mode: "shadow",
          storageMode: config.storageMode,
          databaseSizeLimitMb:
            config.databaseSizeLimitBytes === null
              ? null
              : config.databaseSizeLimitBytes / (1024 * 1024),
          chainId: MARKET_INDEXER_CHAIN_ID,
          authoritative: false,
          servingProductionTraffic: false,
          activationLocked: MARKET_INDEXER_ACTIVATION_LOCKED,
          sourceManifestHash: MARKET_SOURCE_MANIFEST_HASH,
          configuredSources: marketSources.map((source) => source.id),
          verifiedSources: worker.status.verifiedSources,
          indexedThrough: worker.status.indexedThrough,
          lastSyncAt: worker.status.lastSyncAt,
          error: worker.status.lastError
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/ready") {
        json(response, 503, {
          ok: false,
          mode: "shadow",
          authoritative: false,
          servingProductionTraffic: false,
          activationLocked: true,
          reason: "shadow market data cannot receive production traffic"
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/pools") {
        if (!bearer(request, config.readToken)) {
          json(response, 401, { error: "unauthorized" });
          return;
        }
        const rawLimit = url.searchParams.get("limit") ?? "100";
        if (!/^[1-9][0-9]*$/.test(rawLimit)) {
          json(response, 400, { error: "limit must be an integer" });
          return;
        }
        const limit = Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit > 500) {
          json(response, 400, { error: "limit must be between 1 and 500" });
          return;
        }
        const source = url.searchParams.get("source");
        if (source && !marketSources.some((candidate) => candidate.id === source)) {
          json(response, 400, { error: "unsupported source" });
          return;
        }
        const result = await pool.query(
          `SELECT source_id AS "sourceId", protocol,
                  protocol_version AS "version", pool_key AS "poolKey",
                  pool_address AS "poolAddress", token0, token1, fee,
                  tick_spacing AS "tickSpacing", hooks,
                  transaction_hash AS "transactionHash",
                  block_number AS "blockNumber", block_hash AS "blockHash"
           FROM market_pools
           WHERE chain_id = $1 AND ($2::text IS NULL OR source_id = $2)
           ORDER BY block_number DESC, transaction_index DESC, log_index DESC
           LIMIT $3`,
          [MARKET_INDEXER_CHAIN_ID, source, limit]
        );
        json(response, 200, {
          chainId: MARKET_INDEXER_CHAIN_ID,
          mode: "shadow",
          authoritative: false,
          sourceManifestHash: MARKET_SOURCE_MANIFEST_HASH,
          pools: result.rows
        });
        return;
      }
      json(response, 404, { error: "not found" });
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : "internal error"
      });
    }
  });
}
