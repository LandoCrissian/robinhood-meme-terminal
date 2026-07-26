import { Pool } from "pg";
import { loadMarketIndexerConfig } from "./config.js";
import { migrateMarketIndexer } from "./schema.js";
import { createMarketIndexerServer } from "./server.js";
import { MarketIndexerWorker } from "./worker.js";

const config = loadMarketIndexerConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : false
});

await migrateMarketIndexer(pool);
const worker = new MarketIndexerWorker(pool, config);
await worker.verifySources();
const server = createMarketIndexerServer(pool, config, worker);

server.listen(config.port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      event: "market_indexer_started",
      port: config.port,
      mode: "shadow",
      servingProductionTraffic: false
    })
  );
});
worker.start();

async function shutdown(signal: string) {
  console.info(JSON.stringify({ event: "market_indexer_stopping", signal }));
  worker.stop();
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
