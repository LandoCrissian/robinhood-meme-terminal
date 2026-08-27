import { Pool } from "pg";
import { loadNftMarketplaceConfig } from "./config.js";
import { migrateMarketplace } from "./schema.js";
import { createStatusServer } from "./server.js";
import { MarketplaceWorker } from "./worker.js";
async function main() {
  const config = loadNftMarketplaceConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolSize,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
  });
  await migrateMarketplace(pool);
  const worker = new MarketplaceWorker(pool, config);
  await worker.initialize();
  const server = createStatusServer(worker);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, resolve);
  });
  worker.start();
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`nft-marketplace-indexer received ${signal}; shutting down`);
    await worker.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
main().catch((error) => {
  console.error(
    "nft-marketplace-indexer startup failed",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
