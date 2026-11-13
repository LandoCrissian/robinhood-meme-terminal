import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { readLaunchpadRuntime } from "../lib/server/new-launchpad-config";
import { LaunchpadStore } from "../lib/server/new-launchpad-store";

async function main() {
  const [command, first, second, digest, ...extra] = process.argv.slice(2);
  if (!first || extra.length || (command === "backup" ? !!second : command !== "restore" || !second || !digest)) {
    throw new Error("Use backup <new-snapshot> or restore <snapshot> <new-database> <recorded-sha256>.");
  }
  const config = readLaunchpadRuntime();
  if (!config) throw new Error("The local launchpad configuration is required to bind the backup scope.");
  let result;
  if (command === "backup") {
    if (!(await lstat(config.databasePath)).isFile()) throw new Error("The configured database must be a regular file.");
    const store = new LaunchpadStore(config.databasePath, config.scope);
    try {
      result = await store.backup(resolve(first));
    } finally {
      store.close();
    }
  } else {
    result = await LaunchpadStore.restore(resolve(first), resolve(second), config.scope, digest);
  }
  console.log(JSON.stringify({ command, ...result }, (_, value) => typeof value === "bigint" ? value.toString() : value));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Launchpad backup operation failed.");
  process.exitCode = 1;
});
