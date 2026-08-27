import { Pool } from 'pg';
import { loadNftIndexerConfig } from './config.js';
import { migrateNftIndexer } from './schema.js';
import { createNftIndexerServer } from './server.js';
import { createNftIndexerRpc, NftIndexerWorker } from './worker.js';

const config = loadNftIndexerConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : false
});

await migrateNftIndexer(pool);
const rpc = createNftIndexerRpc(config.rpcUrl);
const worker = new NftIndexerWorker(pool, config, rpc);
await worker.verifySources();
const server = createNftIndexerServer(worker, pool, config.readToken, rpc, config.pollIntervalMs);

server.listen(config.port, '0.0.0.0', () => {
  console.info(JSON.stringify({
    event: 'nft_indexer_started', port: config.port,
    verifiedSourceCount: worker.status.verifiedSourceCount,
    servingProductionTraffic: false
  }));
});
worker.start();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: 'nft_indexer_stopping', signal }));
  await worker.stop();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
