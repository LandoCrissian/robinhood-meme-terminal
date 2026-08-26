import { Pool } from "pg";
import { loadMarketIndexerConfig } from "./config.js";
import { migrateMarketIndexer } from "./schema.js";
import { createMarketIndexerServer } from "./server.js";
import { MarketIndexerWorker } from "./worker.js";
import { PositionGuardHeartbeat } from "./position-guard-heartbeat.js";
import { warmCanonicalTokenIdentityIndex } from "./token-identity-index.js";

const config = loadMarketIndexerConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : false
});

await migrateMarketIndexer(pool, config.storageMode);
await warmCanonicalTokenIdentityIndex(pool);
const worker = new MarketIndexerWorker(pool, config);
const positionGuardHeartbeat = new PositionGuardHeartbeat(config.positionGuardEvaluator);
await worker.verifySources();
const server = createMarketIndexerServer(pool, config, worker, positionGuardHeartbeat);

server.listen(config.port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      event: "market_indexer_started",
      port: config.port,
      mode: "shadow",
      servingProductionTraffic: false,
      positionGuardEvaluatorEnabled: positionGuardHeartbeat.status.enabled
    })
  );
});
worker.start();
positionGuardHeartbeat.start();

async function shutdown(signal: string) {
  console.info(JSON.stringify({ event: "market_indexer_stopping", signal }));
  worker.stop();
  positionGuardHeartbeat.stop();
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
