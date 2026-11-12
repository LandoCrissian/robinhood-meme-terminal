import { setTimeout } from "node:timers/promises";
import { failureBackoffMs } from "../../indexer/src/rpc-resilience";
import { readLaunchpadRuntime, verifiedLaunchpadRpc } from "../lib/server/new-launchpad-config";
import { syncNewLaunchpadRange } from "../lib/server/new-launchpad-indexer";
import { LaunchpadStore } from "../lib/server/new-launchpad-store";

async function main() {
  const config = readLaunchpadRuntime();
  if (!config) throw new Error("Enable the local launchpad before starting its indexer");
  const store = new LaunchpadStore(config.databasePath, config.scope);
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  let consecutiveFailures = 0;
  try {
    while (!stop.signal.aborted) {
      let delayMs = 1_000;
      try {
        const rpc = await verifiedLaunchpadRpc(config);
        const result = await syncNewLaunchpadRange(store, rpc, config);
        delayMs = result.caughtUp ? 4_000 : 1_000;
        consecutiveFailures = 0;
      } catch (error) {
        store.markHealth(false);
        console.error("Launch index synchronization delayed", error instanceof Error ? error.name : "UnknownError");
        delayMs = failureBackoffMs(2_000, ++consecutiveFailures, 30_000);
      }
      await setTimeout(delayMs, undefined, { signal: stop.signal }).catch((error: unknown) => {
        if (!stop.signal.aborted) throw error;
      });
    }
  } finally {
    store.markHealth(false);
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error("Local launch indexer could not start", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
});
