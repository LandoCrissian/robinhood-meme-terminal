import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { externalOriginAdapters } from "./adapter-registry.js";
import { loadExternalOriginConfig } from "./config.js";
import { ExternalOriginStore } from "./origin-store.js";
import { applyExternalOriginSchema } from "./schema.js";
import { createExternalOriginServer } from "./server.js";

async function main() {
  const config = loadExternalOriginConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl:
      process.env.PGSSLMODE?.trim().toLowerCase() === "disable"
        ? false
        : { rejectUnauthorized: false },
    max: config.databasePoolSize,
    application_name: "rmt-external-origin-indexer"
  });

  try {
    await applyExternalOriginSchema(pool);
    const store = new ExternalOriginStore(pool);
    const server = createExternalOriginServer({
      store,
      readToken: config.readToken
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.port, "0.0.0.0");
    });

    const address = server.address() as AddressInfo;
    console.info(JSON.stringify({
      event: "external_origin_shadow_listening",
      port: address.port,
      chainId: 4663,
      configuredAdapters: externalOriginAdapters.length,
      servingProductionTraffic: false
    }));

    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      console.info(JSON.stringify({
        event: "external_origin_shadow_shutdown",
        signal
      }));

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await pool.end();
    };

    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });
  } catch (error) {
    await pool.end();
    throw error;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "external_origin_shadow_startup_failed",
    error: error instanceof Error ? error.message : "unknown"
  }));
  process.exitCode = 1;
});
